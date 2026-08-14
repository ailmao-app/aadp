/**
 * The traversal state machine (ADR-0011 §3/§7/§8, plan 1.5.0 §"Edge matrix"
 * and §"Traversal state machine").
 *
 * Owns the three transitions and nothing else: which node was discovered at
 * which depth, what each extension produced, and what happened to each edge
 * occurrence. Fetching, budget accounting and streaming are deliberately NOT
 * here — a node is resolved through the injected `TraversalNodeResolver`, so
 * this file can be exercised without a network and the later phases can wire
 * the real shared canonical resolution behind the same seam.
 *
 * Walk state is WALK-LOCAL. `expandedKeys` and the ancestor chain live in the
 * `GraphTraversalState` this walk owns, never on the budget: the budget is
 * designed to outlive one call, so putting expansion state on it would let a
 * second walk on the same budget silently skip every outgoing edge of a node
 * the first walk expanded, making results depend on call history.
 */
import type { EntityV1 } from "../../client/v1.0/index.js";
import { canonicalTargetKey } from "../../modules/relations/v1.0/index.js";
import { planNodeExpansions, type PlannedTraversalEdge } from "./edge-planner.js";
import type { TraversalAdapterLookup } from "./registry.js";
import type {
  EdgeExpansionOutcomeV1,
  GraphEdgeV1,
  GraphExtensionExpansionV1,
  GraphNodeStatusV1,
  GraphNodeV1,
  GraphReferenceV1,
  GraphTraversalEventV1,
  GraphTraversalSummaryV1,
} from "./types.js";

/* ------------------------------------------------------------------------- *
 * The resolution seam.
 * ------------------------------------------------------------------------- */

export interface TraversalNodeRequest {
  url: string;
  /** The id the referring occurrence declared, when there is a referrer. */
  declaredId?: string;
  depth: number;
}

export interface TraversalNodeResolution {
  status: GraphNodeStatusV1;
  /** Present only for `resolved`. */
  entity?: EntityV1;
  message?: string;
}

/**
 * Resolves one URL to a canonical outcome. Phase 4 backs this with the shared
 * canonical resolution layer keyed by the caller's budget; this phase treats it
 * as an opaque call made at most once per canonical key.
 */
export type TraversalNodeResolver = (request: TraversalNodeRequest) => Promise<TraversalNodeResolution>;

/* ------------------------------------------------------------------------- *
 * Edge group ranking (plan §"Ordering").
 * ------------------------------------------------------------------------- */

const BUILTIN_EDGE_GROUP_RANK: ReadonlyMap<string, number> = new Map([
  ["relations.item", 0],
  ["relations.collection", 1],
  ["answer.related_entity", 2],
  ["answer.source_target", 3],
  ["evidence.evidence_ref", 4],
]);

const THIRD_PARTY_RANK_BASE = BUILTIN_EDGE_GROUP_RANK.size;

/**
 * A fixed constant per edge group, never the adapter registration order — two
 * deployments with the same adapter set must schedule identically. Third-party
 * groups rank after every built-in, and `compareSchedule` breaks ties among
 * them by `moduleId` then `edgeGroup`.
 */
function edgeGroupRank(edgeGroup: string): number {
  return BUILTIN_EDGE_GROUP_RANK.get(edgeGroup) ?? THIRD_PARTY_RANK_BASE;
}

/* ------------------------------------------------------------------------- *
 * Walk state.
 * ------------------------------------------------------------------------- */

/** One scheduled edge occurrence, linked to the occurrence that discovered its source. */
interface Occurrence {
  planned: PlannedTraversalEdge;
  fromKey: string;
  /** Depth the target would land on: source depth + 1. */
  landingDepth: number;
  /** Discovery order of the source node — the schedule key's `parentDiscoveryIndex`. */
  parentDiscoveryIndex: number;
  /** The occurrence that produced the source node, for the ancestor walk. */
  parent?: Occurrence;
  targetKey: string;
}

interface PendingNode {
  key: string;
  depth: number;
  discoveryIndex: number;
  /**
   * Whether this node's own outgoing edges are expanded when it is dequeued.
   * A leaf or unresolvable target is still emitted as a node — it is a real
   * node of the graph — but plans nothing.
   */
  expand: boolean;
  /** The occurrence that discovered this node; `undefined` for the root. */
  via?: Occurrence;
}

/**
 * INTERNAL walk state — deliberately absent from every public signature
 * (`GraphTraversalOptions`, `CrossModuleGraphV1` and `GraphTraversalSummaryV1`
 * all expose no `state`).
 */
interface GraphTraversalState {
  /**
   * Canonical keys whose OWN outgoing edges this walk has claimed for
   * expansion. Claimed when an edge settles as `expanded`, not when the node is
   * dequeued, so a second occurrence pointing at the same target reports
   * `already-expanded` rather than a second `expanded`.
   */
  expandedKeys: Set<string>;
  /** Canonical outcome per key for this walk: fan-in resolves once. */
  resolutions: Map<string, TraversalNodeResolution>;
  /** Nodes already emitted, so fan-in does not emit a second node event. */
  emittedNodes: Set<string>;
  discoveryIndex: number;
  requests: number;
  unsupportedModules: Record<string, number>;
  events: GraphTraversalEventV1[];
  references: GraphReferenceV1[];
  nodes: number;
  edges: number;
}

export interface TraversalWalkOptions {
  rootUrl: string;
  lookup: TraversalAdapterLookup;
  resolve: TraversalNodeResolver;
  maxDepth: number;
  followCollections: boolean;
  includeGeneratedSummarySources: boolean;
}

export interface TraversalWalkOutcome {
  /** In emission order: per node, the node, then its edges, then its expansions. */
  events: GraphTraversalEventV1[];
  /** Root-level occurrence verdicts, in schedule order. */
  references: GraphReferenceV1[];
  summary: GraphTraversalSummaryV1;
}

/* ------------------------------------------------------------------------- *
 * The walk.
 * ------------------------------------------------------------------------- */

function compareSchedule(a: Occurrence, b: Occurrence): number {
  if (a.landingDepth !== b.landingDepth) return a.landingDepth - b.landingDepth;
  if (a.parentDiscoveryIndex !== b.parentDiscoveryIndex) return a.parentDiscoveryIndex - b.parentDiscoveryIndex;
  const rank = edgeGroupRank(a.planned.plan.edgeGroup) - edgeGroupRank(b.planned.plan.edgeGroup);
  if (rank !== 0) return rank;
  if (a.planned.plan.edgeGroup !== b.planned.plan.edgeGroup) {
    if (a.planned.adapter.moduleId !== b.planned.adapter.moduleId) {
      return a.planned.adapter.moduleId < b.planned.adapter.moduleId ? -1 : 1;
    }
    return a.planned.plan.edgeGroup < b.planned.plan.edgeGroup ? -1 : 1;
  }
  return a.planned.plan.index - b.planned.plan.index;
}

/** True when `key` is on the ancestor path of this very occurrence — a real cycle. */
function isOnAncestorPath(occurrence: Occurrence, key: string): boolean {
  if (occurrence.fromKey === key) return true;
  for (let current = occurrence.parent; current; current = current.parent) {
    if (current.fromKey === key) return true;
  }
  return false;
}

function edgeOf(occurrence: Occurrence, outcome: EdgeExpansionOutcomeV1, message?: string): GraphEdgeV1 {
  return {
    from: occurrence.fromKey,
    to: occurrence.targetKey,
    edgeGroup: occurrence.planned.plan.edgeGroup,
    index: occurrence.planned.plan.index,
    extensionField: occurrence.planned.extensionField,
    declaredTargetType: occurrence.planned.plan.declaredTargetType,
    outcome,
    ...(message ? { message } : {}),
  };
}

/**
 * Runs one walk to exhaustion, breadth-first over a queue ordered by the
 * schedule key `(depth, parentDiscoveryIndex, edgeGroupRank, edgeIndex)`.
 *
 * Emission order per node is `node` → its `edge`s → its `expansion`s, which is
 * the rule the streaming phase preserves once it resolves several targets
 * concurrently: order follows the schedule key, never completion timing.
 *
 * Budget exhaustion and abort are Phase 3/4 concerns; this phase always
 * terminates with `stopReason: "exhausted"`.
 */
export async function runTraversalWalk(
  root: string | EntityV1,
  options: TraversalWalkOptions
): Promise<TraversalWalkOutcome> {
  const state: GraphTraversalState = {
    expandedKeys: new Set(),
    resolutions: new Map(),
    emittedNodes: new Set(),
    discoveryIndex: 0,
    requests: 0,
    unsupportedModules: {},
    events: [],
    references: [],
    nodes: 0,
    edges: 0,
  };

  const queue: PendingNode[] = [await resolveRoot(root, options, state)];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const resolution = state.resolutions.get(node.key)!;

    if (!state.emittedNodes.has(node.key)) {
      state.emittedNodes.add(node.key);
      state.nodes += 1;
      state.events.push({ type: "node", node: buildNode(node, resolution) });
    }

    if (!node.expand || resolution.status !== "resolved" || !resolution.entity) continue;

    const plan = planNodeExpansions(
      resolution.entity,
      {
        depth: node.depth,
        nodeKey: node.key,
        followCollections: options.followCollections,
        includeGeneratedSummarySources: options.includeGeneratedSummarySources,
      },
      options.lookup
    );

    const scheduled: Occurrence[] = plan.edges.map((planned) => ({
      planned,
      fromKey: node.key,
      landingDepth: node.depth + 1,
      parentDiscoveryIndex: node.discoveryIndex,
      parent: node.via,
      targetKey: canonicalTargetKey(planned.plan.target.id, planned.plan.target.url),
    }));
    scheduled.sort(compareSchedule);

    for (const occurrence of scheduled) {
      state.edges += 1;
      const edge = await settleEdge(occurrence, options, state);
      state.events.push({ type: "edge", edge });
      if (node.depth === 0 && edge.status !== undefined) {
        state.references.push({
          index: edge.index,
          edgeGroup: edge.edgeGroup,
          key: edge.to,
          declaredTargetType: edge.declaredTargetType,
          status: edge.status,
          ...(edge.message ? { message: edge.message } : {}),
        });
      }
      // Every occurrence that reached a resolution contributes a node — a leaf
      // target and an unresolvable one are both real nodes of the graph — but
      // only a claimed expansion plans further edges.
      if (edge.status !== undefined) {
        state.discoveryIndex += 1;
        queue.push({
          key: occurrence.targetKey,
          depth: occurrence.landingDepth,
          discoveryIndex: state.discoveryIndex,
          expand: edge.outcome === "expanded",
          via: occurrence,
        });
      }
    }

    for (const expansion of plan.expansions) {
      if (expansion.outcome === "unsupported-module") {
        const declared = declaredModuleId(resolution.entity, expansion);
        if (declared) {
          state.unsupportedModules[declared] = (state.unsupportedModules[declared] ?? 0) + 1;
        }
      }
      state.events.push({ type: "expansion", expansion });
    }
  }

  return {
    events: state.events,
    references: state.references,
    summary: {
      stopReason: "exhausted",
      partial: false,
      nodes: state.nodes,
      edges: state.edges,
      requests: state.requests,
      unsupportedModules: state.unsupportedModules,
    },
  };
}

/** The declared module id of an extension traversal could not dispatch, for the summary tally. */
function declaredModuleId(entity: EntityV1, expansion: GraphExtensionExpansionV1): string | undefined {
  const payload = entity[expansion.extensionField];
  if (typeof payload !== "object" || payload === null) return undefined;
  const { module } = payload as { module?: unknown };
  return typeof module === "string" ? module : undefined;
}

function buildNode(node: PendingNode, resolution: TraversalNodeResolution): GraphNodeV1 {
  return {
    key: node.key,
    depth: node.depth,
    status: resolution.status,
    ...(resolution.entity ? { entity: resolution.entity } : {}),
    ...(resolution.message ? { message: resolution.message } : {}),
  };
}

/**
 * Decides one edge occurrence's fate, in the order the fates are checked:
 * depth first (it blocks before any lookup), then a real cycle, then an
 * already-expanded fan-in, and only then a resolution.
 *
 * The first three return an edge with NO `status`: nothing was ever attempted,
 * so no released resolution value is stretched to describe it. They are still
 * emitted at their scheduled position and still count in `summary.edges` —
 * they are real references on the wire.
 */
async function settleEdge(
  occurrence: Occurrence,
  options: TraversalWalkOptions,
  state: GraphTraversalState
): Promise<GraphEdgeV1> {
  if (occurrence.landingDepth > options.maxDepth) {
    return edgeOf(
      occurrence,
      "depth-limit",
      `Landing depth ${occurrence.landingDepth} exceeds maxDepth ${options.maxDepth}.`
    );
  }
  // `expandedKeys` proves "already expanded in this walk"; it does NOT prove a
  // cycle. In the diamond A→B→D, A→C→D the branch C→D meets an expanded D with
  // no path back to an ancestor, and labelling that a cycle would misreport the
  // topology. The ancestor walk is O(depth), bounded by maxDepth.
  if (isOnAncestorPath(occurrence, occurrence.targetKey)) {
    return edgeOf(occurrence, "cycle", "Target is on the ancestor path of this occurrence.");
  }
  if (state.expandedKeys.has(occurrence.targetKey)) {
    return edgeOf(occurrence, "already-expanded", "Target was already expanded on another branch of this walk.");
  }

  const target = occurrence.planned.plan.target;
  const resolution = await resolveKey(
    occurrence.targetKey,
    { url: target.url, declaredId: target.id, depth: occurrence.landingDepth },
    options,
    state
  );

  const settled = { ...edgeOf(occurrence, "expanded"), status: resolution.status };
  if (resolution.message) settled.message = resolution.message;

  if (resolution.status !== "resolved" || !resolution.entity) {
    return { ...settled, outcome: "not-expanded" };
  }

  // A type mismatch is a verdict for THIS occurrence only (the two-tier model):
  // the canonical node keeps the outcome every other reference to it sees, and
  // a reference that declared the wrong `target_type` is `invalid` on its own.
  const declaredType = occurrence.planned.plan.declaredTargetType;
  if (resolution.entity.type !== declaredType) {
    return {
      ...settled,
      status: "invalid",
      outcome: "not-expanded",
      message: `Reference declares target_type "${declaredType}" but the entity is of type "${resolution.entity.type}".`,
    };
  }

  if (!occurrence.planned.plan.expandable) {
    return { ...settled, outcome: "leaf" };
  }
  state.expandedKeys.add(occurrence.targetKey);
  return settled;
}

/** Resolves a canonical key at most once per walk — fan-in never fetches twice. */
async function resolveKey(
  key: string,
  request: TraversalNodeRequest,
  options: TraversalWalkOptions,
  state: GraphTraversalState
): Promise<TraversalNodeResolution> {
  const cached = state.resolutions.get(key);
  if (cached) return cached;
  state.requests += 1;
  const resolution = await options.resolve(request);
  state.resolutions.set(key, resolution);
  return resolution;
}

/**
 * Seeds the walk with the root node. An entity root is already resolved and
 * costs no request; a URL root is resolved through the same seam as any other
 * node. A root that fails to resolve still produces its node event — a walk
 * that reported nothing at all would be indistinguishable from an empty graph.
 */
async function resolveRoot(
  root: string | EntityV1,
  options: TraversalWalkOptions,
  state: GraphTraversalState
): Promise<PendingNode> {
  if (typeof root !== "string") {
    const key = canonicalTargetKey(root.id, options.rootUrl);
    state.resolutions.set(key, { status: "resolved", entity: root });
    state.expandedKeys.add(key);
    return { key, depth: 0, discoveryIndex: 0, expand: true };
  }

  state.requests += 1;
  const resolution = await options.resolve({ url: options.rootUrl, depth: 0 });
  const key = canonicalTargetKey(resolution.entity?.id ?? "", options.rootUrl);
  state.resolutions.set(key, resolution);
  const resolved = resolution.status === "resolved" && resolution.entity !== undefined;
  if (resolved) state.expandedKeys.add(key);
  return { key, depth: 0, discoveryIndex: 0, expand: resolved };
}

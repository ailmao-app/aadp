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
import { canonicalTargetKey, type RelationTargetV1 } from "../../modules/relations/v1.0/index.js";
import {
  planNodeExpansions,
  type NodeExpansionPlan,
  type PlannedTraversalCollection,
  type PlannedTraversalEdge,
} from "./edge-planner.js";
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
  /** The `target_type` the referring occurrence declared. Seeds the fetch; never the verdict. */
  declaredTargetType?: string;
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

export interface TraversalCollectionRequest {
  url: string;
  expectation: { sourceId: string; sourceType: string; rel: string; targetType: string };
  depth: number;
}

/**
 * Pages one relation collection, yielding its item hints in wire order (edge
 * matrix row 2). Backed by the released `iterateRelationCollection`, so cursor
 * cycles, page validation and per-hop accounting are the module's own — there
 * is no page limit here, because paging is bounded by the budget's six
 * dimensions alone (ADR-0011 §12.1).
 */
export type TraversalCollectionPager = (request: TraversalCollectionRequest) => AsyncIterable<RelationTargetV1>;

/* ------------------------------------------------------------------------- *
 * Edge group ranking (plan §"Ordering").
 * ------------------------------------------------------------------------- */

const RELATIONS_COLLECTION_EDGE_GROUP = "relations.collection";

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
  /**
   * Resolutions started but not yet settled, so a prefetch and the sequential
   * settle of the same key join ONE call instead of racing into two.
   */
  inFlight: Map<string, Promise<TraversalNodeResolution>>;
  /** Nodes already emitted, so fan-in does not emit a second node event. */
  emittedNodes: Set<string>;
  discoveryIndex: number;
  references: GraphReferenceV1[];
  progress: TraversalProgress;
  /**
   * Set once the budget is exhausted. From then on the walk plans no further
   * request: remaining scheduled edges settle as `budget-exhausted` and the
   * terminal summary says `budget`, so a partial graph is never reported as a
   * complete one.
   */
  stopReason?: "budget";
}

/**
 * Live counters of a walk in flight. Shared with the caller so a walk that is
 * aborted part-way can still report what it did before it stopped — a summary
 * only available on normal completion would leave every aborted walk claiming
 * zero work.
 */
export interface TraversalProgress {
  nodes: number;
  edges: number;
  requests: number;
  unsupportedModules: Record<string, number>;
}

export function createTraversalProgress(): TraversalProgress {
  return { nodes: 0, edges: 0, requests: 0, unsupportedModules: {} };
}

/** Freezes the current counters into a terminal summary. `partial` follows `stopReason`. */
export function summaryFrom(
  progress: TraversalProgress,
  stopReason: GraphTraversalSummaryV1["stopReason"]
): GraphTraversalSummaryV1 {
  return {
    stopReason,
    partial: stopReason !== "exhausted",
    nodes: progress.nodes,
    edges: progress.edges,
    requests: progress.requests,
    unsupportedModules: progress.unsupportedModules,
  };
}

/**
 * How many target resolutions may be in flight at once. An internal scheduling
 * constant, deliberately NOT a public option at 1.0 (ADR-0011 §12.2): it
 * changes only how fast a walk runs, never what it produces, and exposing it
 * would freeze an implementation detail into the SemVer surface.
 */
const FETCH_CONCURRENCY = 4;

export interface TraversalWalkOptions {
  rootUrl: string;
  lookup: TraversalAdapterLookup;
  resolve: TraversalNodeResolver;
  /** Absent means row 2 plans nothing — a walk with no way to page cannot follow a collection. */
  pageCollection?: TraversalCollectionPager;
  maxDepth: number;
  followCollections: boolean;
  includeGeneratedSummarySources: boolean;
  /** Counters the caller can read while the walk is still running. */
  progress?: TraversalProgress;
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
 * Walks the graph breadth-first over a queue ordered by the schedule key
 * `(depth, parentDiscoveryIndex, edgeGroupRank, edgeIndex)`, yielding each
 * event as soon as its position in that order is decided.
 *
 * Emission order per node is `node` → its `edge`s → its `expansion`s. Several
 * targets may be in flight at once (`prefetchBatch`), but an event is only ever
 * yielded at its scheduled position — completion timing never reorders the
 * stream, which is what makes the same input produce the same sequence.
 *
 * The generator is the backpressure boundary: nothing past the consumer's
 * current pull is computed, so a slow consumer slows the walk instead of
 * accumulating the graph in memory.
 *
 * Budget exhaustion is a Phase 4 concern; this walk ends `exhausted` and the
 * streaming layer above rewrites the terminal summary when it aborts.
 */
export async function* walkTraversal(
  root: string | EntityV1,
  options: TraversalWalkOptions
): AsyncGenerator<GraphTraversalEventV1, { summary: GraphTraversalSummaryV1; references: GraphReferenceV1[] }> {
  const state: GraphTraversalState = {
    expandedKeys: new Set(),
    resolutions: new Map(),
    inFlight: new Map(),
    emittedNodes: new Set(),
    discoveryIndex: 0,
    references: [],
    progress: options.progress ?? createTraversalProgress(),
  };

  const queue: PendingNode[] = [await resolveRoot(root, options, state)];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const resolution = state.resolutions.get(node.key)!;
    const expands = node.expand && resolution.status === "resolved" && resolution.entity !== undefined;

    // Planned BEFORE the node is emitted so the node itself can carry the
    // per-node diagnostics its public shape promises (`modules`, `expansions`).
    // The same planning result is then reused for the edge and expansion
    // events, so nothing is validated or planned twice.
    const plan = expands
      ? planNodeExpansions(
          resolution.entity!,
          {
            depth: node.depth,
            nodeKey: node.key,
            followCollections: options.followCollections,
            includeGeneratedSummarySources: options.includeGeneratedSummarySources,
          },
          options.lookup
        )
      : undefined;

    // The node is emitted straight after PURE planning — no network in between —
    // so a consumer sees it before any collection is paged. It carries a
    // SNAPSHOT of the expansion records: a collection failure discovered later
    // is amended onto the records the `expansion` events carry, never onto an
    // object already handed to the consumer.
    if (!state.emittedNodes.has(node.key)) {
      state.emittedNodes.add(node.key);
      state.progress.nodes += 1;
      yield { type: "node", node: buildNode(node, resolution, plan) };
    }

    if (!plan) continue;

    const occurrenceOf = (planned: PlannedTraversalEdge): Occurrence => ({
      planned,
      fromKey: node.key,
      landingDepth: node.depth + 1,
      parentDiscoveryIndex: node.discoveryIndex,
      parent: node.via,
      targetKey: canonicalTargetKey(planned.plan.target.id, planned.plan.target.url),
    });

    // Collection items rank between `relations.item` and every later group, so
    // the statically planned edges split around them: settle what ranks BEFORE
    // a collection, stream the collection's own items at their rank, then
    // settle the rest. Order is still exactly the schedule key's, but no page is
    // ever held in memory beyond the item being settled.
    const staticEdges = plan.edges.map(occurrenceOf).sort(compareSchedule);
    const collectionRank = edgeGroupRank(RELATIONS_COLLECTION_EDGE_GROUP);
    const before = staticEdges.filter((o) => edgeGroupRank(o.planned.plan.edgeGroup) < collectionRank);
    const after = staticEdges.filter((o) => edgeGroupRank(o.planned.plan.edgeGroup) >= collectionRank);
    prefetchBatch([...before, ...after], options, state);

    const scheduled: Occurrence[] = [
      ...before,
      ...(plan.collections.length > 0 ? [PAGE_COLLECTIONS_HERE] : []),
      ...after,
    ];

    for (const occurrence of scheduled) {
      if (occurrence === PAGE_COLLECTIONS_HERE) {
        for await (const item of pageCollections(plan.collections, node, options, state, plan.expansions)) {
          const settled = occurrenceOf(item);
          state.progress.edges += 1;
          const edge = await settleEdge(settled, options, state);
          yield { type: "edge", edge };
          yield* emitDiscovery(settled, edge, node, state, queue);
        }
        continue;
      }
      state.progress.edges += 1;
      const edge = await settleEdge(occurrence, options, state);
      yield { type: "edge", edge };
      yield* emitDiscovery(occurrence, edge, node, state, queue);
    }

    for (const expansion of plan.expansions) {
      if (expansion.outcome === "unsupported-module") {
        const declared = declaredModuleId(resolution.entity!, expansion);
        if (declared) {
          state.progress.unsupportedModules[declared] = (state.progress.unsupportedModules[declared] ?? 0) + 1;
        }
      }
      yield { type: "expansion", expansion };
    }

    // Reported everything this node had to say; a budget stop ends the walk
    // here rather than dequeuing work it can no longer pay for.
    if (state.stopReason === "budget") break;
  }

  return { references: state.references, summary: summaryFrom(state.progress, state.stopReason ?? "exhausted") };
}

/**
 * Drains `walkTraversal` into one outcome. The streaming entry point uses the
 * generator directly; this is for callers that want the whole walk at once.
 */
export async function runTraversalWalk(
  root: string | EntityV1,
  options: TraversalWalkOptions
): Promise<TraversalWalkOutcome> {
  const events: GraphTraversalEventV1[] = [];
  const walk = walkTraversal(root, options);
  let step = await walk.next();
  while (!step.done) {
    events.push(step.value);
    step = await walk.next();
  }
  return { events, references: step.value.references, summary: step.value.summary };
}

/**
 * Pages every collection this node planned, turning each page item into a
 * candidate edge of the `relations.collection` group.
 *
 * `index` runs across the whole edge group for this node — items of the first
 * collection, then the second — so a consumer can trace an edge back to its
 * position in the paged sequence. Budget exhaustion while paging ends the walk
 * exactly as it does for any other request, and keeps the items already read.
 */
async function* pageCollections(
  collections: readonly PlannedTraversalCollection[],
  node: PendingNode,
  options: TraversalWalkOptions,
  state: GraphTraversalState,
  expansions: GraphExtensionExpansionV1[]
): AsyncGenerator<PlannedTraversalEdge> {
  const pager = options.pageCollection;
  const failures: CollectionFailure[] = [];
  if (!pager || collections.length === 0) return;

  let index = 0;
  for (const collection of collections) {
    if (state.stopReason === "budget") break;
    try {
      for await (const target of pager({
        url: collection.url,
        expectation: collection.expectation,
        depth: node.depth,
      })) {
        // Yielded one at a time: the caller settles and emits each item before
        // the next is read, so a large collection never sits in memory and a
        // consumer sees edges while later pages are still arriving.
        //
        // Not counted in `progress.requests`: that counter tracks canonical
        // target resolutions, and one page carries many items. The authoritative
        // per-hop count is the budget's own, charged inside the released client.
        yield {
          extensionField: collection.extensionField,
          adapter: collection.adapter,
          plan: {
            edgeGroup: collection.edgeGroup,
            index: index++,
            target,
            declaredTargetType: collection.declaredTargetType,
            expandable: true,
          },
        };
      }
    } catch (err) {
      // A budget stop is global — the walk may make no further request at all —
      // and an abort is the caller's own decision, so both propagate.
      if (isBudgetStop(err)) {
        state.stopReason = "budget";
        break;
      }
      if (isAbortStop(err)) throw err;

      // Anything else (404, blocked URL, malformed page, cursor cycle) stops
      // this ONE collection and is reported on the expansion record that owns
      // it. It must never be dropped silently: a consumer would otherwise
      // receive a graph missing a whole branch with nothing to diagnose or
      // retry. `plannedEdges` keeps counting only the items actually read.
      failures.push({
        extensionField: collection.extensionField,
        url: collection.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Amended onto the records the `expansion` EVENTS carry, which are emitted
  // after this node's edges — never onto the node snapshot already delivered.
  attachCollectionFailures(expansions, failures);
}

/**
 * Marks the position in a node's schedule where its collections are paged.
 * Collection items all rank together, so one marker is enough — and using a
 * marker rather than a pre-materialized list is what lets the items be streamed.
 */
const PAGE_COLLECTIONS_HERE = Symbol("page-collections") as unknown as Occurrence;

/**
 * Emits what a settled edge discovered: the root-level `reference` view of the
 * occurrence, and the queue entry for its target.
 *
 * A root-level occurrence that reached a verdict is also a `reference` — the
 * root's own references are what a consumer of a single entity asks for, and
 * they carry the same per-occurrence status. A blocked occurrence has no
 * verdict, so it produces neither a reference nor a node.
 */
function* emitDiscovery(
  occurrence: Occurrence,
  edge: GraphEdgeV1,
  node: PendingNode,
  state: GraphTraversalState,
  queue: PendingNode[]
): Generator<GraphTraversalEventV1> {
  if (edge.status === undefined) return;

  if (node.depth === 0) {
    const reference: GraphReferenceV1 = {
      index: edge.index,
      edgeGroup: edge.edgeGroup,
      key: edge.to,
      declaredTargetType: edge.declaredTargetType,
      status: edge.status,
      ...(edge.message ? { message: edge.message } : {}),
    };
    state.references.push(reference);
    yield { type: "reference", reference };
  }

  // Every occurrence that reached a resolution contributes a node — a leaf
  // target and an unresolvable one are both real nodes of the graph — but only
  // a claimed expansion plans further edges.
  state.discoveryIndex += 1;
  queue.push({
    key: occurrence.targetKey,
    depth: occurrence.landingDepth,
    discoveryIndex: state.discoveryIndex,
    expand: edge.outcome === "expanded",
    via: occurrence,
  });
}

/** One collection that could not be paged, reported on its own extension's record. */
interface CollectionFailure {
  extensionField: `x_${string}`;
  url: string;
  message: string;
}

/**
 * Folds collection failures into the expansion records of the extensions that
 * owned them. The record's `outcome` is untouched — the extension really did
 * parse and really did plan a collection; what failed is one reference inside
 * it, which is exactly what `message` is for.
 */
function attachCollectionFailures(
  expansions: GraphExtensionExpansionV1[],
  failures: readonly CollectionFailure[]
): void {
  for (const failure of failures) {
    const record = expansions.find((expansion) => expansion.extensionField === failure.extensionField);
    if (!record) continue;
    const note = `collection ${failure.url} could not be paged: ${failure.message}`;
    record.message = record.message ? `${record.message}; ${note}` : note;
  }
}

function isBudgetStop(err: unknown): boolean {
  return err instanceof Error && err.name === "AadpDiscoveryBudgetExceededError";
}

function isAbortStop(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortedError" || err.name === "AbortError");
}

/** The declared module id of an extension traversal could not dispatch, for the summary tally. */
function declaredModuleId(entity: EntityV1, expansion: GraphExtensionExpansionV1): string | undefined {
  const payload = entity[expansion.extensionField];
  if (typeof payload !== "object" || payload === null) return undefined;
  const { module } = payload as { module?: unknown };
  return typeof module === "string" ? module : undefined;
}

/**
 * A node carries the per-node view of what traversal saw on it: every `x_*`
 * with a readable module envelope, and one expansion record per extension.
 * Both are absent on a node that was never expanded — a leaf or an unresolvable
 * target has no extension story to tell, and an empty list would claim it does.
 */
function buildNode(
  node: PendingNode,
  resolution: TraversalNodeResolution,
  plan?: NodeExpansionPlan
): GraphNodeV1 {
  return {
    key: node.key,
    depth: node.depth,
    status: resolution.status,
    ...(resolution.entity ? { entity: resolution.entity } : {}),
    ...(plan && plan.modules.length > 0 ? { modules: [...plan.modules] } : {}),
    // A COPY, not the live records. What the node states is the result of pure
    // planning at the moment it was emitted; a runtime diagnostic discovered
    // later (a collection that could not be paged) belongs to the `expansion`
    // events that follow, not to an object the consumer already holds.
    ...(plan && plan.expansions.length > 0 ? { expansions: plan.expansions.map((e) => ({ ...e })) } : {}),
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
  // Once the budget is gone every remaining occurrence is still reported — it
  // is a real reference on the wire — but nothing else is ever requested.
  if (state.stopReason === "budget") {
    return edgeOf(occurrence, "budget-exhausted", "The traversal budget was exhausted before this edge was tried.");
  }
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
    {
      url: target.url,
      declaredId: target.id,
      declaredTargetType: occurrence.planned.plan.declaredTargetType,
      depth: occurrence.landingDepth,
    },
    options,
    state
  );

  const settled = { ...edgeOf(occurrence, "expanded"), status: resolution.status };
  if (resolution.message) settled.message = resolution.message;

  if (resolution.status === "budget-exhausted") {
    // This occurrence WAS attempted, so it keeps its resolution status; the
    // walk stops after the node it is part of finishes reporting.
    state.stopReason = "budget";
    return { ...settled, outcome: "not-expanded" };
  }
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
function resolveKey(
  key: string,
  request: TraversalNodeRequest,
  options: TraversalWalkOptions,
  state: GraphTraversalState
): Promise<TraversalNodeResolution> {
  const cached = state.resolutions.get(key);
  if (cached) return Promise.resolve(cached);
  const started = state.inFlight.get(key);
  if (started) return started;

  state.progress.requests += 1;
  const pending = Promise.resolve(options.resolve(request)).then((resolution) => {
    state.resolutions.set(key, resolution);
    state.inFlight.delete(key);
    return resolution;
  });
  pending.catch(() => state.inFlight.delete(key));
  state.inFlight.set(key, pending);
  return pending;
}

/**
 * Starts up to `FETCH_CONCURRENCY` resolutions for the occurrences this node is
 * about to settle, so several targets are in flight while the walk still
 * settles them strictly in schedule order.
 *
 * Only occurrences that pass the pre-fetch guards are started, and only one per
 * distinct canonical key — exactly the set a sequential walk would have
 * fetched. Nothing here can change a classification: depth and the ancestor
 * path are fixed for the batch, and an expansion claim made mid-batch can only
 * block another occurrence with the SAME key, which the dedup already collapsed
 * into the one fetch it would have made anyway.
 */
function prefetchBatch(
  scheduled: readonly Occurrence[],
  options: TraversalWalkOptions,
  state: GraphTraversalState
): void {
  const queue: Occurrence[] = [];
  const seen = new Set<string>();
  for (const occurrence of scheduled) {
    if (occurrence.landingDepth > options.maxDepth) continue;
    if (isOnAncestorPath(occurrence, occurrence.targetKey)) continue;
    if (state.expandedKeys.has(occurrence.targetKey)) continue;
    if (state.resolutions.has(occurrence.targetKey) || state.inFlight.has(occurrence.targetKey)) continue;
    if (seen.has(occurrence.targetKey)) continue;
    seen.add(occurrence.targetKey);
    queue.push(occurrence);
  }

  let active = 0;
  const pump = (): void => {
    while (active < FETCH_CONCURRENCY && queue.length > 0) {
      const occurrence = queue.shift()!;
      const target = occurrence.planned.plan.target;
      active += 1;
      const done = (): void => {
        active -= 1;
        pump();
      };
      // The awaiting `settleEdge` owns the outcome and any rejection; this
      // handle exists only to keep the pool at its concurrency limit.
      resolveKey(
        occurrence.targetKey,
        {
          url: target.url,
          declaredId: target.id,
          declaredTargetType: occurrence.planned.plan.declaredTargetType,
          depth: occurrence.landingDepth,
        },
        options,
        state
      ).then(done, done);
    }
  };
  pump();
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

  state.progress.requests += 1;
  const resolution = await options.resolve({ url: options.rootUrl, depth: 0 });
  const key = canonicalTargetKey(resolution.entity?.id ?? "", options.rootUrl);
  state.resolutions.set(key, resolution);
  const resolved = resolution.status === "resolved" && resolution.entity !== undefined;
  if (resolution.status === "budget-exhausted") state.stopReason = "budget";
  if (resolved) state.expandedKeys.add(key);
  return { key, depth: 0, discoveryIndex: 0, expand: resolved };
}

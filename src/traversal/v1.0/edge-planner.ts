/**
 * Capability negotiation and the validation phase for ONE resolved node
 * (ADR-0011 §2/§2a/§5, plan 1.5.0 §"Validation phase" and
 * §"Capability negotiation").
 *
 * Pure: no fetch, no budget, no clock. It turns an already-resolved entity into
 * the expansion records and the candidate edges for that entity; deciding each
 * edge's fate (depth, cycles, already-expanded) and paging collections belongs
 * to the scheduler.
 */
import type { EntityV1 } from "../../client/v1.0/index.js";
import type { TraversalAdapterLookup } from "./registry.js";
import type {
  GraphExtensionExpansionV1,
  TraversalAdapter,
  TraversalAdapterKey,
  TraversalEdgePlan,
  TraversalPlanContext,
} from "./types.js";

/** One candidate edge, tied back to the extension and adapter that planned it. */
export interface PlannedTraversalEdge {
  extensionField: `x_${string}`;
  adapter: TraversalAdapterKey;
  plan: TraversalEdgePlan;
}

/**
 * A paginated collection an adapter found, for the scheduler to page (edge
 * matrix row 2).
 *
 * A collection link carries a page URL and no target identity, and its edges
 * are one per item of each fetched page — producing them takes a request, which
 * a pure adapter may not make. So the adapter reports WHERE the collection is
 * and the scheduler decides whether and how far to page it.
 */
export interface TraversalCollectionPlan {
  edgeGroup: string;
  url: string;
  declaredTargetType: string;
  /** What every item of this collection must agree with — checked by the released client. */
  expectation: { sourceId: string; sourceType: string; rel: string; targetType: string };
}

export interface PlannedTraversalCollection extends TraversalCollectionPlan {
  extensionField: `x_${string}`;
  adapter: TraversalAdapterKey;
}

/**
 * INTERNAL capability, feature-detected on an adapter. Deliberately not part of
 * the public `TraversalAdapter` contract frozen by ADR-0011: row 2 belongs to
 * the Relations module alone at `1.0`, and widening the public adapter surface
 * for it would freeze a second method into the SemVer surface for a case no
 * third-party adapter has yet.
 */
export interface CollectionPlanningAdapter<TDoc = unknown> {
  planCollections(document: TDoc, entity: EntityV1, context: TraversalPlanContext): TraversalCollectionPlan[];
}

function asCollectionPlanner(adapter: TraversalAdapter): CollectionPlanningAdapter | undefined {
  const candidate = adapter as Partial<CollectionPlanningAdapter>;
  return typeof candidate.planCollections === "function" ? (candidate as CollectionPlanningAdapter) : undefined;
}

export interface NodeExpansionPlan {
  /** One record per `x_*` field on the entity, in extension-field name order. */
  expansions: GraphExtensionExpansionV1[];
  /** Candidate edges in the order their adapters produced them. */
  edges: PlannedTraversalEdge[];
  /** Collections for the scheduler to page, in the order their adapters found them. */
  collections: PlannedTraversalCollection[];
  /** Every `x_*` carrying a readable module envelope, by adapter key rank. */
  modules: Array<{ id: string; version: string; extensionField: `x_${string}` }>;
}

/**
 * Code-point ordering, not UTF-16 code-unit ordering. `String.prototype
 * .localeCompare` is locale-dependent and `<` compares code units, either of
 * which could order two extension fields differently on two runtimes — and the
 * whole point of sorting here is that two deployments produce the same event
 * sequence.
 */
function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const diff = (left[i]!.codePointAt(0) ?? 0) - (right[i]!.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function isExtensionField(key: string): key is `x_${string}` {
  return key.startsWith("x_");
}

/**
 * The module envelope an extension declares about itself. Returns `undefined`
 * when the value is not an object or does not carry both strings — such a field
 * has no key to look up, which is `unsupported-module` for that field alone and
 * never an error of the entity.
 */
function readEnvelope(value: unknown): { module: string; version: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { module, version } = value as { module?: unknown; version?: unknown };
  if (typeof module !== "string" || typeof version !== "string") return undefined;
  return { module, version };
}

function expansionKey(nodeKey: string, extensionField: string): string {
  return `${nodeKey}#${extensionField}`;
}

/**
 * Runs negotiation + validation + planning for every extension on `entity`,
 * one extension at a time.
 *
 * Extensions are processed in extension-field NAME order (code-point), never in
 * JSON property order: a field with no valid module envelope has no
 * `moduleId`/`moduleVersion` to rank by, so adapter key rank is not a total
 * order over the set, while field names always are. Two entities that serialize
 * the same extensions in a different order therefore produce the same records.
 *
 * Each extension's outcome is scoped to itself: an unsupported or malformed
 * extension stops only its own adapter, and every other adapter on the entity
 * still plans its edges. Nothing here stops the whole node — only budget
 * exhaustion or abort does, and both belong to the scheduler.
 */
export function planNodeExpansions(
  entity: EntityV1,
  context: TraversalPlanContext,
  lookup: TraversalAdapterLookup
): NodeExpansionPlan {
  const fields = Object.keys(entity)
    .filter(isExtensionField)
    .sort(compareCodePoints);

  const expansions: GraphExtensionExpansionV1[] = [];
  const edges: PlannedTraversalEdge[] = [];
  const collections: PlannedTraversalCollection[] = [];
  const modules: NodeExpansionPlan["modules"] = [];

  for (const field of fields) {
    const key = expansionKey(context.nodeKey, field);
    const envelope = readEnvelope(entity[field]);
    if (envelope) {
      modules.push({ id: envelope.module, version: envelope.version, extensionField: field });
    }

    const adapterKey: TraversalAdapterKey | undefined = envelope
      ? { moduleId: envelope.module, moduleVersion: envelope.version, extensionField: field }
      : undefined;
    const adapter: TraversalAdapter | undefined = adapterKey ? lookup(adapterKey) : undefined;

    if (!adapter) {
      expansions.push({
        key,
        extensionField: field,
        outcome: "unsupported-module",
        plannedEdges: 0,
        message: envelope
          ? `No traversal adapter registered for "${envelope.module}@${envelope.version}" field "${field}".`
          : `Extension "${field}" declares no module envelope traversal can dispatch on.`,
      });
      continue;
    }

    const parsed = adapter.parseExtension(entity);
    if (!parsed.ok) {
      // Both validator channels are carried through: a schema-only failure
      // populates `errors` and leaves `semanticIssues` empty, so merging them
      // would leave `invalid-extension` with no stated reason.
      expansions.push({
        key,
        extensionField: field,
        adapter: adapter.key,
        outcome: "invalid-extension",
        plannedEdges: 0,
        errors: parsed.errors,
        semanticIssues: parsed.semanticIssues,
      });
      continue;
    }

    const plans = adapter.planEdges(parsed.document, entity, context);
    for (const plan of plans) {
      edges.push({ extensionField: field, adapter: adapter.key, plan });
    }

    const planner = asCollectionPlanner(adapter);
    const planned = planner ? planner.planCollections(parsed.document, entity, context) : [];
    for (const collection of planned) {
      collections.push({ ...collection, extensionField: field, adapter: adapter.key });
    }

    // A collection is planned work even before it is paged, so an extension
    // whose only output is a collection is `planned`, not `no-edges` — the
    // alternative would report "this extension had nothing to expand" about an
    // extension that is about to produce edges.
    const plannedEdges = plans.length + planned.length;
    expansions.push({
      key,
      extensionField: field,
      adapter: adapter.key,
      outcome: plannedEdges > 0 ? "planned" : "no-edges",
      plannedEdges,
    });
  }

  modules.sort(
    (a, b) =>
      compareCodePoints(a.id, b.id) ||
      compareCodePoints(a.version, b.version) ||
      compareCodePoints(a.extensionField, b.extensionField)
  );

  return { expansions, edges, collections, modules };
}

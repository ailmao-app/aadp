/**
 * Public type surface of `ail-aadp/traversal/v1.0` (ADR-0011, implementation
 * plan 1.5.0 §"Typed API contract").
 *
 * These declarations were frozen by the Phase 0 type gate
 * (`tests/types/traversal-api.test-d.ts`) before ADR-0011 was Accepted; Phase 1
 * moves them here unchanged, so the fixture now asserts against the real types
 * instead of a copy of them.
 *
 * Boundary rules this file keeps:
 * - types only, no runtime code and no value exports;
 * - the node status vocabulary is the RELEASED one, re-exported, never widened;
 * - `GraphTraversalState` is internal and appears in no declaration here.
 */
import type { EntityV1, ManifestV1, RetryOptions, UrlPolicy } from "../../client/v1.0/index.js";
import type { ModuleSemanticIssue } from "../../module-registry/index.js";
import type { CheckResult, ConformanceSummary } from "../../conformance/index.js";
import type {
  RelationTargetV1,
  RelationsClientOptions,
  RelationsTraversalBudgetState,
} from "../../modules/relations/v1.0/index.js";
import type { AnswerTargetResolutionStatus } from "../../modules/answer/v1.0/index.js";

/* ------------------------------------------------------------------------- *
 * Outcome vocabularies — three scopes, three enums (ADR-0011 §4).
 * ------------------------------------------------------------------------- */

/** EXTENSION scope: could the adapter run at all. */
export type ExtensionExpansionOutcomeV1 =
  | "planned"
  | "no-edges"
  | "unsupported-module"
  | "invalid-extension";

/** EDGE scope: what happened to this one occurrence. */
export type EdgeExpansionOutcomeV1 =
  | "expanded"
  | "leaf"
  | "depth-limit"
  | "cycle"
  | "already-expanded"
  | "not-expanded"
  | "budget-exhausted";

/** NODE scope: the RELEASED vocabulary, no sixth value (ADR-0011 §4). */
export type GraphNodeStatusV1 = AnswerTargetResolutionStatus;

/* ------------------------------------------------------------------------- *
 * Adapter contract.
 * ------------------------------------------------------------------------- */

export interface TraversalAdapterKey {
  /** Namespaced module id, same grammar as the module registry's `MODULE_ID_PATTERN`. */
  moduleId: string;
  /** Module wire version, exact match. No ranges, no fallback. */
  moduleVersion: string;
  /** The entity extension field this adapter reads, e.g. `"x_evidence"`. */
  extensionField: `x_${string}`;
}

export interface TraversalAdapterCapabilities {
  /**
   * Entity `type` values this adapter accepts as the source of an edge.
   * Informational metadata for consumers: what actually rejects a wrong source
   * type is the module's own released validator in `parseExtension`. The single
   * element `"*"` means "any entity type" — the Relations case, where the wire
   * contract puts `x_relations` on entities of any type.
   */
  sourceKinds: readonly string[];
  /** Edge groups this adapter emits — used for ordering, see plan §"Ordering". */
  edgeGroups: readonly string[];
  /** Whether edges from this adapter ever lead to a request. A leaf-only adapter (`false`) is valid. */
  fetchesTargets: boolean;
}

/**
 * Keeps BOTH channels the released validators return
 * (`AnswerEntityValidationResult` and `EvidenceEntityValidationResult` are each
 * `{ valid, errors: unknown[], semanticIssues }`). Merging them into one issue
 * list would turn a schema-only failure into an empty list, leaving
 * `invalid-extension` with no stated reason (ADR-0011 §2).
 */
export type TraversalParseResult<TDoc> =
  | { ok: true; document: TDoc }
  | { ok: false; errors: unknown[]; semanticIssues: ModuleSemanticIssue[] };

/**
 * Read-only context the scheduler passes to `planEdges`. Carries only what an
 * adapter needs to decide which edges to plan — the two flags below are the
 * conditions of rows 2 and 4 of the edge matrix. It carries no budget, no walk
 * state, and nothing that would let an adapter fetch or charge.
 */
export interface TraversalPlanContext {
  /** Depth of the source node. An edge's landing depth is `depth + 1`. */
  depth: number;
  /** Canonical key of the source node. */
  nodeKey: string;
  /** Effective value of `options.followCollections` (default `false`). */
  followCollections: boolean;
  /** Effective value of `options.includeGeneratedSummarySources` (default `false`). */
  includeGeneratedSummarySources: boolean;
}

export interface TraversalEdgePlan {
  edgeGroup: string;
  /** Index in the originating wire array, for traceability. */
  index: number;
  target: RelationTargetV1;
  /** The `target_type` this very occurrence declares. */
  declaredTargetType: string;
  /** `false` = the target is a leaf by the module's own definition (never expanded). */
  expandable: boolean;
}

export interface TraversalAdapter<TDoc = unknown> {
  readonly key: TraversalAdapterKey;
  readonly capabilities: TraversalAdapterCapabilities;
  /**
   * MANDATORY step before `planEdges`. Validates the entity's extension payload
   * with the EXACT released validator of that module version
   * (`validateAnswerEntityV1`, `validateEvidenceEntityV1`, …) and returns a typed
   * document, or the issue lists. Pure: MUST NOT fetch, charge or read the clock.
   *
   * An adapter MUST NOT invent validation behavior of its own — it calls the
   * module client's public validator, so traversal never accepts a payload a
   * standalone module client would reject.
   */
  parseExtension(entity: EntityV1): TraversalParseResult<TDoc>;
  /**
   * Called ONLY when `parseExtension` returned `ok: true`, and receives the
   * VALIDATED document, never `unknown`. Returns candidate edges in wire input
   * order. Pure: MUST NOT fetch, charge the budget or read the clock.
   */
  planEdges(document: TDoc, entity: EntityV1, context: TraversalPlanContext): TraversalEdgePlan[];
}

/* ------------------------------------------------------------------------- *
 * Graph shapes.
 * ------------------------------------------------------------------------- */

export interface GraphNodeV1<T = unknown> {
  /** Canonical `{id, normalizedUrl}` key. */
  key: string;
  depth: number;
  status: GraphNodeStatusV1;
  entity?: EntityV1<T>;
  /** Every `x_*` traversal saw on this entity, by adapter key rank. */
  modules?: Array<{ id: string; version: string; extensionField: `x_${string}` }>;
  /**
   * ONE record per extension, never one outcome for the whole node (ADR-0011
   * §2a). Edge fates stay on `GraphEdgeV1.outcome`.
   */
  expansions?: GraphExtensionExpansionV1[];
  message?: string;
}

export interface GraphExtensionExpansionV1 {
  /** Stable identity of one node's one extension: `` `${nodeKey}#${extensionField}` ``. */
  key: string;
  extensionField: `x_${string}`;
  adapter?: TraversalAdapterKey;
  outcome: ExtensionExpansionOutcomeV1;
  plannedEdges: number;
  errors?: unknown[];
  semanticIssues?: ModuleSemanticIssue[];
  message?: string;
}

export interface GraphEdgeV1 {
  from: string;
  to: string;
  edgeGroup: string;
  index: number;
  /** The extension field that planned this edge — links it back to its expansion record. */
  extensionField: `x_${string}`;
  declaredTargetType: string;
  /** Absent when the edge was never attempted (depth-limit/cycle/already-expanded/budget). */
  status?: GraphNodeStatusV1;
  outcome: EdgeExpansionOutcomeV1;
  message?: string;
}

export interface GraphReferenceV1 {
  index: number;
  edgeGroup: string;
  key: string;
  declaredTargetType: string;
  status: GraphNodeStatusV1;
  message?: string;
}

export interface GraphTraversalSummaryV1 {
  /** How the scheduler finished. `"exhausted"` = it ran out of scheduled work. */
  stopReason: "exhausted" | "budget" | "aborted";
  /**
   * Whether the graph is missing anything the walk set out to produce —
   * INDEPENDENT of `stopReason` (ADR-0011 §9). True for a budget stop, for an
   * abort, and for a recoverable branch failure such as a collection that could
   * not be paged, where the scheduler still exhausts its queue. Never infer
   * completeness from `stopReason` alone.
   */
  partial: boolean;
  nodes: number;
  edges: number;
  /**
   * Number of logical canonical-target resolutions started by this walk.
   *
   * Excludes cache hits, in-flight joins, collection-page fetches, retries and
   * redirect hops. For physical HTTP attempts, inspect the caller-owned
   * `budget.requestsMade` counter.
   */
  requests: number;
  unsupportedModules: Record<string, number>;
}

export type GraphTraversalEventV1 =
  | { type: "node"; node: GraphNodeV1 }
  | { type: "reference"; reference: GraphReferenceV1 }
  | { type: "edge"; edge: GraphEdgeV1 }
  | { type: "expansion"; expansion: GraphExtensionExpansionV1 }
  | { type: "complete"; summary: GraphTraversalSummaryV1 };

export interface CrossModuleGraphV1<T = unknown> {
  nodes: GraphNodeV1<T>[];
  references: GraphReferenceV1[];
  edges: GraphEdgeV1[];
  expansions: GraphExtensionExpansionV1[];
  summary: GraphTraversalSummaryV1;
}

/* ------------------------------------------------------------------------- *
 * Options.
 * ------------------------------------------------------------------------- */

export interface GraphTraversalOptions extends RelationsClientOptions {
  /** Caller-owned, borrowed by traversal (ADR-0011 §10). Required. */
  budget: RelationsTraversalBudgetState;
  /** Replaces the global registry for this call only — never merged with it. */
  adapters?: readonly TraversalAdapter[];
  /** Allowlist: an adapter outside it is treated as absent (`unsupported-module`). */
  capabilities?: ReadonlyArray<{ moduleId: string; version: string }>;
  /**
   * Root identity: the canonical key AND cross-origin accounting. Required when
   * the root is an entity without `canonical_url`. Never fetched.
   */
  rootUrl?: string;
  /** Manifest `modules[]` fetched by the CALLER, used for the summary only. Traversal never fetches a manifest. */
  declaredModules?: ManifestV1["modules"];
  includeGeneratedSummarySources?: boolean; // default false
  followCollections?: boolean; // default false (ADR-0011 §12.1)
  maxBufferedEvents?: number; // default 256
}

/**
 * The common intersection of the three released runners' option types, minus the
 * six standalone traversal limits (they go through `budget`) and the fields that
 * are specific to one module. A profile composing three modules has to run under
 * the same deployment conventions they do.
 */
export interface GraphTraversalConformanceOptions {
  baseUrl?: string;
  sampleRootUrl?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  retry?: RetryOptions;
  allowPrivateNetwork?: boolean;
  urlPolicy?: UrlPolicy;
  headers?: Record<string, string>;
  crossOriginSafeHeaders?: string[];
  /** Caller-owned. Replaces ONLY the six standalone limit fields (ADR-0011 §10). */
  budget?: RelationsTraversalBudgetState;
  failOnWarning?: boolean;
  onCheck?: (result: CheckResult) => void;
  signal?: AbortSignal;
}

export interface GraphTraversalConformanceReport {
  report_version: "1";
  aadp_version: "1.0";
  /** `profile`, not `module` — this is a profile over three modules. */
  profile: { id: "aadp:graph-traversal"; version: "1.0" };
  package_version: string;
  base_url?: string;
  runner: { name: string; version: string };
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: "passed" | "failed" | "inconclusive";
  summary: ConformanceSummary;
  effective_limits: Record<string, number>;
  checks: CheckResult[];
}

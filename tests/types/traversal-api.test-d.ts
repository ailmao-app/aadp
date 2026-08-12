/**
 * Phase 0 type gate for `ail-aadp/traversal/v1.0` (ADR-0011).
 *
 * This file is TYPE-ONLY. It declares the proposed public surface and proves it
 * compiles against the RELEASED types of Relations/Answer/Evidence `1.0` before
 * ADR-0011 is Accepted. It is the single artifact the ADR's Status section
 * permits before acceptance, together with its `tsconfig.json` and the
 * `test:types` script.
 *
 * Rules this file MUST keep:
 * - no runtime code — every value is `declare`d, nothing is constructed;
 * - no import from `src/traversal/**` — that directory must not exist yet;
 * - no stub implementation created merely to make an assertion pass.
 *
 * When Phase 1 lands the real module, the declarations below are replaced by an
 * `import type { ... } from "../../src/traversal/v1.0/index.js"` and every
 * assertion here must still hold unchanged.
 */

import type { EntityV1, ManifestV1, RetryOptions, UrlPolicy } from "../../src/client/v1.0/index.js";
import type { ModuleSemanticIssue } from "../../src/module-registry/index.js";
import type { CheckResult, ConformanceSummary } from "../../src/conformance/index.js";
import type {
  RelationTargetV1,
  RelationsClientOptions,
  RelationsTraversalBudgetState,
} from "../../src/modules/relations/v1.0/index.js";
import type { AnswerTargetResolutionStatus } from "../../src/modules/answer/v1.0/index.js";

/* ------------------------------------------------------------------------- *
 * Proposed public surface — ADR-0011 §1-12, plan §"Typed API contract".
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

export interface TraversalAdapterKey {
  moduleId: string;
  moduleVersion: string;
  extensionField: `x_${string}`;
}

export interface TraversalAdapterCapabilities {
  sourceKinds: readonly string[];
  edgeGroups: readonly string[];
  fetchesTargets: boolean;
}

/** Both validator channels are kept separate (ADR-0011 §2). */
export type TraversalParseResult<TDoc> =
  | { ok: true; document: TDoc }
  | { ok: false; errors: unknown[]; semanticIssues: ModuleSemanticIssue[] };

export interface TraversalPlanContext {
  depth: number;
  nodeKey: string;
  followCollections: boolean;
  includeGeneratedSummarySources: boolean;
}

export interface TraversalEdgePlan {
  edgeGroup: string;
  index: number;
  target: RelationTargetV1;
  declaredTargetType: string;
  expandable: boolean;
}

export interface TraversalAdapter<TDoc = unknown> {
  readonly key: TraversalAdapterKey;
  readonly capabilities: TraversalAdapterCapabilities;
  parseExtension(entity: EntityV1): TraversalParseResult<TDoc>;
  planEdges(document: TDoc, entity: EntityV1, context: TraversalPlanContext): TraversalEdgePlan[];
}

export interface GraphNodeV1<T = unknown> {
  key: string;
  depth: number;
  status: GraphNodeStatusV1;
  entity?: EntityV1<T>;
  modules?: Array<{ id: string; version: string; extensionField: `x_${string}` }>;
  /**
   * ONE record per extension, never one outcome for the whole node (ADR-0011
   * §2a). Edge fates stay on `GraphEdgeV1.outcome`.
   */
  expansions?: GraphExtensionExpansionV1[];
  message?: string;
}

export interface GraphExtensionExpansionV1 {
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
  stopReason: "exhausted" | "budget" | "aborted";
  partial: boolean;
  nodes: number;
  edges: number;
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

export interface GraphTraversalOptions extends RelationsClientOptions {
  /** Caller-owned, borrowed by traversal (ADR-0011 §10). Required. */
  budget: RelationsTraversalBudgetState;
  adapters?: readonly TraversalAdapter[];
  capabilities?: ReadonlyArray<{ moduleId: string; version: string }>;
  rootUrl?: string;
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

export declare function registerBuiltinTraversalAdapters(): void;
export declare function traverseGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): AsyncIterableIterator<GraphTraversalEventV1>;
export declare function collectGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): Promise<CrossModuleGraphV1>;
export declare function runGraphTraversalConformance(
  options: GraphTraversalConformanceOptions,
): Promise<GraphTraversalConformanceReport>;

/* ------------------------------------------------------------------------- *
 * Compile-time assertions. No runtime values are ever created.
 * ------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;

interface AnswerDocFixture {
  related_entities?: Array<{ target: RelationTargetV1; target_type: string }>;
}

declare const adapter: TraversalAdapter<AnswerDocFixture>;
declare const entity: EntityV1;
declare const planContext: TraversalPlanContext;
declare const budget: RelationsTraversalBudgetState;

/* 1. Adapters parse before they plan, and `planEdges` receives the VALIDATED
 *    document — never `unknown`. This is the constraint ADR-0011 §2 exists for. */
declare const parsed: TraversalParseResult<AnswerDocFixture>;
type ParseIsDiscriminated = Assert<
  Equal<Extract<typeof parsed, { ok: true }>["document"], AnswerDocFixture>
>;
type ParseFailureKeepsBothChannels = Assert<
  Equal<keyof Extract<typeof parsed, { ok: false }>, "ok" | "errors" | "semanticIssues">
>;
type PlanTakesValidatedDoc = Assert<
  Equal<Parameters<typeof adapter.planEdges>[0], AnswerDocFixture>
>;

// A raw entity is not a validated document: planning without parsing is a type error.
// @ts-expect-error planEdges must not accept an unvalidated payload
adapter.planEdges(entity, entity, planContext);

/* 2. `GraphTraversalOptions` requires the caller's shared budget. */
type BudgetIsRequired = Assert<Equal<Has<GraphTraversalOptions, "budget">, true>>;
type BudgetIsNotOptional = Assert<
  Equal<Record<string, never> extends Pick<GraphTraversalOptions, "budget"> ? true : false, false>
>;

declare let assignedOptions: GraphTraversalOptions;
// @ts-expect-error a walk without the caller's budget is invalid options
assignedOptions = { rootUrl: "https://example.test/a" };

declare const options: GraphTraversalOptions;
type BudgetIsTheReleasedShape = Assert<Equal<typeof options.budget, RelationsTraversalBudgetState>>;
type BudgetCarriesReleasedDimensions = Assert<Equal<Has<typeof budget, "maxDepth">, true>>;
type BudgetCarriesExpandedTargets = Assert<Equal<Has<typeof budget, "expandedTargets">, true>>;

/* 3. Node, extension and edge outcomes are three DIFFERENT vocabularies at three
 *    scopes (ADR-0011 §4). Conflating any two must not compile. */
type NodeVocabularyUntouched = Assert<Equal<GraphNodeStatusV1, AnswerTargetResolutionStatus>>;

declare let nodeStatus: GraphNodeStatusV1;
declare let extensionOutcome: ExtensionExpansionOutcomeV1;
declare let edgeOutcome: EdgeExpansionOutcomeV1;

// @ts-expect-error "planned" is extension scope, not node scope
nodeStatus = "planned";
// @ts-expect-error "expanded" is edge scope, not node scope
nodeStatus = "expanded";
// @ts-expect-error "cycle" is edge scope, not extension scope
extensionOutcome = "cycle";
// @ts-expect-error "invalid-extension" is extension scope, not edge scope
edgeOutcome = "invalid-extension";
// @ts-expect-error "resolved" is node scope, not edge scope
edgeOutcome = "resolved";

// `budget-exhausted` is the one value node and edge scope deliberately share.
nodeStatus = "budget-exhausted";
edgeOutcome = "budget-exhausted";

/* 4. A blocked edge carries an outcome but NO resolution status — nothing was
 *    ever attempted, so no released status value is stretched to describe it. */
declare const blockedEdge: GraphEdgeV1;
type EdgeStatusIsOptional = Assert<
  Equal<undefined extends GraphEdgeV1["status"] ? true : false, true>
>;
type EdgeOutcomeIsRequired = Assert<
  Equal<undefined extends GraphEdgeV1["outcome"] ? true : false, false>
>;
type BlockedEdgeStillHasOutcome = Assert<Equal<typeof blockedEdge.outcome, EdgeExpansionOutcomeV1>>;

/* 5. Expansion records are per-extension and carry no edge-level fate. A node
 *    therefore reports a LIST of them, and dropping that list from the node must
 *    fail this gate — `CrossModuleGraphV1.expansions` is a flat collection and
 *    does not carry the per-node relation. */
type NodeExpansionsArePublic = Assert<
  Equal<GraphNodeV1["expansions"], GraphExtensionExpansionV1[] | undefined>
>;
type NodeExpansionsAreAList = Assert<
  Equal<NonNullable<GraphNodeV1["expansions"]>[number], GraphExtensionExpansionV1>
>;
type GraphAlsoCarriesFlatExpansions = Assert<
  Equal<CrossModuleGraphV1["expansions"], GraphExtensionExpansionV1[]>
>;
type ExpansionHasNoEdgeOutcome = Assert<Equal<Has<GraphExtensionExpansionV1, "outcome">, true>>;
declare const expansion: GraphExtensionExpansionV1;
type ExpansionOutcomeIsExtensionScope = Assert<
  Equal<typeof expansion.outcome, ExtensionExpansionOutcomeV1>
>;
// @ts-expect-error edge fate never lives on the extension record
expansion.outcome = "depth-limit";

/* 6. `GraphTraversalState` is INTERNAL: it appears in no public signature. The
 *    fixture never imports or names it, and no public member exposes walk state. */
type OptionsExposeNoWalkState = Assert<Equal<Has<GraphTraversalOptions, "state">, false>>;
type GraphExposesNoWalkState = Assert<Equal<Has<CrossModuleGraphV1, "state">, false>>;
type SummaryExposesNoWalkState = Assert<Equal<Has<GraphTraversalSummaryV1, "state">, false>>;

/* 7. ADR-0011 §12.2 — `concurrency` is NOT public at 1.0. */
type ConcurrencyIsNotPublic = Assert<Equal<Has<GraphTraversalOptions, "concurrency">, false>>;
// @ts-expect-error concurrency is an internal scheduling constant, not API
assignedOptions = { budget, concurrency: 8 };

/* 8. ADR-0011 §12.1 — collections are off by default and there is NO page limit;
 *    paging is bounded by the budget's six dimensions alone. */
type FollowCollectionsIsPublic = Assert<Equal<Has<GraphTraversalOptions, "followCollections">, true>>;
type FollowCollectionsIsOptional = Assert<
  Equal<undefined extends GraphTraversalOptions["followCollections"] ? true : false, true>
>;
type NoMaxPagesOption = Assert<Equal<Has<GraphTraversalOptions, "maxPages">, false>>;
// @ts-expect-error paging is bounded by the budget, not by a separate page limit
assignedOptions = { budget, maxPages: 10 };

/* 9. The terminal event is mandatory and partial results say so (ADR-0011 §9). */
type CompleteEventCarriesSummary = Assert<
  Equal<Extract<GraphTraversalEventV1, { type: "complete" }>["summary"], GraphTraversalSummaryV1>
>;
type StopReasonIsClosed = Assert<
  Equal<GraphTraversalSummaryV1["stopReason"], "exhausted" | "budget" | "aborted">
>;
type PartialIsRequired = Assert<
  Equal<undefined extends GraphTraversalSummaryV1["partial"] ? true : false, false>
>;

/* 10. Streaming and collected result agree on content and ordering. */
type StreamYieldsEvents = Assert<
  Equal<ReturnType<typeof traverseGraphV1>, AsyncIterableIterator<GraphTraversalEventV1>>
>;
type CollectReturnsGraph = Assert<
  Equal<Awaited<ReturnType<typeof collectGraphV1>>, CrossModuleGraphV1>
>;
type BothAcceptTheSameRoot = Assert<
  Equal<Parameters<typeof traverseGraphV1>[0], Parameters<typeof collectGraphV1>[0]>
>;
type BothAcceptTheSameOptions = Assert<
  Equal<Parameters<typeof traverseGraphV1>[1], Parameters<typeof collectGraphV1>[1]>
>;

/* 11. Conformance reuses the core report shapes — no fourth report format. */
type ReportReusesCoreSummary = Assert<
  Equal<GraphTraversalConformanceReport["summary"], ConformanceSummary>
>;
type ReportReusesCoreChecks = Assert<Equal<GraphTraversalConformanceReport["checks"], CheckResult[]>>;
type ReportIsProfileScoped = Assert<Equal<Has<GraphTraversalConformanceReport, "profile">, true>>;
type ReportIsNotModuleScoped = Assert<Equal<Has<GraphTraversalConformanceReport, "module">, false>>;

/* 13. The runner accepts the SAME shared controls the three released runners do.
 *     Without URL-policy injection the profile cannot run against localhost or a
 *     private staging deployment, and without `signal` a caller cannot abort it —
 *     both regressions against Relations/Answer/Evidence conformance. */
type RunnerTakesUrlPolicy = Assert<
  Equal<GraphTraversalConformanceOptions["urlPolicy"], UrlPolicy | undefined>
>;
type RunnerTakesPrivateNetworkOptIn = Assert<
  Equal<GraphTraversalConformanceOptions["allowPrivateNetwork"], boolean | undefined>
>;
type RunnerTakesRetryPolicy = Assert<
  Equal<GraphTraversalConformanceOptions["retry"], RetryOptions | undefined>
>;
type RunnerTakesCrossOriginSafeHeaders = Assert<
  Equal<GraphTraversalConformanceOptions["crossOriginSafeHeaders"], string[] | undefined>
>;
type RunnerIsCancellable = Assert<
  Equal<GraphTraversalConformanceOptions["signal"], AbortSignal | undefined>
>;
type RunnerReportsPerCheck = Assert<
  Equal<GraphTraversalConformanceOptions["onCheck"], ((result: CheckResult) => void) | undefined>
>;
type RunnerHonoursFailOnWarning = Assert<
  Equal<GraphTraversalConformanceOptions["failOnWarning"], boolean | undefined>
>;

/* 14. The budget replaces ONLY the six standalone traversal limits — never the
 *     HTTP policy, the callbacks or the cancellation above. Keeping both paths
 *     would let a runner be configured with limits that contradict the very
 *     budget it threads into the walk. */
type RunnerTakesBudget = Assert<
  Equal<GraphTraversalConformanceOptions["budget"], RelationsTraversalBudgetState | undefined>
>;
type NoStandaloneMaxDepth = Assert<Equal<Has<GraphTraversalConformanceOptions, "maxDepth">, false>>;
type NoStandaloneMaxNodes = Assert<Equal<Has<GraphTraversalConformanceOptions, "maxNodes">, false>>;
type NoStandaloneMaxRequests = Assert<
  Equal<Has<GraphTraversalConformanceOptions, "maxRequests">, false>
>;
type NoStandaloneMaxTotalBytes = Assert<
  Equal<Has<GraphTraversalConformanceOptions, "maxTotalBytes">, false>
>;
type NoStandaloneMaxCrossOrigin = Assert<
  Equal<Has<GraphTraversalConformanceOptions, "maxCrossOriginRequests">, false>
>;
type NoStandaloneDeadline = Assert<Equal<Has<GraphTraversalConformanceOptions, "deadlineMs">, false>>;
/* §12.1/§12.2 hold on the runner surface too. */
type RunnerHasNoMaxPages = Assert<Equal<Has<GraphTraversalConformanceOptions, "maxPages">, false>>;
type RunnerHasNoConcurrency = Assert<
  Equal<Has<GraphTraversalConformanceOptions, "concurrency">, false>
>;

declare let conformanceOptions: GraphTraversalConformanceOptions;
// @ts-expect-error traversal limits are configured through `budget`, not alongside it
conformanceOptions = { maxDepth: 3 };
// @ts-expect-error no page limit exists anywhere in this API (ADR-0011 §12.1)
conformanceOptions = { maxPages: 20 };

/* 12. Registration is a void, idempotent side effect on the traversal registry. */
type RegisterTakesNoArguments = Assert<Equal<Parameters<typeof registerBuiltinTraversalAdapters>, []>>;
type RegisterReturnsVoid = Assert<Equal<ReturnType<typeof registerBuiltinTraversalAdapters>, void>>;

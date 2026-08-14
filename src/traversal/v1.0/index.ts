/**
 * Public API for AADP cross-module graph traversal v1.0
 * (`ail-aadp/traversal/v1.0`, ADR-0011).
 *
 * Unlike a module subpath, importing this file registers NOTHING — no adapter
 * reaches any registry until a consumer calls
 * `registerBuiltinTraversalAdapters()` or passes `options.adapters`.
 *
 * Deliberately NOT re-exported from the package root or from any module
 * subpath, and the shared canonical-resolution layer is never exported here
 * (ADR-0011 §11).
 *
 * Phase 1 (adapter registry and capability negotiation) is what this file
 * exports today; `traverseGraphV1`/`collectGraphV1` land with the streaming
 * phase and `runGraphTraversalConformance` with the conformance phase.
 */
export type {
  ExtensionExpansionOutcomeV1,
  EdgeExpansionOutcomeV1,
  GraphNodeStatusV1,
  TraversalAdapter,
  TraversalAdapterKey,
  TraversalAdapterCapabilities,
  TraversalParseResult,
  TraversalPlanContext,
  TraversalEdgePlan,
  GraphNodeV1,
  GraphExtensionExpansionV1,
  GraphEdgeV1,
  GraphReferenceV1,
  GraphTraversalSummaryV1,
  GraphTraversalEventV1,
  CrossModuleGraphV1,
  GraphTraversalOptions,
  GraphTraversalConformanceOptions,
  GraphTraversalConformanceReport,
} from "./types.js";

export {
  registerTraversalAdapter,
  getTraversalAdapter,
  listTraversalAdapters,
  type TraversalCapability,
} from "./registry.js";

export { registerBuiltinTraversalAdapters, BUILTIN_TRAVERSAL_ADAPTERS } from "./adapters/builtins.js";

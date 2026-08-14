/**
 * Public surface of the `aadp:graph-traversal@1.0` conformance profile,
 * re-exported from `ail-aadp/traversal/v1.0`. The fixture matrix and the check
 * implementations stay internal — only the runner, the check registry (IDs are
 * package API) and the report shapes are public.
 */
export { runGraphTraversalConformance } from "./runner.js";
export { GRAPH_TRAVERSAL_CHECKS, type GraphTraversalCheck } from "./checks.js";
export {
  InvalidGraphTraversalConformanceOptionsError,
  type GraphCheckLevel,
  type GraphTraversalConformanceOptions,
  type GraphTraversalConformanceReport,
} from "./types.js";

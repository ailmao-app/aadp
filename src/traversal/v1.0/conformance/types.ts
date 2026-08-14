/**
 * Public shapes of the `aadp:graph-traversal@1.0` conformance profile.
 *
 * Reuses the core runner's `CheckResult`/`CheckStatus`/`ConformanceSummary`
 * rather than introducing a fourth report format, exactly as the Answer and
 * Evidence profiles do. The one shape change from a module report is
 * `profile: {id, version}` in place of `module` — this run composes three
 * modules and certifies none of them on its own.
 */
export type { CheckResult, CheckStatus, ConformanceSummary } from "../../../conformance/index.js";
export type {
  GraphTraversalConformanceOptions,
  GraphTraversalConformanceReport,
} from "../types.js";

/** Check severity. A `warning` moves the verdict only under `failOnWarning`. */
export type GraphCheckLevel = "error" | "warning";

/**
 * Thrown before any check runs when an option value is unusable, so a
 * misconfigured run is never recorded as a nonconformant implementation.
 */
export class InvalidGraphTraversalConformanceOptionsError extends Error {
  readonly code = "invalid_options" as const;

  constructor(
    public readonly option: string,
    message: string
  ) {
    super(`Invalid graph traversal conformance option "${option}": ${message}`);
    this.name = "InvalidGraphTraversalConformanceOptionsError";
  }
}

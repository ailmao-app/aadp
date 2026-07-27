/**
 * Public entry point of the standalone conformance runner. Import this to
 * run AADP conformance from your own code or CI harness; run the
 * `aadp-conformance` binary for the same thing from a shell.
 *
 * ```ts
 * import { runConformance, exitCodeFor } from "ail-aadp/conformance";
 *
 * const report = await runConformance({ baseUrl: "https://example.com" });
 * process.exitCode = exitCodeFor(report);
 * ```
 */
export { runConformance } from "./runner.js";
export {
  renderTextReport,
  renderCheckLines,
  renderSummary,
  renderJsonReport,
  exitCodeFor,
  type TextReportOptions,
} from "./report.js";
export { CHECKS, collectAdvertisedUrls, type Check } from "./checks.js";
export {
  SUPPORTED_CONFORMANCE_VERSIONS,
  UnsupportedConformanceVersionError,
  type CheckResult,
  type CheckStatus,
  type ConformanceFatal,
  type ConformanceOptions,
  type ConformanceReport,
  type ConformanceSummary,
  type ConformanceVersion,
} from "./types.js";

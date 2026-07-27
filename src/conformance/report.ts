/**
 * Report rendering. Pure string formatting over a `ConformanceReport` —
 * no I/O, no `process`, no colour-detection side effects — so both the
 * CLI and an embedding host can render the same run, and so the renderers
 * are testable without spawning anything.
 */
import type { CheckResult, CheckStatus, ConformanceReport } from "./types.js";

const STATUS_LABEL: Record<CheckStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  warning: "WARN",
  skipped: "SKIP",
};

// Built from the code point rather than written as a literal escape, so
// no raw control byte ends up in this source file.
const ESC = String.fromCharCode(27);
const ANSI: Record<CheckStatus, string> = {
  passed: `${ESC}[32m`,
  failed: `${ESC}[31m`,
  warning: `${ESC}[33m`,
  skipped: `${ESC}[90m`,
};
const RESET = `${ESC}[0m`;

export interface TextReportOptions {
  /** Wrap status labels in ANSI colour. Default false — safe for CI logs and files. */
  color?: boolean;
  /** Print passing checks too. Default true; false prints only non-passes plus the summary. */
  verbose?: boolean;
}

function label(status: CheckStatus, color: boolean): string {
  return color ? `${ANSI[status]}${STATUS_LABEL[status]}${RESET}` : STATUS_LABEL[status];
}

/**
 * One check as a block of lines. Exported so a CLI can print checks as
 * they settle and still produce exactly the same text as the batch
 * report.
 */
export function renderCheckLines(check: CheckResult, options: TextReportOptions = {}): string[] {
  const color = options.color ?? false;
  const lines = [`  ${label(check.status, color)}  ${check.id}  ${check.title} (${check.duration_ms}ms)`];
  if (check.message) lines.push(`        ${check.message}`);
  for (const detail of check.details ?? []) lines.push(`        - ${detail}`);
  return lines;
}

/** Human-readable report for a terminal or a CI log. */
export function renderTextReport(report: ConformanceReport, options: TextReportOptions = {}): string {
  const color = options.color ?? false;
  const verbose = options.verbose ?? true;
  const lines: string[] = [
    `AADP v${report.aadp_version} conformance — ${report.base_url}`,
    `runner ${report.runner.name}@${report.runner.version}, finished ${report.finished_at} in ${report.duration_ms}ms`,
    "",
  ];

  let currentGroup: string | undefined;
  for (const check of report.checks) {
    if (!verbose && check.status === "passed") continue;
    if (check.group !== currentGroup) {
      if (currentGroup !== undefined) lines.push("");
      lines.push(`${check.group}:`);
      currentGroup = check.group;
    }
    lines.push(...renderCheckLines(check, { color }));
  }

  lines.push("", renderSummary(report));
  return lines.join("\n");
}

/** Closing tally and verdict, without the per-check detail. */
export function renderSummary(report: ConformanceReport): string {
  const { summary } = report;
  const lines = [
    `${summary.total} checks: ${summary.passed} passed, ${summary.failed} failed, ` +
      `${summary.warnings} warnings, ${summary.skipped} skipped`,
  ];
  if (report.fatal) {
    lines.push(`fatal (${report.fatal.code}): ${report.fatal.message}`);
  }
  if (summary.skipped > 0) {
    // Said explicitly because a skip is the one status a reader is likely
    // to mistake for "fine": it means no verdict was reached.
    lines.push("skipped checks reached no verdict and are not evidence of conformance");
  }
  if (summary.inconclusive > 0) {
    lines.push(
      `${summary.inconclusive} check(s) could not complete (traversal budget, or no target could be derived); ` +
        "the run does not certify conformance"
    );
  }
  lines.push(`RESULT: ${report.status.toUpperCase()}`);
  return lines.join("\n");
}

/** Machine-readable report, stable per `report_version`. */
export function renderJsonReport(report: ConformanceReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Exit code contract for CI. Stable across releases:
 * `0` conformant, `1` at least one failed check, `2` the run could not be
 * performed (unreachable origin, unusable options), `3` the deployment
 * does not speak the requested protocol version, `4` the run completed
 * without a failure but left checks unfinished, so it certifies nothing.
 */
export function exitCodeFor(report: ConformanceReport): 0 | 1 | 2 | 3 | 4 {
  if (report.fatal?.code === "unsupported_version") return 3;
  if (report.fatal) return 2;
  if (report.status === "failed") return 1;
  return report.status === "inconclusive" ? 4 : 0;
}

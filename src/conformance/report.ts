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

export interface JUnitReportOptions {
  /**
   * Report a `warning` check as a JUnit failure too. Default false: JUnit
   * has no native warning status, so a warning is reported as a passing
   * `<testcase>` with its message kept in `<system-out>` unless the caller
   * wants CI to treat it as red — matching `ConformanceOptions.failOnWarning`.
   */
  failOnWarning?: boolean;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * JUnit XML, for CI systems that render test results rather than parse
 * JSON (GitHub Actions test-reporter annotations, GitLab/Jenkins test
 * summaries, ...). One `<testcase>` per check, grouped into a single
 * `<testsuite>` since a conformance run has no nested suite structure.
 *
 * `failed` maps to `<failure>`, `skipped` to `<skipped>` — including a
 * skip that leaves the run `inconclusive`, since JUnit has no separate
 * status for that; the message says so. `warning` is a passing
 * `<testcase>` with a `<system-out>` note unless `failOnWarning` asks for
 * `<failure>` instead, matching the same option name in `runConformance`.
 */
export function renderJUnitReport(report: ConformanceReport, options: JUnitReportOptions = {}): string {
  const failOnWarning = options.failOnWarning ?? false;
  const isFailure = (check: CheckResult) => check.status === "failed" || (failOnWarning && check.status === "warning");

  const fatalTestCase = report.fatal ? 1 : 0;
  const failures = report.checks.filter(isFailure).length + fatalTestCase;
  const skipped = report.checks.filter((check) => check.status === "skipped").length;
  const tests = report.checks.length + fatalTestCase;
  const timeSeconds = (report.duration_ms / 1000).toFixed(3);

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    `<testsuite name="${xmlEscape(`aadp-conformance ${report.base_url}`)}" tests="${tests}" ` +
      `failures="${failures}" errors="0" skipped="${skipped}" time="${timeSeconds}" ` +
      `timestamp="${xmlEscape(report.started_at)}">`
  );

  if (report.fatal) {
    lines.push(`  <testcase classname="aadp.conformance" name="run" time="0.000">`);
    lines.push(`    <failure message="${xmlEscape(report.fatal.message)}" type="${xmlEscape(report.fatal.code)}"/>`);
    lines.push("  </testcase>");
  }

  for (const check of report.checks) {
    const timeS = (check.duration_ms / 1000).toFixed(3);
    const attrs =
      `classname="${xmlEscape(`aadp.conformance.${check.group}`)}" ` +
      `name="${xmlEscape(`${check.id} ${check.title}`)}" time="${timeS}"`;

    if (isFailure(check)) {
      lines.push(`  <testcase ${attrs}>`);
      lines.push(`    <failure message="${xmlEscape(check.message ?? check.status)}" type="${xmlEscape(check.status)}">`);
      for (const detail of check.details ?? []) lines.push(`      ${xmlEscape(detail)}`);
      lines.push("    </failure>");
      lines.push("  </testcase>");
    } else if (check.status === "skipped") {
      const message = check.message ?? (check.inconclusive ? "inconclusive" : "not applicable");
      lines.push(`  <testcase ${attrs}>`);
      lines.push(`    <skipped message="${xmlEscape(message)}"/>`);
      lines.push("  </testcase>");
    } else if (check.status === "warning") {
      lines.push(`  <testcase ${attrs}>`);
      if (check.message) lines.push(`    <system-out>${xmlEscape(check.message)}</system-out>`);
      lines.push("  </testcase>");
    } else {
      lines.push(`  <testcase ${attrs}/>`);
    }
  }

  lines.push("</testsuite>");
  return lines.join("\n");
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

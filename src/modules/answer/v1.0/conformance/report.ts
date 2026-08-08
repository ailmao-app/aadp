/**
 * Report rendering for the Answer conformance runner. Reuses
 * `renderCheckLines` from the core conformance report — mirrors
 * `../../../relations/v1.0/conformance/report.ts`.
 */
import { renderCheckLines, type TextReportOptions } from "../../../../conformance/report.js";
import type { AnswerConformanceReport, CheckResult, CheckStatus } from "./types.js";

export function renderAnswerTextReport(report: AnswerConformanceReport, options: TextReportOptions = {}): string {
  const color = options.color ?? false;
  const verbose = options.verbose ?? true;
  const lines: string[] = [
    `Answer v${report.module.version} conformance${report.base_url ? ` — ${report.base_url}` : ""}`,
    `runner ${report.runner.name}@${report.runner.version}, package ${report.package_version}`,
    `finished ${report.finished_at} in ${report.duration_ms}ms`,
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

  lines.push("", renderAnswerSummary(report));
  return lines.join("\n");
}

export function renderAnswerSummary(report: AnswerConformanceReport): string {
  const { summary } = report;
  const lines = [
    `${summary.total} checks: ${summary.passed} passed, ${summary.failed} failed, ` +
      `${summary.warnings} warnings, ${summary.skipped} skipped`,
  ];
  if (summary.skipped > 0) {
    lines.push("skipped checks reached no verdict and are not evidence of conformance");
  }
  if (summary.inconclusive > 0) {
    lines.push(`${summary.inconclusive} check(s) could not complete (no sample URL, or a traversal limit); the run does not certify conformance`);
  }
  lines.push(`RESULT: ${report.status.toUpperCase()}`);
  return lines.join("\n");
}

export function renderAnswerJsonReport(report: AnswerConformanceReport): string {
  return JSON.stringify(report, null, 2);
}

const XML_INVALID_CHAR = new RegExp(
  "[" +
    String.fromCharCode(0x00) + "-" + String.fromCharCode(0x08) +
    String.fromCharCode(0x0b) + "-" + String.fromCharCode(0x0c) +
    String.fromCharCode(0x0e) + "-" + String.fromCharCode(0x1f) +
    String.fromCharCode(0xfffe) + "-" + String.fromCharCode(0xffff) +
    "]",
  "g"
);

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(XML_INVALID_CHAR, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export interface AnswerJUnitReportOptions {
  failOnWarning?: boolean;
}

export function renderAnswerJUnitReport(report: AnswerConformanceReport, options: AnswerJUnitReportOptions = {}): string {
  const failOnWarning = options.failOnWarning ?? false;
  const isFailure = (check: CheckResult) => check.status === "failed" || (failOnWarning && check.status === "warning");
  const failures = report.checks.filter(isFailure).length;
  const skipped = report.checks.filter((c) => c.status === "skipped").length;
  const timeSeconds = (report.duration_ms / 1000).toFixed(3);

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    `<testsuite name="${xmlEscape(`aadp-answer-conformance${report.base_url ? ` ${report.base_url}` : ""}`)}" ` +
      `tests="${report.checks.length}" failures="${failures}" errors="0" skipped="${skipped}" ` +
      `time="${timeSeconds}" timestamp="${xmlEscape(report.started_at)}">`
  );
  lines.push("  <properties>");
  lines.push(`    <property name="module.id" value="${xmlEscape(report.module.id)}"/>`);
  lines.push(`    <property name="module.version" value="${xmlEscape(report.module.version)}"/>`);
  lines.push(`    <property name="package_version" value="${xmlEscape(report.package_version)}"/>`);
  for (const [key, value] of Object.entries(report.effective_limits)) {
    lines.push(`    <property name="limit.${xmlEscape(key)}" value="${value}"/>`);
  }
  lines.push("  </properties>");

  for (const check of report.checks) {
    const timeS = (check.duration_ms / 1000).toFixed(3);
    const attrs = `classname="${xmlEscape(`aadp.answer.${check.group}`)}" name="${xmlEscape(`${check.id} ${check.title}`)}" time="${timeS}"`;
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

/** Exit code contract, mirroring the core/Relations runners': `0` conformant, `1` a check failed, `4` inconclusive. */
export function answerExitCodeFor(report: AnswerConformanceReport): 0 | 1 | 4 {
  if (report.status === "failed") return 1;
  return report.status === "inconclusive" ? 4 : 0;
}

export type { CheckStatus };

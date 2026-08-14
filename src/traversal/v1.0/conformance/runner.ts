/**
 * `aadp:graph-traversal@1.0` conformance runner.
 *
 * Unlike the core/Relations/Answer/Evidence runners, this profile certifies a
 * traversal IMPLEMENTATION against ADR-0011, not a deployment: its subject is
 * an algorithm, so it runs entirely against the in-package fixture matrix and
 * makes no request at all. The deployment-shaped options are still accepted and
 * validated — a profile composing three modules must be configurable the way
 * they are, and `sampleRootUrl`/`baseUrl` are recorded in the report so a run
 * can be attributed to the deployment it was performed for.
 */
import { createRequire } from "node:module";
import { createStrictUrlPolicy } from "../../../client/url-policy.js";
import {
  GRAPH_TRAVERSAL_CHECKS,
  defaultCheckLookup,
  type GraphCheckOutcome,
  type GraphTraversalCheck,
} from "./checks.js";
import {
  InvalidGraphTraversalConformanceOptionsError,
  type CheckResult,
  type CheckStatus,
  type ConformanceSummary,
  type GraphTraversalConformanceOptions,
  type GraphTraversalConformanceReport,
} from "./types.js";

const require = createRequire(import.meta.url);

function runnerVersion(): string {
  try {
    return (require("../../../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Numeric options and the smallest value each accepts, mirroring the released
 * runners: dimensions that would block the whole run at `0` require at least 1,
 * while `maxRedirects` keeps `0` as a meaningful, exercised boundary.
 */
const NUMERIC_OPTION_MINIMUMS = {
  timeoutMs: 1,
  maxRedirects: 0,
  maxResponseBytes: 1,
} as const satisfies Record<string, number>;

const RETRY_OPTION_MINIMUMS = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
} as const satisfies Record<string, number>;

function assertIntegerAtLeast(option: string, value: unknown, minimum: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidGraphTraversalConformanceOptionsError(
      option,
      `expected a finite number, got ${JSON.stringify(value)}`
    );
  }
  if (!Number.isInteger(value)) {
    throw new InvalidGraphTraversalConformanceOptionsError(option, `expected an integer, got ${value}`);
  }
  if (value < minimum) {
    throw new InvalidGraphTraversalConformanceOptionsError(option, `must be at least ${minimum}, got ${value}`);
  }
}

function assertHttpsUrl(option: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidGraphTraversalConformanceOptionsError(option, `expected an absolute URL, got ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidGraphTraversalConformanceOptionsError(option, `expected an http(s) URL, got ${parsed.protocol}`);
  }
}

/** Validates every option before the first check, so a misconfigured run never becomes a verdict. */
function assertValidOptions(options: GraphTraversalConformanceOptions): void {
  for (const [option, minimum] of Object.entries(NUMERIC_OPTION_MINIMUMS)) {
    const value = (options as Record<string, unknown>)[option];
    if (value !== undefined) assertIntegerAtLeast(option, value, minimum);
  }
  if (options.retry !== undefined) {
    for (const [field, minimum] of Object.entries(RETRY_OPTION_MINIMUMS)) {
      const value = (options.retry as Record<string, unknown>)[field];
      if (value !== undefined) assertIntegerAtLeast(`retry.${field}`, value, minimum);
    }
  }
  if (options.baseUrl !== undefined) assertHttpsUrl("baseUrl", options.baseUrl);
  if (options.sampleRootUrl !== undefined) assertHttpsUrl("sampleRootUrl", options.sampleRootUrl);
  if (options.headers !== undefined && (typeof options.headers !== "object" || options.headers === null)) {
    throw new InvalidGraphTraversalConformanceOptionsError("headers", "expected an object of header names to values");
  }
  if (options.onCheck !== undefined && typeof options.onCheck !== "function") {
    throw new InvalidGraphTraversalConformanceOptionsError("onCheck", "expected a function");
  }
}

/** Effective limits recorded in the report, so a run states what it was bounded by. */
function effectiveLimits(options: GraphTraversalConformanceOptions): Record<string, number> {
  const budget = options.budget;
  return {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxRedirects: options.maxRedirects ?? 5,
    maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
    ...(budget
      ? {
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
          maxCrossOriginRequests: budget.maxCrossOriginRequests,
        }
      : {}),
  };
}

function summarize(checks: readonly CheckResult[]): ConformanceSummary {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    inconclusive: checks.filter((check) => check.inconclusive === true).length,
  };
}

function statusOf(summary: ConformanceSummary, failOnWarning: boolean): GraphTraversalConformanceReport["status"] {
  if (summary.failed > 0 || (failOnWarning && summary.warnings > 0)) return "failed";
  return summary.inconclusive > 0 ? "inconclusive" : "passed";
}

function resultOf(check: GraphTraversalCheck, outcome: GraphCheckOutcome, durationMs: number): CheckResult {
  return {
    id: check.id,
    group: check.group,
    title: check.title,
    status: outcome.status,
    duration_ms: durationMs,
    ...(outcome.message ? { message: outcome.message } : {}),
    ...(outcome.details ? { details: outcome.details } : {}),
    ...(outcome.inconclusive ? { inconclusive: true } : {}),
  };
}

/**
 * Runs every check of the profile and returns a report reusing the core
 * `CheckResult`/`ConformanceSummary` shapes.
 *
 * Cancellation stops checks that have not started: each remaining one is
 * recorded `skipped`/`inconclusive` rather than run, so the report reflects a
 * stopped run instead of a false pass or a failure caused by the caller's own
 * cancellation. An `onCheck` callback that throws never changes a verdict.
 */
export async function runGraphTraversalConformance(
  options: GraphTraversalConformanceOptions = {}
): Promise<GraphTraversalConformanceReport> {
  assertValidOptions(options);

  // Built and validated even though the fixture matrix needs no network: a
  // caller passing a policy must not silently have it ignored, and building it
  // here is what would surface an unusable one.
  const urlPolicy = options.urlPolicy ?? createStrictUrlPolicy();
  void urlPolicy;

  const lookup = defaultCheckLookup();
  const startedAt = new Date();
  const started = Date.now();
  const checks: CheckResult[] = [];

  for (const check of GRAPH_TRAVERSAL_CHECKS) {
    if (options.signal?.aborted) {
      checks.push(
        resultOf(
          check,
          { status: "skipped", inconclusive: true, message: "The run was cancelled before this check started." },
          0
        )
      );
      continue;
    }

    const checkStarted = Date.now();
    let outcome: GraphCheckOutcome;
    try {
      outcome = await check.run({ lookup, signal: options.signal });
    } catch (err) {
      // A check that throws is a failure of the implementation under test, not
      // of the runner: it is reported, and the remaining checks still run.
      outcome = {
        status: "failed" as CheckStatus,
        message: `The check threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const result = resultOf(check, outcome, Date.now() - checkStarted);
    checks.push(result);
    try {
      options.onCheck?.(result);
    } catch {
      // Progress reporting is never allowed to decide a verdict.
    }
  }

  const finishedAt = new Date();
  const summary = summarize(checks);

  return {
    report_version: "1",
    aadp_version: "1.0",
    profile: { id: "aadp:graph-traversal", version: "1.0" },
    package_version: runnerVersion(),
    ...(options.baseUrl ? { base_url: options.baseUrl } : {}),
    runner: { name: "ail-aadp", version: runnerVersion() },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - started,
    status: statusOf(summary, options.failOnWarning === true),
    summary,
    effective_limits: effectiveLimits(options),
    checks,
  };
}

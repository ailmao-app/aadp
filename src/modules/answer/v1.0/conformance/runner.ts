/**
 * Answer Module v1.0 conformance runner (specification.md "Conformance
 * contract"). Executes `ANSWER_CHECKS` and returns an
 * `AnswerConformanceReport` — reuses the core client's HTTP/URL-policy/
 * scheduler and the Relations `1.0` traversal budget rather than
 * duplicating either; never touches core `CHECKS` or core check IDs.
 */
import { createRequire } from "node:module";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../../../../client/url-policy.js";
import { AbortedError } from "../../../../client/http.js";
import { AadpDiscoveryBudgetExceededError } from "../../../../client/discovery-budget.js";
import type { ClientOptions } from "../../../../client/v1.0/index.js";
import { createRelationsTraversalBudget } from "../../../relations/v1.0/client/budget.js";
import {
  ANSWER_CHECKS,
  AnswerCheckSignal,
  type AnswerCheck,
  type AnswerCheckContext,
  type AnswerCheckOutcome,
  type AnswerRunState,
} from "./checks.js";
import { InvalidAnswerConformanceOptionsError, type AnswerConformanceOptions, type AnswerConformanceReport, type CheckResult, type CheckStatus } from "./types.js";

const require = createRequire(import.meta.url);

function runnerVersion(): string {
  try {
    return (require("../../../../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Numeric options, and the smallest value each accepts (mirrors core's own
 * `NUMERIC_OPTION_MINIMUMS` in `../../../../conformance/runner.ts`). The
 * core/transport dimensions (`timeoutMs`, `maxResponseBytes`, `maxPages`,
 * `deadlineMs`, `maxTotalBytes`) require at least 1 — `0` there would make
 * the very first request impossible and indistinguishable from a
 * misconfiguration. `maxRedirects: 0` ("do not follow redirects") is a
 * meaningful policy, not a mistake, so it allows `0`. `maxRequests` is
 * charged for EVERY HTTP attempt this run makes (`chargeDiscoveryBudgetRequest`
 * in `../../../../client/http.ts`) — manifest discovery and the sample
 * entity fetch, not just Answer target resolution — so `0` blocks the
 * whole run exactly like the transport dimensions above and requires at
 * least 1 for the same reason. `maxDepth`, `maxNodes`, and
 * `maxCrossOriginRequests` are scoped narrowly enough that `0` stays a
 * meaningful, exercised boundary rather than a whole-run blocker: `maxDepth`/
 * `maxNodes` only gate Relations' own per-target `chargeDepth`/`chargeNode`
 * during Answer target resolution (stop before resolving even the first
 * target — see `resolveAnswerTargets`' own global-stop-on-first-target
 * regression test), never the manifest/sample-entity fetch; `maxCrossOriginRequests`
 * only gates requests whose origin differs from the run's own, so `0` still
 * permits every same-origin request a normal run makes.
 */
const NUMERIC_OPTION_MINIMUMS = {
  timeoutMs: 1,
  maxRedirects: 0,
  maxResponseBytes: 1,
  maxPages: 1,
  deadlineMs: 1,
  maxTotalBytes: 1,
  maxDepth: 0,
  maxNodes: 0,
  maxRequests: 1,
  maxCrossOriginRequests: 0,
} as const satisfies Record<string, number>;

/** Mirrors the minimums `../../../../client/http.ts` enforces for `RetryOptions` at request time — validated here up front instead. */
const RETRY_OPTION_MINIMUMS = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
} as const satisfies Record<string, number>;

function assertFiniteIntegerAtLeast(name: string, value: unknown, minimum: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidAnswerConformanceOptionsError(name, `expected a finite number, got ${JSON.stringify(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new InvalidAnswerConformanceOptionsError(name, `expected an integer, got ${value}`);
  }
  if (value < minimum) {
    throw new InvalidAnswerConformanceOptionsError(name, `must be at least ${minimum}, got ${value}`);
  }
}

/**
 * Rejects unusable options before any request is made. A configuration
 * mistake must surface as an error the caller owns — `InvalidAnswer
 * ConformanceOptionsError` — never as a `status: "failed"` check blaming
 * the deployment under test, or as a budget silently built from `NaN`/
 * negative effective limits.
 */
function assertUsableOptions(options: AnswerConformanceOptions): void {
  for (const [name, minimum] of Object.entries(NUMERIC_OPTION_MINIMUMS)) {
    const value = options[name as keyof typeof NUMERIC_OPTION_MINIMUMS];
    if (value !== undefined) assertFiniteIntegerAtLeast(name, value, minimum);
  }
  if (options.retry) {
    for (const [name, minimum] of Object.entries(RETRY_OPTION_MINIMUMS)) {
      const value = options.retry[name as keyof typeof RETRY_OPTION_MINIMUMS];
      if (value !== undefined) assertFiniteIntegerAtLeast(`retry.${name}`, value, minimum);
    }
  }
  // `classifyAnswerFreshness` never throws for an invalid `now` — it would
  // just silently misclassify freshness against a NaN/garbage clock instead
  // of surfacing a caller mistake.
  if (options.now !== undefined && (!(options.now instanceof Date) || Number.isNaN(options.now.getTime()))) {
    throw new InvalidAnswerConformanceOptionsError("now", `expected a valid Date, got ${JSON.stringify(options.now)}`);
  }
}

function emptySummary() {
  return { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, inconclusive: 0 };
}

function tally(summary: ReturnType<typeof emptySummary>, result: CheckResult): void {
  summary.total++;
  if (result.status === "passed") summary.passed++;
  else if (result.status === "failed") summary.failed++;
  else if (result.status === "warning") summary.warnings++;
  else {
    summary.skipped++;
    if (result.inconclusive) summary.inconclusive++;
  }
}

function describeThrown(err: unknown): { message: string; details?: string[] } {
  if (err instanceof Error) {
    const details: string[] = [];
    if (err.cause instanceof Error) details.push(`caused by ${err.cause.name}: ${err.cause.message}`);
    return { message: `${err.name}: ${err.message}`, details: details.length > 0 ? details : undefined };
  }
  return { message: `Non-Error thrown: ${String(err)}` };
}

function unmetPrerequisite(check: AnswerCheck, statusById: Map<string, CheckStatus>): { id: string; reason: string } | undefined {
  for (const id of check.requires ?? []) {
    const status = statusById.get(id);
    if (status === undefined) return { id, reason: "did not run" };
    if (status === "failed" || status === "skipped") return { id, reason: status === "failed" ? "failed" : "was skipped" };
  }
  return undefined;
}

async function runCheck(
  check: AnswerCheck,
  ctxBase: Omit<AnswerCheckContext, "skip" | "inconclusive" | "warn" | "fail">
): Promise<CheckResult> {
  const signal = (outcome: AnswerCheckOutcome | { status: "failed"; message: string; details?: string[] }): never => {
    throw new AnswerCheckSignal(outcome);
  };
  const ctx: AnswerCheckContext = {
    ...ctxBase,
    skip: (message, details) => signal({ status: "skipped", message, details }),
    inconclusive: (message, details) => signal({ status: "skipped", message, details, inconclusive: true }),
    warn: (message, details) => signal({ status: "warning", message, details }),
    fail: (message, details) => signal({ status: "failed", message, details }),
  };

  const startedMs = Date.now();
  const base = { id: check.id, group: check.group, title: check.title };
  try {
    const outcome = await check.run(ctx);
    return {
      ...base,
      status: outcome?.status ?? "passed",
      duration_ms: Date.now() - startedMs,
      ...(outcome?.message ? { message: outcome.message } : {}),
      ...(outcome?.details ? { details: outcome.details } : {}),
      ...(outcome?.inconclusive ? { inconclusive: true } : {}),
    };
  } catch (err) {
    if (err instanceof AnswerCheckSignal) {
      return {
        ...base,
        status: err.outcome.status,
        duration_ms: Date.now() - startedMs,
        ...(err.outcome.message ? { message: err.outcome.message } : {}),
        ...(err.outcome.details ? { details: err.outcome.details } : {}),
        ...("inconclusive" in err.outcome && err.outcome.inconclusive ? { inconclusive: true } : {}),
      };
    }
    if (err instanceof AadpDiscoveryBudgetExceededError) {
      return {
        ...base,
        status: "skipped",
        duration_ms: Date.now() - startedMs,
        message: `Stopped by this run's traversal budget: ${err.message}`,
        inconclusive: true,
      };
    }
    if (err instanceof AbortedError) {
      return {
        ...base,
        status: "skipped",
        duration_ms: Date.now() - startedMs,
        message: `Run aborted by caller (options.signal): ${err.message}`,
        inconclusive: true,
      };
    }
    const described = describeThrown(err);
    return { ...base, status: "failed", duration_ms: Date.now() - startedMs, message: described.message, ...(described.details ? { details: described.details } : {}) };
  }
}

/**
 * Runs every Answer v1.0 conformance check and returns a structured
 * report. Never throws for a nonconformant deployment — only for an
 * unusable `options` (`InvalidAnswerConformanceOptionsError` — a bad
 * numeric/retry/`now` option, checked before any request is made — or an
 * unparseable `options.baseUrl`).
 */
export async function runAnswerConformance(options: AnswerConformanceOptions = {}): Promise<AnswerConformanceReport> {
  assertUsableOptions(options);

  let origin: string | undefined;
  if (options.baseUrl) {
    try {
      origin = new URL(options.baseUrl).toString().replace(/\/$/, "");
    } catch {
      throw new TypeError(`Invalid baseUrl: ${JSON.stringify(options.baseUrl)}`);
    }
  }

  const client: ClientOptions = {
    urlPolicy: options.urlPolicy ?? (options.allowPrivateNetwork ? createPermissiveUrlPolicy() : createStrictUrlPolicy()),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
    ...(options.maxResponseBytes !== undefined ? { maxResponseBytes: options.maxResponseBytes } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.crossOriginSafeHeaders ? { crossOriginSafeHeaders: options.crossOriginSafeHeaders } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
  };

  // Deliberately small (mirrors Relations' own conformance default) — this
  // samples a live deployment for `answer.references`, it does not mirror
  // its catalogue.
  const CONFORMANCE_MAX_PAGES = 20;
  const budget = createRelationsTraversalBudget({
    maxPages: options.maxPages ?? CONFORMANCE_MAX_PAGES,
    deadlineMs: options.deadlineMs,
    maxDepth: options.maxDepth,
    maxNodes: options.maxNodes,
    maxRequests: options.maxRequests,
    maxTotalBytes: options.maxTotalBytes,
    maxCrossOriginRequests: options.maxCrossOriginRequests,
  });

  const effectiveLimits: Record<string, number> = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxRequests: budget.maxRequests,
    maxTotalBytes: budget.maxTotalBytes,
    deadlineMs: budget.deadlineMs,
    maxCrossOriginRequests: budget.maxCrossOriginRequests,
    maxPages: budget.maxPages,
  };

  const state: AnswerRunState = {};
  const ctxBase: Omit<AnswerCheckContext, "skip" | "inconclusive" | "warn" | "fail"> = { options, client, budget, state };

  const startedAt = new Date();
  const startedMs = Date.now();
  const results: CheckResult[] = [];
  const summary = emptySummary();
  const statusById = new Map<string, CheckStatus>();

  const record = (result: CheckResult): void => {
    results.push(result);
    statusById.set(result.id, result.status);
    tally(summary, result);
    try {
      options.onCheck?.(result);
    } catch {
      // A caller's progress reporter must not be able to change the verdict.
    }
  };

  for (const check of ANSWER_CHECKS) {
    if (options.signal?.aborted) {
      record({
        id: check.id,
        group: check.group,
        title: check.title,
        status: "skipped",
        duration_ms: 0,
        message: "Run aborted by caller (options.signal)",
        inconclusive: true,
      });
      continue;
    }
    const blocking = unmetPrerequisite(check, statusById);
    if (blocking) {
      record({
        id: check.id,
        group: check.group,
        title: check.title,
        status: "skipped",
        duration_ms: 0,
        message: `Prerequisite "${blocking.id}" ${blocking.reason}`,
      });
      continue;
    }
    record(await runCheck(check, ctxBase));
  }

  const finishedAt = new Date();
  const failed = summary.failed > 0 || (options.failOnWarning === true && summary.warnings > 0);
  const status = failed ? "failed" : summary.inconclusive > 0 ? "inconclusive" : "passed";

  return {
    report_version: "1",
    aadp_version: "1.0",
    module: { id: "aadp:answer", version: "1.0" },
    package_version: runnerVersion(),
    ...(origin ? { base_url: origin } : {}),
    runner: { name: "aadp-answer-conformance", version: runnerVersion() },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - startedMs,
    status,
    summary,
    effective_limits: effectiveLimits,
    checks: results,
  };
}

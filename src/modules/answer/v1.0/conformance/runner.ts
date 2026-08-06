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
import type { AnswerConformanceOptions, AnswerConformanceReport, CheckResult, CheckStatus } from "./types.js";

const require = createRequire(import.meta.url);

function runnerVersion(): string {
  try {
    return (require("../../../../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
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
 * unusable `options.baseUrl`.
 */
export async function runAnswerConformance(options: AnswerConformanceOptions = {}): Promise<AnswerConformanceReport> {
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

/**
 * Programmatic conformance runner (AADP-CONFORMANCE-001). Executes the
 * checks in `./checks.ts` against a live deployment and returns a
 * structured `ConformanceReport` — no test framework, no assertion
 * library, no repo fixture. `./cli.ts` is a thin front-end over this: it
 * parses argv, calls `runConformance`, renders the report and picks an
 * exit code, and holds no conformance logic of its own
 * (`docs/vi/IMPLEMENTATION_PLAN.md` §11 "Ưu tiên 1").
 */
import { createRequire } from "node:module";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../client/url-policy.js";
import { createDiscoveryBudget } from "../client/discovery-budget.js";
import type { ClientOptions } from "../client/v1.0/index.js";
import { CHECKS, CheckSignal, type Check, type CheckContext, type CheckOutcome, type RunState } from "./checks.js";
import {
  SUPPORTED_CONFORMANCE_VERSIONS,
  UnsupportedConformanceVersionError,
  type CheckResult,
  type CheckStatus,
  type ConformanceOptions,
  type ConformanceReport,
  type ConformanceVersion,
  type ConformanceSummary,
} from "./types.js";

const WELL_KNOWN_PATH = "/.well-known/ai-manifest.json";

/**
 * Traversal defaults deliberately far below the reference client's
 * (10000 pages / 100000 entities): a conformance run samples a
 * deployment's behaviour, it does not mirror its catalogue, and someone
 * pointing this at production should not discover that it walked a
 * million entities.
 */
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_ENTITIES = 200;
const DEFAULT_MAX_SITEMAPS = 100;
const DEFAULT_DEADLINE_MS = 120_000;

const require = createRequire(import.meta.url);

/** Version of this package, for the report envelope. */
function runnerVersion(): string {
  try {
    return (require("../../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function assertSupportedVersion(version: string): asserts version is ConformanceVersion {
  if (!(SUPPORTED_CONFORMANCE_VERSIONS as readonly string[]).includes(version)) {
    throw new UnsupportedConformanceVersionError(version);
  }
}

function emptySummary(): ConformanceSummary {
  return { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 };
}

function tally(summary: ConformanceSummary, status: CheckStatus): void {
  summary.total++;
  if (status === "passed") summary.passed++;
  else if (status === "failed") summary.failed++;
  else if (status === "warning") summary.warnings++;
  else summary.skipped++;
}

/**
 * Turns whatever a check threw into a failure message. Client errors carry
 * an actionable message already; anything else is reported with its class
 * name so an unexpected defect is never mistaken for a clean pass.
 */
function describeThrown(err: unknown): { message: string; details?: string[] } {
  if (err instanceof Error) {
    const details: string[] = [];
    if (err.cause instanceof Error) details.push(`caused by ${err.cause.name}: ${err.cause.message}`);
    return { message: `${err.name}: ${err.message}`, details: details.length > 0 ? details : undefined };
  }
  return { message: `Non-Error thrown: ${String(err)}` };
}

/**
 * Runs the AADP conformance checks against `options.baseUrl`.
 *
 * Never throws for a nonconformant server — that is what the report is
 * for. It throws only when the *request to run* is unusable
 * (`UnsupportedConformanceVersionError`, an unparseable base URL), so a
 * caller cannot mistake a misconfigured run for a passing deployment.
 */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const version = options.version ?? "1.0";
  assertSupportedVersion(version);

  let origin: string;
  try {
    origin = new URL(options.baseUrl).toString().replace(/\/$/, "");
  } catch {
    throw new TypeError(`Invalid baseUrl: ${JSON.stringify(options.baseUrl)}`);
  }

  const client: ClientOptions = {
    urlPolicy:
      options.urlPolicy ?? (options.allowPrivateNetwork ? createPermissiveUrlPolicy() : createStrictUrlPolicy()),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
    ...(options.maxResponseBytes !== undefined ? { maxResponseBytes: options.maxResponseBytes } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.crossOriginSafeHeaders ? { crossOriginSafeHeaders: options.crossOriginSafeHeaders } : {}),
  };

  const state: RunState = { manifestUrl: new URL(WELL_KNOWN_PATH, `${origin}/`).toString() };
  const ctxBase = {
    baseUrl: origin,
    client,
    budget: createDiscoveryBudget({
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      maxEntities: options.maxEntities ?? DEFAULT_MAX_ENTITIES,
      deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
    }),
    maxSitemaps: options.maxSitemaps ?? DEFAULT_MAX_SITEMAPS,
    state,
  };

  const startedAt = new Date();
  const startedMs = Date.now();
  const results: CheckResult[] = [];
  const summary = emptySummary();
  const statusById = new Map<string, CheckStatus>();
  let fatal: ConformanceReport["fatal"];

  const record = (result: CheckResult): void => {
    results.push(result);
    statusById.set(result.id, result.status);
    tally(summary, result.status);
    try {
      options.onCheck?.(result);
    } catch {
      // A caller's progress reporter must not be able to change the verdict.
    }
  };

  for (const check of CHECKS) {
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

  // A manifest that could not be fetched or does not declare v1.0 means
  // the run never exercised the protocol at all — a distinct outcome from
  // "the server answered and got things wrong".
  if (statusById.get("manifest.http") === "failed") {
    fatal = { code: "unreachable", message: `No usable AADP manifest at ${state.manifestUrl}` };
  } else if (statusById.get("manifest.version") === "failed") {
    fatal = {
      code: "unsupported_version",
      message: `${state.manifestUrl} does not declare aadp_version "${version}"`,
    };
  }

  const finishedAt = new Date();
  const failed = summary.failed > 0 || fatal !== undefined || (options.failOnWarning === true && summary.warnings > 0);

  return {
    report_version: "1",
    aadp_version: version,
    base_url: origin,
    runner: { name: "aadp-conformance", version: runnerVersion() },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - startedMs,
    status: failed ? "failed" : "passed",
    summary,
    ...(fatal ? { fatal } : {}),
    checks: results,
  };
}

/**
 * First prerequisite of `check` that did not pass, if any. A check whose
 * prerequisite failed or was skipped is itself skipped: re-reporting the
 * same defect once per dependent check would drown the real cause.
 */
function unmetPrerequisite(
  check: Check,
  statusById: Map<string, CheckStatus>
): { id: string; reason: string } | undefined {
  for (const id of check.requires ?? []) {
    const status = statusById.get(id);
    if (status === undefined) return { id, reason: "did not run" };
    // A warning is still a pass: the server is conformant, so dependents run.
    if (status === "failed" || status === "skipped") {
      return { id, reason: status === "failed" ? "failed" : "was skipped" };
    }
  }
  return undefined;
}

async function runCheck(check: Check, ctxBase: Omit<CheckContext, "skip" | "warn" | "fail">): Promise<CheckResult> {
  const signal = (outcome: CheckOutcome | { status: "failed"; message: string; details?: string[] }): never => {
    throw new CheckSignal(outcome);
  };
  const ctx: CheckContext = {
    ...ctxBase,
    skip: (message, details) => signal({ status: "skipped", message, details }),
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
    };
  } catch (err) {
    if (err instanceof CheckSignal) {
      return {
        ...base,
        status: err.outcome.status,
        duration_ms: Date.now() - startedMs,
        ...(err.outcome.message ? { message: err.outcome.message } : {}),
        ...(err.outcome.details ? { details: err.outcome.details } : {}),
      };
    }
    const described = describeThrown(err);
    return {
      ...base,
      status: "failed",
      duration_ms: Date.now() - startedMs,
      message: described.message,
      ...(described.details ? { details: described.details } : {}),
    };
  }
}

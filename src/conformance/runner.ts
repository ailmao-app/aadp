/**
 * Programmatic conformance runner (AADP-CONFORMANCE-001). Executes the
 * checks in `./checks.ts` against a live deployment and returns a
 * structured `ConformanceReport` — no test framework, no assertion
 * library, no repo fixture. `./cli.ts` is a thin front-end over this: it
 * parses argv, calls `runConformance`, renders the report and picks an
 * exit code, and holds no conformance logic of its own
 * (`docs/vi/plans/implementation-plan.md` §11 "Ưu tiên 1").
 */
import { createRequire } from "node:module";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../client/url-policy.js";
import { scopeHeadersToOrigin, AbortedError } from "../client/http.js";
import { createDiscoveryBudget, AadpDiscoveryBudgetExceededError } from "../client/discovery-budget.js";
import type { ClientOptions } from "../client/v1.0/index.js";
import { CHECKS, CheckSignal, type Check, type CheckContext, type CheckOutcome, type RunState } from "./checks.js";
import {
  SUPPORTED_CONFORMANCE_VERSIONS,
  InvalidConformanceOptionsError,
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

/**
 * Numeric options, and the smallest value each accepts. `maxRedirects`
 * allows `0` — "do not follow redirects" is a meaningful policy — while
 * every limit whose job is to permit at least one unit of work does not:
 * `maxPages: 0` would make the first fetch throw a budget error, which
 * `runCheck` would otherwise record as a failing check and blame on the
 * deployment.
 */
export const NUMERIC_OPTION_MINIMUMS = {
  timeoutMs: 1,
  maxRedirects: 0,
  maxResponseBytes: 1,
  maxPages: 1,
  maxEntities: 1,
  maxSitemaps: 1,
  deadlineMs: 1,
  maxTotalBytes: 1,
} as const satisfies Record<string, number>;

/**
 * Rejects unusable options before any request is made. A configuration
 * mistake must surface as an error the caller owns, never as a
 * nonconformant verdict for the deployment under test.
 */
function assertUsableOptions(options: ConformanceOptions): void {
  for (const [name, minimum] of Object.entries(NUMERIC_OPTION_MINIMUMS)) {
    const value = options[name as keyof typeof NUMERIC_OPTION_MINIMUMS];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidConformanceOptionsError(name, `expected a finite number, got ${JSON.stringify(value)}`);
    }
    if (!Number.isInteger(value)) {
      throw new InvalidConformanceOptionsError(name, `expected an integer, got ${value}`);
    }
    if (value < minimum) {
      throw new InvalidConformanceOptionsError(name, `must be at least ${minimum}, got ${value}`);
    }
  }

  for (const [name, url] of Object.entries(options.negativeTargets ?? {})) {
    if (url === undefined) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InvalidConformanceOptionsError(`negativeTargets.${name}`, `not an absolute URL: ${JSON.stringify(url)}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new InvalidConformanceOptionsError(
        `negativeTargets.${name}`,
        `must be an http(s) URL, got "${parsed.protocol}"`
      );
    }
  }
}

function emptySummary(): ConformanceSummary {
  return { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, inconclusive: 0 };
}

function tally(summary: ConformanceSummary, result: CheckResult): void {
  summary.total++;
  if (result.status === "passed") summary.passed++;
  else if (result.status === "failed") summary.failed++;
  else if (result.status === "warning") summary.warnings++;
  else {
    summary.skipped++;
    if (result.inconclusive) summary.inconclusive++;
  }
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
 * (`UnsupportedConformanceVersionError`, `InvalidConformanceOptionsError`,
 * an unparseable base URL), so a caller can neither mistake a
 * misconfigured run for a passing deployment nor blame their own
 * misconfiguration on the deployment.
 */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const version = options.version ?? "1.0";
  assertSupportedVersion(version);
  assertUsableOptions(options);

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
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
  };

  // Caller-configured headers may be a credential for the deployment
  // under test, and a manifest can point its sitemap/entity/policy URLs
  // at any host. Every fetch of a document-supplied URL goes through
  // this, so such a URL only receives headers the caller allow-listed as
  // cross-origin-safe — same rule the reference client applies in
  // `discoverAllEntities`.
  const homeOrigin = new URL(origin).origin;
  const scoped = (targetUrl: string): ClientOptions => scopeHeadersToOrigin(client, targetUrl, homeOrigin);

  const state: RunState = { manifestUrl: new URL(WELL_KNOWN_PATH, `${origin}/`).toString() };
  const ctxBase = {
    baseUrl: origin,
    client,
    scoped,
    negativeTargets: options.negativeTargets ?? {},
    budget: createDiscoveryBudget({
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      maxEntities: options.maxEntities ?? DEFAULT_MAX_ENTITIES,
      deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
      ...(options.maxTotalBytes !== undefined ? { maxTotalBytes: options.maxTotalBytes } : {}),
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
    tally(summary, result);
    try {
      options.onCheck?.(result);
    } catch {
      // A caller's progress reporter must not be able to change the verdict.
    }
  };

  for (const check of CHECKS) {
    // A caller-aborted run stops starting new checks rather than racing
    // each one against the signal individually: every not-yet-started
    // check is recorded the same way a traversal-budget exhaustion is
    // (skipped/inconclusive), never as a deployment failure.
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
  // An incomplete run is reported as such rather than as a pass: a
  // traversal budget that cut the walk short, or a check that could not
  // derive a trustworthy target, leaves conformance unproven.
  const status = failed ? "failed" : summary.inconclusive > 0 ? "inconclusive" : "passed";

  return {
    report_version: "1",
    aadp_version: version,
    base_url: origin,
    runner: { name: "aadp-conformance", version: runnerVersion() },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - startedMs,
    status,
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

async function runCheck(
  check: Check,
  ctxBase: Omit<CheckContext, "skip" | "inconclusive" | "warn" | "fail">
): Promise<CheckResult> {
  const signal = (outcome: CheckOutcome | { status: "failed"; message: string; details?: string[] }): never => {
    throw new CheckSignal(outcome);
  };
  const ctx: CheckContext = {
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
    if (err instanceof CheckSignal) {
      return {
        ...base,
        status: err.outcome.status,
        duration_ms: Date.now() - startedMs,
        ...(err.outcome.message ? { message: err.outcome.message } : {}),
        ...(err.outcome.details ? { details: err.outcome.details } : {}),
        ...("inconclusive" in err.outcome && err.outcome.inconclusive ? { inconclusive: true } : {}),
      };
    }
    // Handled here, once, for every check: running out of the caller's
    // traversal budget is the runner stopping itself, not the deployment
    // misbehaving — recording it as a failed check would blame the server
    // for the caller's own limit. The run is incomplete, so the skip is
    // marked inconclusive and the overall verdict cannot be "passed".
    if (err instanceof AadpDiscoveryBudgetExceededError) {
      return {
        ...base,
        status: "skipped",
        duration_ms: Date.now() - startedMs,
        message: `Stopped by this run's traversal budget: ${err.message}`,
        inconclusive: true,
      };
    }
    // Same reasoning as the budget case above: a mid-check abort is the
    // caller stopping the run, not the deployment misbehaving.
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
    return {
      ...base,
      status: "failed",
      duration_ms: Date.now() - startedMs,
      message: described.message,
      ...(described.details ? { details: described.details } : {}),
    };
  }
}

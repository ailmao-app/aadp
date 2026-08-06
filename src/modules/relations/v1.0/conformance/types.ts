/**
 * Public shapes of the Relations Module v1.0 conformance runner
 * (`AADP-REL-006`). `CheckResult`/`CheckStatus` are reused as-is from the
 * core conformance runner (`../../../../conformance/types.js`) — the shape
 * of "one check's outcome" has nothing module-specific about it — so a
 * `RelationsConformanceReport.checks` entry renders through the exact same
 * `renderCheckLines` the core report does. Everything else here is
 * Relations-specific: its own options, profiles, and report envelope,
 * per ADR-0007 "Conformance boundary" — core check IDs and `CHECKS` are
 * never touched by this module.
 */
import type { RetryOptions } from "../../../../client/http.js";
import type { UrlPolicy } from "../../../../client/url-policy.js";
import type { CheckResult, CheckStatus, ConformanceSummary } from "../../../../conformance/types.js";

export type { CheckResult, CheckStatus };

/**
 * `relations-core`: discovery/schema/pure-semantic checks only, no
 * resolution. `relations-full`: also resolves `sampleEntityUrl`'s targets
 * and paginates a collection it finds, bounded by the traversal budget
 * options below. `relations-authenticated`: `relations-full` with
 * `headers` supplied as an explicit test credential.
 */
export const RELATIONS_CONFORMANCE_PROFILES = ["relations-core", "relations-full", "relations-authenticated"] as const;
export type RelationsConformanceProfile = (typeof RELATIONS_CONFORMANCE_PROFILES)[number];

export interface RelationsConformanceOptions {
  /** Origin whose `.well-known/ai-manifest.json` declares `aadp:relations` — required for the `discovery.*` checks. */
  baseUrl?: string;
  profile?: RelationsConformanceProfile;
  /**
   * A live entity URL known to carry an `x_relations` (`relation-set`).
   * Required for every check beyond schema/discovery — AADP has no
   * routing template a runner could derive one from (same reasoning as
   * core `ConformanceOptions.negativeTargets`). Checks that need it are
   * `skipped`/`inconclusive` when it's omitted, never failed.
   */
  sampleEntityUrl?: string;
  /** A live `relation-registry` document URL. Required for `registry.*`. */
  sampleRegistryUrl?: string;
  /** A URL expected to answer AADP `not_found`/`forbidden`/`unauthorized` — for `http.errors`. */
  negativeTargetUrl?: string;
  /**
   * A URL on a DIFFERENT origin than `baseUrl`/`sampleEntityUrl` that
   * echoes back the request headers it received, as JSON
   * `{ received_headers: Record<string, string> }` (lowercase header
   * names) — for `relations.security.credentials`. Without this, that
   * check has no way to observe whether `headers` actually reached (or
   * was correctly stripped from) a cross-origin request, so it is
   * `inconclusive` rather than a self-asserted pass.
   */
  crossOriginProbeUrl?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  retry?: RetryOptions;
  allowPrivateNetwork?: boolean;
  urlPolicy?: UrlPolicy;
  headers?: Record<string, string>;
  crossOriginSafeHeaders?: string[];
  /** Relations traversal budget, threaded into `relations-full`/`relations-authenticated` resolution — see `RelationsTraversalLimits`. */
  /** Maximum collection pages fetched per paginated relation sampled by a check. Default 20 — deliberately small, this samples a live deployment, it does not mirror its catalogue. */
  maxPages?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxRequests?: number;
  maxTotalBytes?: number;
  maxCrossOriginRequests?: number;
  deadlineMs?: number;
  failOnWarning?: boolean;
  onCheck?: (result: CheckResult) => void;
  signal?: AbortSignal;
}

export interface RelationsConformanceReport {
  report_version: "1";
  /** Core protocol version (spec compatibility) — always "1.0" for this module version. */
  aadp_version: "1.0";
  module: { id: "aadp:relations"; version: "1.0" };
  /** This package's own npm version, for provenance. */
  package_version: string;
  base_url?: string;
  runner: { name: string; version: string };
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: "passed" | "failed" | "inconclusive";
  summary: ConformanceSummary;
  profile?: RelationsConformanceProfile;
  /** Resolved traversal/HTTP limits this run actually used, for reproducibility. */
  effective_limits: Record<string, number>;
  checks: CheckResult[];
}

export class InvalidRelationsConformanceOptionsError extends Error {
  readonly code = "invalid_options" as const;
  constructor(
    public readonly option: string,
    message: string
  ) {
    super(`Invalid Relations conformance option "${option}": ${message}`);
    this.name = "InvalidRelationsConformanceOptionsError";
  }
}

/**
 * Public shapes of the standalone conformance runner
 * (`docs/vi/IMPLEMENTATION_PLAN.md` §11 "Ưu tiên 1", issues
 * AADP-CONFORMANCE-001/002). Kept free of Vitest, of `node:test`, and of
 * any repo-only fixture so the same report shape is produced whether the
 * runner is called from this repo, from a published tarball, or from the
 * `aadp-conformance` CLI in someone else's CI.
 */
import type { UrlPolicy } from "../client/url-policy.js";

/** Protocol versions this runner knows how to exercise over HTTP. */
export const SUPPORTED_CONFORMANCE_VERSIONS = ["1.0"] as const;
export type ConformanceVersion = (typeof SUPPORTED_CONFORMANCE_VERSIONS)[number];

/**
 * `passed` and `failed` are the only two statuses that move the overall
 * verdict (unless `failOnWarning` is set). `warning` means the server is
 * conformant but published something a consumer should look at;
 * `skipped` means this runner did not reach a verdict — a prerequisite
 * check failed, the server published nothing to exercise, or a traversal
 * budget stopped the walk early. A skip is never evidence of conformance.
 */
export type CheckStatus = "passed" | "failed" | "warning" | "skipped";

export interface CheckResult {
  /** Stable machine-readable id, e.g. `manifest.schema`. Safe to pin in CI. */
  id: string;
  /** Group id the check belongs to, e.g. `manifest`. */
  group: string;
  /** Human-readable one-line description of what was checked. */
  title: string;
  status: CheckStatus;
  duration_ms: number;
  /** Why it failed/warned/was skipped. Absent on a clean pass. */
  message?: string;
  /** Supporting lines (schema errors, offending URLs, ...). */
  details?: string[];
  /**
   * Set on a `skipped` check that *should* have reached a verdict but
   * could not — a traversal budget stopped the walk, or no trustworthy
   * target could be derived. Such a run is reported `inconclusive`
   * overall rather than `passed`: an incomplete run must never be
   * certified as conformant by exit code `0`.
   *
   * A skip without this flag is a legitimate nothing-to-test (the server
   * publishes no `usage_guidance`, no sitemaps, ...), which does not
   * taint the verdict.
   */
  inconclusive?: boolean;
}

export interface ConformanceSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
  /** Subset of `skipped` that left the run incomplete. See `CheckResult.inconclusive`. */
  inconclusive: number;
}

/**
 * A condition that stopped the run before every check could be attempted
 * (unreachable origin, wrong protocol version, ...). Distinct from a
 * failed check: the server was never fully exercised.
 */
export interface ConformanceFatal {
  code: "unsupported_version" | "unreachable" | "invalid_options";
  message: string;
}

export interface ConformanceReport {
  /** Report envelope version, so a CI consumer can pin its parsing. */
  report_version: "1";
  /** Protocol version the run targeted. */
  aadp_version: ConformanceVersion;
  base_url: string;
  runner: { name: string; version: string };
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /**
   * `failed` if any check failed, a fatal occurred, or `failOnWarning`
   * and any check warned. `inconclusive` if nothing failed but the run
   * could not complete every check it should have (see
   * `CheckResult.inconclusive`) — never reported as `passed`.
   */
  status: "passed" | "failed" | "inconclusive";
  summary: ConformanceSummary;
  fatal?: ConformanceFatal;
  checks: CheckResult[];
}

export interface ConformanceOptions {
  /** Origin to exercise, e.g. `https://example.com`. Path is ignored. */
  baseUrl: string;
  /** Protocol version to target. Default `1.0`. */
  version?: string;
  /** Per-request timeout in ms. Default 10000 (client default). */
  timeoutMs?: number;
  /** Maximum redirect hops per request. Default 5 (client default). */
  maxRedirects?: number;
  /** Maximum response body size in bytes. Default 2 MiB (client default). */
  maxResponseBytes?: number;
  /** Traversal budget: maximum sitemap pages fetched across the whole run. Default 100. */
  maxPages?: number;
  /** Traversal budget: maximum entities fetched across the whole run. Default 200. */
  maxEntities?: number;
  /** Traversal budget: maximum sitemaps listed by the index. Default 100. */
  maxSitemaps?: number;
  /** Traversal budget: wall-clock deadline for the traversal walk, in ms. Default 120000. */
  deadlineMs?: number;
  /**
   * Allow the target (and its redirects) to resolve to a private,
   * loopback or link-local address. Off by default: the runner is
   * routinely pointed at an externally-supplied URL, so it inherits the
   * client's strict anti-SSRF policy unless a caller opts out for a
   * deployment it trusts.
   */
  allowPrivateNetwork?: boolean;
  /** Overrides `allowPrivateNetwork` entirely. For embedding in a host with its own policy. */
  urlPolicy?: UrlPolicy;
  /** Extra request headers, scoped to `baseUrl`'s origin unless listed in `crossOriginSafeHeaders`. */
  headers?: Record<string, string>;
  /** Header names that may survive a cross-origin hop. See `FetchJsonOptions`. */
  crossOriginSafeHeaders?: string[];
  /**
   * URLs to use for the negative-path checks, instead of deriving them.
   *
   * AADP fixes the *authoritative* URL of each document but no routing
   * template, so there is no general way to construct the URL of a
   * resource that does not exist: a query-based, opaque or signed entity
   * URL can resolve to something real when its last path segment is
   * swapped. Deriving is therefore attempted only for a plain path-based
   * URL with no query, and any other shape reports `inconclusive` asking
   * for these. Supply them to exercise the error envelope on a
   * deployment whose URLs the runner cannot reason about.
   */
  negativeTargets?: {
    /** URL of an entity that does not exist. Must answer `404` + a `not_found` envelope. */
    unknownEntityUrl?: string;
    /** URL of a sitemap for an unpublished type. Must answer `404` + an `unsupported_type` envelope. */
    unknownTypeUrl?: string;
  };
  /** Treat `warning` results as failures in `report.status`. Default false. */
  failOnWarning?: boolean;
  /** Called as each check settles, for progress output. Never throws into the run. */
  onCheck?: (result: CheckResult) => void;
}

/** `options.version` names a protocol version this runner cannot exercise. */
export class UnsupportedConformanceVersionError extends Error {
  readonly code = "unsupported_version" as const;

  constructor(public readonly version: string) {
    super(
      `Unsupported AADP conformance version "${version}". Supported: ${SUPPORTED_CONFORMANCE_VERSIONS.join(", ")}`
    );
    this.name = "UnsupportedConformanceVersionError";
  }
}

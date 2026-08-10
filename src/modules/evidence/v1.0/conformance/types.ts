/**
 * Public shapes of the Evidence Module v1.0 conformance runner
 * (conformance.md §6, §9). `CheckResult`/`CheckStatus` are reused as-is from
 * the core conformance runner — mirrors
 * `../../../answer/v1.0/conformance/types.ts`. Core check IDs and `CHECKS`,
 * and the Relations/Answer suites, are never touched by this module
 * (ADR-0007 "Conformance boundary").
 */
import type { RetryOptions } from "../../../../client/http.js";
import type { UrlPolicy } from "../../../../client/url-policy.js";
import type { CheckResult, CheckStatus, ConformanceSummary } from "../../../../conformance/types.js";

export type { CheckResult, CheckStatus };

export interface EvidenceConformanceOptions {
  /** Origin whose `.well-known/ai-manifest.json` declares `aadp:evidence` — required for `evidence.discovery`. */
  baseUrl?: string;
  /** A live entity URL known to have `type: "claim"` and an `x_evidence` wrapper. */
  sampleClaimUrl?: string;
  /** A live entity URL known to have `type: "evidence"` and an `x_evidence` wrapper. */
  sampleEvidenceUrl?: string;
  /** A live entity URL known to have `type: "answer"` whose `related_entities` cite a claim/evidence — required for `evidence.answer_link`. */
  sampleAnswerUrl?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  retry?: RetryOptions;
  allowPrivateNetwork?: boolean;
  urlPolicy?: UrlPolicy;
  headers?: Record<string, string>;
  crossOriginSafeHeaders?: string[];
  maxPages?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxRequests?: number;
  maxTotalBytes?: number;
  maxCrossOriginRequests?: number;
  deadlineMs?: number;
  /** Injected clock for `evidence.provenance` — defaults to `new Date()`. Pure/deterministic when supplied. */
  now?: Date;
  /** Age threshold `classifyEvidenceFreshness` is exercised with. Default 365 days. Never a pass/fail criterion — freshness is a classification, not a conformance requirement. */
  freshnessMaxAgeMs?: number;
  failOnWarning?: boolean;
  onCheck?: (result: CheckResult) => void;
  signal?: AbortSignal;
}

export interface EvidenceConformanceReport {
  report_version: "1";
  aadp_version: "1.0";
  module: { id: "aadp:evidence"; version: "1.0" };
  package_version: string;
  base_url?: string;
  runner: { name: string; version: string };
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: "passed" | "failed" | "inconclusive";
  summary: ConformanceSummary;
  effective_limits: Record<string, number>;
  checks: CheckResult[];
}

export class InvalidEvidenceConformanceOptionsError extends Error {
  readonly code = "invalid_options" as const;
  constructor(
    public readonly option: string,
    message: string
  ) {
    super(`Invalid Evidence conformance option "${option}": ${message}`);
    this.name = "InvalidEvidenceConformanceOptionsError";
  }
}

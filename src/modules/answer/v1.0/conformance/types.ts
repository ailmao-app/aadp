/**
 * Public shapes of the Answer Module v1.0 conformance runner
 * (specification.md "Conformance contract"). `CheckResult`/`CheckStatus`
 * are reused as-is from the core conformance runner — mirrors
 * `../../../relations/v1.0/conformance/types.ts`. Core check IDs and
 * `CHECKS` are never touched by this module (ADR-0007 "Conformance
 * boundary").
 */
import type { RetryOptions } from "../../../../client/http.js";
import type { UrlPolicy } from "../../../../client/url-policy.js";
import type { CheckResult, CheckStatus, ConformanceSummary } from "../../../../conformance/types.js";

export type { CheckResult, CheckStatus };

export interface AnswerConformanceOptions {
  /** Origin whose `.well-known/ai-manifest.json` declares `aadp:answer` — required for `answer.discovery`. */
  baseUrl?: string;
  /** A live entity URL known to have `type: "answer"` and an `x_answer` wrapper. Required for every check beyond discovery. */
  sampleEntityUrl?: string;
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
  /** Injected clock for `answer.freshness` — defaults to `new Date()`. Pure/deterministic when supplied. */
  now?: Date;
  failOnWarning?: boolean;
  onCheck?: (result: CheckResult) => void;
  signal?: AbortSignal;
}

export interface AnswerConformanceReport {
  report_version: "1";
  aadp_version: "1.0";
  module: { id: "aadp:answer"; version: "1.0" };
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

export class InvalidAnswerConformanceOptionsError extends Error {
  readonly code = "invalid_options" as const;
  constructor(
    public readonly option: string,
    message: string
  ) {
    super(`Invalid Answer conformance option "${option}": ${message}`);
    this.name = "InvalidAnswerConformanceOptionsError";
  }
}

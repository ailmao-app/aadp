/**
 * Injected-clock freshness classifier (specification.md "Freshness
 * contract" — "the client helper classifies fresh/stale using an injected
 * clock; the pure validator never uses the wall clock"). Pure: takes `now`
 * as a parameter rather than reading `Date.now()` itself.
 */
import type { AnswerDocumentV1 } from "../types.js";
import type { AnswerFreshnessState } from "./types.js";

/**
 * `stale` when `answer.freshness.expires_at` is set and `now` is at or
 * past it; `fresh` otherwise — including when `expires_at` is absent
 * ("no declared expiry" is not "permanently correct", per
 * specification.md, but this classifier only reports what freshness
 * metadata declares, not content truth).
 */
export function classifyAnswerFreshness(answer: AnswerDocumentV1, now: Date): AnswerFreshnessState {
  const expiresAt = answer.freshness.expires_at;
  if (!expiresAt) return "fresh";
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return "fresh"; // schema/semantic validation already rejects a malformed expires_at before this is reachable
  return now.getTime() >= expiry ? "stale" : "fresh";
}

/**
 * Injected-clock freshness classifier (specification.md §14 — freshness is a
 * CLIENT-computed classification, not publisher metadata: Evidence `1.0` has
 * no `expires_at` and no `freshness` field, and a pure validator never reads
 * the wall clock). Pure: takes `now` as a parameter rather than reading
 * `Date.now()` itself.
 */
import type { EvidenceDocumentV1 } from "../types.js";
import type { EvidenceFreshnessState } from "./types.js";

/**
 * "The date of the evidence" per specification.md §8: `modified_at` when
 * present, otherwise `published_at`. `retrieved_at` is deliberately NEVER
 * used — it records when the producer fetched the source, not when the
 * content is from, so using it would make a freshly re-fetched decade-old
 * document look current.
 */
export function evidenceContentDate(evidence: EvidenceDocumentV1): string {
  return evidence.provenance.modified_at ?? evidence.provenance.published_at;
}

/**
 * `stale` when the evidence's content date is more than `maxAgeMs` before
 * `now`; `fresh` otherwise. Classifies only what the provenance metadata
 * declares — it says nothing about whether the content is still correct, and
 * nothing about whether the source still exists.
 *
 * A `maxAgeMs` of `0` means "anything not published at this exact instant is
 * stale", which is a meaningful boundary rather than a mistake, so it is
 * accepted. An unparseable timestamp cannot happen for a schema-valid
 * document; if one is reached anyway it classifies `fresh` rather than
 * throwing, matching `classifyAnswerFreshness`.
 */
export function classifyEvidenceFreshness(evidence: EvidenceDocumentV1, now: Date, maxAgeMs: number): EvidenceFreshnessState {
  const date = Date.parse(evidenceContentDate(evidence));
  if (Number.isNaN(date)) return "fresh";
  return now.getTime() - date > maxAgeMs ? "stale" : "fresh";
}

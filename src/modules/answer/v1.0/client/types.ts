/**
 * Wire-adjacent types for the Answer v1.0 client layer. Deliberately
 * separate from `../types.ts` (the wire shapes) — mirrors
 * `../../../relations/v1.0/client/types.ts`.
 */
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { AnswerEntityReferenceV1 } from "../types.js";

export type AnswerFreshnessState = "fresh" | "stale";

export type AnswerTargetResolutionStatus = "resolved" | "forbidden" | "not-found" | "invalid" | "budget-exhausted";

/** Which Answer entity reference list a resolved entry came from — see `resolveAnswerTargets`. */
export type AnswerReferenceGroup = "related_entities" | "source_targets";

/** One `related_entities`/`authorship.source_targets` reference, as resolved by `resolveAnswerTargets`. */
export interface AnswerResolvedTargetEntry<T = unknown> {
  /** Which list this reference came from (`related_entities`, or `source_targets` for a generated summary). */
  group: AnswerReferenceGroup;
  /** Index of this reference within its own group's input list (not a combined-list index). */
  index: number;
  reference: AnswerEntityReferenceV1;
  status: AnswerTargetResolutionStatus;
  /** Present only when `status === "resolved"`. */
  entity?: EntityV1<T>;
  /** Present for every non-"resolved" status. */
  message?: string;
}

/**
 * Result of `resolveAnswerTargets`. `items` contains every `related_entities`
 * entry (in input order) followed by every `authorship.source_targets`
 * entry (in input order, only for a generated summary) — see
 * `AnswerResolvedTargetEntry.group`/`.index` to recover provenance.
 * `partial: true` means resolution stopped before every reference was
 * attempted (budget/abort) — per specification.md, a partial result MUST
 * NOT be reported as complete; every reference past the stopping point is
 * still present in `items` with `status: "budget-exhausted"` rather than
 * silently omitted.
 */
export interface AnswerResolvedTargets<T = unknown> {
  items: AnswerResolvedTargetEntry<T>[];
  partial: boolean;
}

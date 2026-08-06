/**
 * Wire-adjacent types for the Answer v1.0 client layer. Deliberately
 * separate from `../types.ts` (the wire shapes) — mirrors
 * `../../../relations/v1.0/client/types.ts`.
 */
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { AnswerEntityReferenceV1 } from "../types.js";

export type AnswerFreshnessState = "fresh" | "stale";

export type AnswerTargetResolutionStatus = "resolved" | "forbidden" | "not-found" | "invalid" | "budget-exhausted";

/** One `related_entities`/`source_targets` reference, as resolved by `resolveAnswerTargets`. */
export interface AnswerResolvedTargetEntry<T = unknown> {
  reference: AnswerEntityReferenceV1;
  status: AnswerTargetResolutionStatus;
  /** Present only when `status === "resolved"`. */
  entity?: EntityV1<T>;
  /** Present for every non-"resolved" status. */
  message?: string;
}

/**
 * Result of `resolveAnswerTargets`. `items` preserves the input
 * `related_entities` order. `partial: true` means resolution stopped
 * before every reference was attempted (budget/abort) — per
 * specification.md, a partial result MUST NOT be reported as complete;
 * every reference past the stopping point is still present in `items`
 * with `status: "budget-exhausted"` rather than silently omitted.
 */
export interface AnswerResolvedTargets<T = unknown> {
  items: AnswerResolvedTargetEntry<T>[];
  partial: boolean;
}

/**
 * `resolveAnswerTargets` — resolves an Answer document's `related_entities`
 * (specification.md "Related entity and Evidence boundary"). Delegates
 * every actual fetch to the Relations `1.0` resolver
 * (`resolveRelationTarget`), reusing its URL/DNS policy, authorization
 * behavior, scheduler and the caller-owned `RelationsTraversalBudgetState`
 * of the traversal parent — this module does not create a child budget,
 * does not retry outside that policy, and does not guess an expected type
 * from `target.id`'s prefix (specification.md "Answer client chỉ resolve
 * target khi caller opt in").
 */
import {
  resolveRelationTarget,
  type RelationsClientOptions,
  type RelationsTraversalBudgetState,
} from "../../../relations/v1.0/client/index.js";
import { AadpDiscoveryBudgetExceededError, AbortedError } from "../../../../client/v1.0/index.js";
import type { AnswerDocumentV1, AnswerEntityReferenceV1 } from "../types.js";
import type { AnswerResolvedTargetEntry, AnswerResolvedTargets } from "./types.js";

export interface AnswerResolveOptions extends RelationsClientOptions {
  /** Caller-owned traversal budget, shared with the rest of the traversal this resolution is part of. */
  budget: RelationsTraversalBudgetState;
}

function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

/**
 * Best-effort classification of a Relations resolution issue code into the
 * coarser Answer-level status taxonomy. `target_unresolvable` covers
 * several underlying causes the Relations resolver does not itself
 * distinguish further (network failure, non-404 request error, an
 * integrity mismatch) — mapped to "not-found" as the closest of the
 * documented statuses, since the target could not be produced either way.
 */
function statusFromIssueCode(code: string): "forbidden" | "not-found" | "invalid" {
  if (code === "unauthorized" || code === "forbidden") return "forbidden";
  if (code === "blocked_url") return "invalid";
  return "not-found";
}

/**
 * Resolves every reference in `answer.related_entities`, in input order.
 * Never throws for a per-reference issue — only a caller-visible
 * `partial: true` when the walk stopped early (budget exhausted / caller
 * abort via `options.signal`), per specification.md's partial-result
 * contract shared with Relations traversal. Every reference past the
 * stopping point is still present with `status: "budget-exhausted"`
 * rather than silently omitted.
 */
export async function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions
): Promise<AnswerResolvedTargets> {
  const references: AnswerEntityReferenceV1[] = answer.related_entities ?? [];
  const items: AnswerResolvedTargetEntry[] = [];
  let partial = false;

  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    if (partial) {
      items.push({ reference, status: "budget-exhausted", message: "Resolution stopped before this reference was attempted." });
      continue;
    }
    try {
      const result = await resolveRelationTarget(
        reference.target,
        reference.target_type,
        options,
        options.budget,
        `answer.related_entities[${i}]`
      );
      if (result.status === "resolved") {
        items.push({ reference, status: "resolved", entity: result.target.entity });
      } else if (result.status === "duplicate") {
        // Already resolved elsewhere in the same traversal — not re-fetched,
        // reported as resolved without its own entity payload (mirrors
        // Relations' hint-only duplicate edges).
        items.push({ reference, status: "resolved", message: "Already resolved elsewhere in this traversal (duplicate canonical target)." });
      } else {
        items.push({ reference, status: statusFromIssueCode(result.issue.code), message: result.issue.message });
      }
    } catch (err) {
      if (isGlobalStop(err)) {
        partial = true;
        items.push({ reference, status: "budget-exhausted", message: (err as Error).message });
        continue;
      }
      throw err;
    }
  }

  return { items, partial };
}

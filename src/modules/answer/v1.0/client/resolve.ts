/**
 * `resolveAnswerTargets` — resolves an Answer document's Answer entity
 * references: `related_entities` and, when `authorship.kind ===
 * "generated-summary"`, the mandatory provenance list `authorship.
 * source_targets` (specification.md "Related entity and Evidence
 * boundary"). Both groups use the same `AnswerEntityReferenceV1` shape and
 * the same resolution contract — a generated summary's source targets are
 * as much an "Answer target" as `related_entities`, and MUST be equally
 * reachable through this typed API and exercised by conformance
 * (`answer.references`), not silently skipped because they live under
 * `authorship` instead of at the top level.
 *
 * Delegates every actual fetch to the Relations `1.0` resolver
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
  type RelationsTraversalIssue,
} from "../../../relations/v1.0/client/index.js";
import {
  AadpDiscoveryBudgetExceededError,
  AbortedError,
  AadpRequestError,
  AadpSchemaValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
  UnsupportedAadpVersionError,
  BlockedUrlError,
} from "../../../../client/v1.0/index.js";
import type { AnswerDocumentV1, AnswerEntityReferenceV1 } from "../types.js";
import type { AnswerResolvedTargetEntry, AnswerResolvedTargets, AnswerReferenceGroup, AnswerTargetResolutionStatus } from "./types.js";

export interface AnswerResolveOptions extends RelationsClientOptions {
  /** Caller-owned traversal budget, shared with the rest of the traversal this resolution is part of. */
  budget: RelationsTraversalBudgetState;
}

function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

/**
 * Classifies a Relations resolution issue into the Answer-level status
 * taxonomy (`resolved | forbidden | not-found | invalid | budget-exhausted`),
 * using `issue.cause` (the original caught error — `RelationsTraversalIssue.
 * cause`) rather than the coarse `code` alone, since Relations'
 * `target_unresolvable` code collapses several distinct causes (a 404, a
 * 5xx, a timeout, a schema-invalid response, a checksum/id/type integrity
 * mismatch) into one bucket.
 *
 * - `forbidden`: HTTP 401/403 (already surfaced as Relations' own
 *   `unauthorized`/`forbidden` codes).
 * - `not-found`: HTTP 404 — the server explicitly says the resource is
 *   absent.
 * - `invalid`: a blocked URL, or a response that WAS received but is not a
 *   usable target — wrong schema, wrong checksum, declared id/type
 *   disagreeing with the reference, or an unsupported `aadp_version`.
 * - `invalid` (fallback): any other transport-level failure (timeout,
 *   too-many-redirects, oversized response, non-404 HTTP status, or an
 *   error type this mapping does not otherwise recognize). This is a
 *   deliberate, documented simplification — the Answer taxonomy has no
 *   sixth "unreachable"/"unknown" bucket — rather than defaulting such
 *   failures to `not-found`, which would misreport a transient/transport
 *   problem as a confirmed absence.
 */
function statusFromIssue(issue: RelationsTraversalIssue): AnswerTargetResolutionStatus {
  if (issue.code === "unauthorized" || issue.code === "forbidden") return "forbidden";
  if (issue.code === "blocked_url") return "invalid";

  const cause = issue.cause;
  if (cause instanceof AadpRequestError && cause.status === 404) return "not-found";
  if (
    cause instanceof AadpSchemaValidationError ||
    cause instanceof AadpChecksumMismatchError ||
    cause instanceof AadpIntegrityMismatchError ||
    cause instanceof UnsupportedAadpVersionError ||
    cause instanceof BlockedUrlError
  ) {
    return "invalid";
  }
  // Any other AadpRequestError status (5xx, etc.), a transport-level
  // failure (timeout, too many redirects, oversized response), or an
  // unrecognized error type — see docstring.
  return "invalid";
}

interface ReferenceEntry {
  group: AnswerReferenceGroup;
  index: number;
  reference: AnswerEntityReferenceV1;
}

/**
 * Ordering: `related_entities` in its own input order, followed by
 * `authorship.source_targets` (present only for `generated-summary`) in
 * its own input order — `items` tags every entry with `{group, index}` so
 * a caller never has to guess which list a result came from.
 */
function collectReferences(answer: AnswerDocumentV1): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  (answer.related_entities ?? []).forEach((reference, index) => entries.push({ group: "related_entities", index, reference }));
  if (answer.authorship.kind === "generated-summary") {
    answer.authorship.source_targets.forEach((reference, index) => entries.push({ group: "source_targets", index, reference }));
  }
  return entries;
}

/**
 * Resolves every `related_entities` and (for a generated summary)
 * `authorship.source_targets` reference — see module docstring for
 * ordering. Never throws for a per-reference issue — only a caller-visible
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
  const references = collectReferences(answer);
  const items: AnswerResolvedTargetEntry[] = [];
  let partial = false;

  for (const { group, index, reference } of references) {
    if (partial) {
      items.push({
        group,
        index,
        reference,
        status: "budget-exhausted",
        message: "Resolution stopped before this reference was attempted.",
      });
      continue;
    }
    try {
      const result = await resolveRelationTarget(
        reference.target,
        reference.target_type,
        options,
        options.budget,
        `answer.${group}[${index}]`
      );
      if (result.status === "resolved") {
        items.push({ group, index, reference, status: "resolved", entity: result.target.entity });
      } else if (result.status === "duplicate") {
        // Already resolved elsewhere in the same traversal (including
        // across groups — related_entities and source_targets share the
        // same caller-owned budget/visited-target set) — not re-fetched,
        // reported as resolved without its own entity payload (mirrors
        // Relations' hint-only duplicate edges).
        items.push({
          group,
          index,
          reference,
          status: "resolved",
          message: "Already resolved elsewhere in this traversal (duplicate canonical target).",
        });
      } else {
        items.push({ group, index, reference, status: statusFromIssue(result.issue), message: result.issue.message });
      }
    } catch (err) {
      if (isGlobalStop(err)) {
        partial = true;
        items.push({ group, index, reference, status: "budget-exhausted", message: (err as Error).message });
        continue;
      }
      throw err;
    }
  }

  return { items, partial };
}

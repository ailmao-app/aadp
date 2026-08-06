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
import { canonicalTargetKey } from "../../../relations/v1.0/client/budget.js";
import type { EntityV1 } from "../../../../client/v1.0/types.js";
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

interface CachedOutcome {
  status: AnswerTargetResolutionStatus;
  entity?: EntityV1;
  message?: string;
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
 *
 * `related_entities` and `source_targets` can name the same canonical
 * target — Relations' shared budget (`options.budget`) dedupes it so the
 * second occurrence is not re-fetched. That dedup ("duplicate") happens in
 * `chargeNode()` before the fetch/validation outcome is known, so it does
 * NOT by itself imply the target actually resolved successfully. This
 * function keeps its own `outcomes` cache (keyed by the same canonical
 * `{id, normalizedUrl}` Relations uses) of every outcome it has already
 * produced in THIS call, and replays that exact outcome — status, entity,
 * message — for a later "duplicate" occurrence instead of assuming
 * `resolved`. A "duplicate" for a target this call has not itself resolved
 * (visited earlier via the same caller-owned budget, outside this call) has
 * no known outcome to replay; that case is reported `resolved` with no
 * `entity`, consistent with how Relations' own traversal treats a
 * previously-visited node elsewhere in a walk.
 */
export async function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions
): Promise<AnswerResolvedTargets> {
  const references = collectReferences(answer);
  const items: AnswerResolvedTargetEntry[] = [];
  const outcomes = new Map<string, CachedOutcome>();
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
    const key = canonicalTargetKey(reference.target.id, reference.target.url);
    try {
      const result = await resolveRelationTarget(
        reference.target,
        reference.target_type,
        options,
        options.budget,
        `answer.${group}[${index}]`
      );
      if (result.status === "resolved") {
        const outcome: CachedOutcome = { status: "resolved", entity: result.target.entity };
        outcomes.set(key, outcome);
        items.push({ group, index, reference, ...outcome });
      } else if (result.status === "duplicate") {
        const cached = outcomes.get(key);
        if (cached) {
          // Replay the exact outcome this call already produced for the
          // same canonical target earlier (e.g. related_entities[0] failed
          // 404 -> source_targets[0] for the same target must also report
          // not-found, not a bare "resolved").
          items.push({
            group,
            index,
            reference,
            ...cached,
            message: cached.message
              ? `${cached.message} (duplicate of an earlier occurrence in this resolution.)`
              : "Duplicate of an earlier occurrence in this resolution.",
          });
        } else {
          // Visited before this call (same caller-owned budget reused
          // across an earlier resolveAnswerTargets/traversal step) — no
          // outcome of our own to replay; mirrors Relations' own
          // already-visited-elsewhere semantics.
          items.push({
            group,
            index,
            reference,
            status: "resolved",
            message: "Already resolved elsewhere in this traversal (duplicate canonical target).",
          });
        }
      } else {
        const outcome: CachedOutcome = { status: statusFromIssue(result.issue), message: result.issue.message };
        outcomes.set(key, outcome);
        items.push({ group, index, reference, ...outcome });
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

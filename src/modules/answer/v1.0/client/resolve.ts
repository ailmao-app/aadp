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
 * Every fetch goes through the shared, per-budget canonical resolution layer
 * (`../../../shared/canonical-resolution.js`), which owns the outcome cache,
 * in-flight join, budget-stop replay and resolution-context binding. That
 * layer was extracted FROM this file in `1.4.0` so Evidence `1.0` could share
 * one cache per budget with Answer; the layer in turn delegates every actual
 * fetch to the Relations `1.0` resolver (`resolveRelationTarget`), reusing
 * its URL/DNS policy, authorization behavior, scheduler and the caller-owned
 * `RelationsTraversalBudgetState` of the traversal parent — this module does
 * not create a child budget, does not retry outside that policy, and does not
 * guess an expected type from `target.id`'s prefix (specification.md — "the
 * Answer client resolves targets only when the caller opts in").
 */
import type { RelationsClientOptions, RelationsTraversalBudgetState } from "../../../relations/v1.0/client/index.js";
import {
  budgetResolutionStateFor,
  resolveCanonicalTarget,
  type CanonicalOutcome,
} from "../../../shared/canonical-resolution.js";
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { AnswerDocumentV1, AnswerEntityReferenceV1 } from "../types.js";
import type { AnswerResolvedTargetEntry, AnswerResolvedTargets, AnswerReferenceGroup, AnswerTargetResolutionStatus } from "./types.js";

export interface AnswerResolveOptions extends RelationsClientOptions {
  /** Caller-owned traversal budget, shared with the rest of the traversal this resolution is part of. */
  budget: RelationsTraversalBudgetState;
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
 * Builds the per-reference result entry from a canonical outcome, applying
 * THIS reference's own `target_type` — the id/type integrity check the
 * Relations resolver already ran only proves the entity matches *some*
 * reference's expectation (whichever one triggered the fetch); a later
 * reference declaring a different `target_type` for the same canonical
 * target must be re-checked against the entity itself, not inherit the first
 * reference's verdict.
 */
function entryFor(
  reference: AnswerEntityReferenceV1,
  canonical: CanonicalOutcome
): { status: AnswerTargetResolutionStatus; entity?: EntityV1; message?: string } {
  if (!canonical.ok) return { status: canonical.status, message: canonical.message };
  if (canonical.entity.type !== reference.target_type) {
    return {
      status: "invalid",
      message:
        `Target at ${reference.target.url} has type "${canonical.entity.type}", which does not match this ` +
        `reference's declared target_type "${reference.target_type}".`,
    };
  }
  return { status: "resolved", entity: canonical.entity };
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
 * NOT by itself imply the target actually resolved successfully. The shared
 * canonical resolution layer keeps its own per-budget record of every
 * canonical target's outcome — outliving a single call, race-safe across
 * concurrent calls, and shared with any other module resolver using the same
 * budget — and replays it, or awaits the SAME in-flight fetch, for a later
 * reference naming the same canonical key instead of assuming `resolved`.
 * Only a canonical key that layer has genuinely never touched (visited via
 * some other path entirely, e.g. a raw Relations traversal step over the same
 * budget) has nothing to replay or join; that case is reported `invalid` —
 * NOT `resolved` — since an unverified duplicate is not evidence of success.
 *
 * A canonical target's fetch/schema/checksum outcome is tracked separately
 * from any one reference's `target_type` check (`entryFor`): two
 * references can legally declare different `target_type` for the same
 * `{id, url}`, so a later reference is re-checked against the already-
 * fetched entity using ITS OWN declared type rather than inheriting
 * whichever reference happened to trigger the fetch — including the
 * inverse direction, where the triggering reference's type doesn't match
 * but a later reference's does.
 *
 * A shared-budget exhaustion that hits a canonical key mid-flight is itself
 * remembered per key — a LATER reference (this call or a later call) naming
 * that exact key would otherwise see Relations' bare `duplicate` (it was
 * charged as visited right before the throw) and misreport it `invalid`,
 * silently downgrading a budget stop into a data error and reporting
 * `partial: false` as if the walk had completed. That later reference
 * instead replays `budget-exhausted` (`partial: true`) — the same terminal
 * state the stop originally produced.
 *
 * `options.signal` is scoped to the ONE `resolveAnswerTargets` call it was
 * passed to, even for a canonical target whose fetch is shared with other
 * concurrent calls on the same budget: a canonical target's underlying
 * fetch is never tied to any individual caller's signal, and each reference
 * races only its OWN wait for that shared fetch against its OWN
 * `options.signal`. So one caller aborting cannot make an unrelated
 * concurrent caller's reference fail, cannot make it silently succeed off a
 * fetch it wanted no part of, and never gets recorded as a shared-budget-wide
 * stop — only a genuine `AadpDiscoveryBudgetExceededError` is. Cancellation
 * still actually happens, just never unilaterally: a reference whose
 * `options.signal` is ALREADY aborted never starts a new fetch at all (no
 * charge, no HTTP request on behalf of a call that already gave up), and a
 * canonical target's real, underlying fetch — still in-flight, still
 * consuming shared `maxRequests`/`maxTotalBytes` budget — is genuinely
 * cancelled the moment its LAST remaining waiter stops waiting, rather than
 * left to run to completion in the background against nobody.
 */
export async function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions
): Promise<AnswerResolvedTargets> {
  // Before `collectReferences` and before anything can charge the budget or
  // touch the network: a context mismatch must leave the budget untouched.
  const state = budgetResolutionStateFor(options.budget, options);
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
    const resolution = await resolveCanonicalTarget(
      state,
      reference.target,
      reference.target_type,
      options,
      `answer.${group}[${index}]`
    );
    if (resolution.status === "stopped") {
      partial = true;
      items.push({ group, index, reference, status: "budget-exhausted", message: resolution.message });
      continue;
    }
    items.push({ group, index, reference, ...entryFor(reference, resolution.outcome) });
  }

  return { items, partial };
}

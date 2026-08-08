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

/**
 * A canonical `{id, normalizedUrl}` target's outcome, independent of any
 * one reference's `target_type` — separated on purpose from the
 * per-reference entry `resolveAnswerTargets` ultimately reports (see
 * `entryFor`). `ok: true` means the URL was fetched and the response is a
 * schema/checksum-valid, id-matching entity: whether THAT counts as
 * `resolved` for a given reference still depends on whether the entity's
 * `type` matches that reference's own declared `target_type`, which two
 * references pointing at the same canonical target are allowed to declare
 * differently. `ok: false` is a transport/schema/checksum/id-level failure
 * that no reference's `target_type` could have avoided, so it applies to
 * every reference alike.
 */
type CanonicalOutcome = { ok: true; entity: EntityV1 } | { ok: false; status: AnswerTargetResolutionStatus; message?: string };

/**
 * Builds the per-reference result entry from a canonical outcome, applying
 * THIS reference's own `target_type` — the id/type integrity check
 * `resolveRelationTarget` already ran only proves the entity matches
 * *some* reference's expectation (whichever one triggered the fetch); a
 * later reference declaring a different `target_type` for the same
 * canonical target must be re-checked against the entity itself, not
 * inherit the first reference's verdict.
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
 * Resolves one canonical target exactly once: fetches/validates it via
 * Relations (`resolveRelationTarget`, using `seedTargetType` — whichever
 * reference happens to trigger the fetch) and folds the result into a
 * `CanonicalOutcome` that is NOT yet checked against any particular
 * reference's `target_type` (see `entryFor`). A Relations-level
 * `target_type` mismatch against `seedTargetType` does not discard the
 * fetched entity — `RelationsTraversalIssue.entity` carries it precisely so
 * a differently-typed reference for the same canonical target can still
 * reuse it without a second fetch. `status: "duplicate"` (the canonical key
 * was already charged by some path outside this resolver's own cache —
 * see `resolveCanonicalTarget`'s caller) has no fetched entity or issue to
 * fall back on, so it is reported `invalid`, never guessed `resolved`.
 */
async function resolveCanonicalTarget(
  reference: AnswerEntityReferenceV1,
  options: AnswerResolveOptions,
  context: string
): Promise<CanonicalOutcome> {
  const result = await resolveRelationTarget(reference.target, reference.target_type, options, options.budget, context);
  // `resolveRelationTarget`'s own "resolved" status always sets `entity`
  // (`ResolvedRelationTarget.entity` is optional only for the hint-only
  // shape a Relations *traversal* can produce for an unfetched collection
  // item — never for a directly resolved target like this one).
  if (result.status === "resolved") return { ok: true, entity: result.target.entity! };
  if (result.status === "duplicate") {
    return {
      ok: false,
      status: "invalid",
      message: "Already visited elsewhere in this traversal (duplicate canonical target), but this resolver has no recorded outcome to replay for it.",
    };
  }
  if (result.issue.entity) return { ok: true, entity: result.issue.entity };
  return { ok: false, status: statusFromIssue(result.issue), message: result.issue.message };
}

/**
 * Per-budget state shared across every `resolveAnswerTargets` call over
 * the same caller-owned `budget` — both across sequential calls (a
 * `RelationsTraversalBudgetState` is explicitly caller-owned and can live
 * across many calls in the same parent traversal) and across CONCURRENT
 * calls (nothing about a shared budget forbids `Promise.all`-ing several
 * `resolveAnswerTargets` calls, and the package's own scheduler layer
 * supports concurrent in-flight requests).
 *
 * - `outcomes`: every canonical target this resolver has ITSELF already
 *   settled an outcome for — replayed for any later reference naming the
 *   same canonical `{id, url}`, keeping `resolveRelationTarget`'s own
 *   `chargeNode` dedup honest (fetched/charged at most once per canonical
 *   target for the lifetime of the budget).
 * - `pending`: a canonical target's resolution while it is still in
 *   flight. This is what makes concurrent calls race-safe: a reference
 *   that finds neither `outcomes` nor `pending` populated for its
 *   canonical key becomes that key's "owner" and synchronously (before its
 *   first `await`) records its in-flight promise in `pending` — so any
 *   other reference for the same key, from this call OR a concurrently
 *   running call sharing the same budget, that runs before the owner's
 *   fetch settles finds `pending` already populated and awaits the SAME
 *   promise instead of racing `resolveRelationTarget` a second time (which
 *   would just get Relations' bare `duplicate` with nothing to replay).
 *   Cleared once the owner's promise settles; `outcomes` is the permanent
 *   record from then on.
 * - `globalStops`: the canonical key that was in flight when a global stop
 *   (`AadpDiscoveryBudgetExceededError`/`AbortedError`) hit it. `chargeNode`
 *   marks a target visited BEFORE the budget/cycle check that can still
 *   throw for it, so that one key's dedup entry survives the throw — a
 *   later call for the very same key gets Relations' bare `duplicate` with
 *   no budget re-check (every OTHER, not-yet-visited key still re-triggers
 *   the same monotonic budget/abort condition on its own, since none of
 *   `chargeNode`'s dimensions ever un-exceed once tripped). Without this,
 *   that one key alone would silently downgrade from the stop that
 *   produced it to a guessed `invalid` on any later replay. Recorded right
 *   before `pending` is cleared so a later lookup for this key is turned
 *   back into the same `budget-exhausted` stop instead of ever reaching
 *   `resolveCanonicalTarget` again.
 */
interface BudgetResolutionState {
  outcomes: Map<string, CanonicalOutcome>;
  pending: Map<string, Promise<CanonicalOutcome>>;
  globalStops: Map<string, Error>;
}

const budgetState = new WeakMap<RelationsTraversalBudgetState, BudgetResolutionState>();

function stateFor(budget: RelationsTraversalBudgetState): BudgetResolutionState {
  let state = budgetState.get(budget);
  if (!state) {
    state = { outcomes: new Map(), pending: new Map(), globalStops: new Map() };
    budgetState.set(budget, state);
  }
  return state;
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
 * function keeps its own per-budget state (`stateFor` — outlives a single
 * call, and is race-safe across concurrent calls sharing the same budget;
 * see its docstring) of every canonical target's outcome, and replays it —
 * or, if still in flight, awaits the SAME fetch — for a later reference
 * naming the same canonical key instead of assuming `resolved`. Only a
 * canonical key this Answer resolver has genuinely never touched (visited
 * via some other path entirely, e.g. a raw Relations traversal step over
 * the same budget) has nothing to replay or join; that case is reported
 * `invalid` — NOT `resolved` — since an unverified duplicate is not
 * evidence of success.
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
 * A global stop that hits a canonical key mid-flight is itself remembered
 * per key (`BudgetResolutionState.globalStops`) — a LATER reference (this
 * call or a later call) naming that exact key would otherwise see
 * Relations' bare `duplicate` (it was charged as visited right before the
 * throw) and misreport it `invalid`, silently downgrading a budget/abort
 * stop into a data error and reporting `partial: false` as if the walk had
 * completed. That later reference instead replays `budget-exhausted`
 * (`partial: true`) — the same terminal state the stop originally produced.
 */
export async function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions
): Promise<AnswerResolvedTargets> {
  const references = collectReferences(answer);
  const items: AnswerResolvedTargetEntry[] = [];
  const { outcomes, pending, globalStops } = stateFor(options.budget);
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
    const priorStop = globalStops.get(key);
    if (priorStop) {
      // This exact canonical key was mid-flight when a global stop hit it
      // earlier on this budget (this call or an earlier one) — replay that
      // stop rather than falling through to `resolveCanonicalTarget`,
      // which would only see Relations' bare `duplicate` (chargeNode
      // already marked the key visited before the throw) and misreport it
      // `invalid`. See `BudgetResolutionState.globalStops`.
      partial = true;
      items.push({ group, index, reference, status: "budget-exhausted", message: priorStop.message });
      continue;
    }
    let canonical = outcomes.get(key);
    if (!canonical) {
      // No settled outcome yet. Join an in-flight fetch for this canonical
      // key if one is already running (this call or a concurrent one over
      // the same budget); otherwise become its owner. Everything up to and
      // including `pending.set` below is synchronous — no `await` — so no
      // other reference can observe a state where the key is charged
      // (`resolveCanonicalTarget` -> `resolveRelationTarget` ->
      // `chargeNode`) without also being in `pending`.
      let inflight = pending.get(key);
      const isOwner = !inflight;
      if (!inflight) {
        inflight = resolveCanonicalTarget(reference, options, `answer.${group}[${index}]`);
        pending.set(key, inflight);
      }
      try {
        canonical = await inflight;
      } catch (err) {
        if (isOwner) pending.delete(key);
        if (isGlobalStop(err)) {
          if (isOwner) globalStops.set(key, err as Error);
          partial = true;
          items.push({ group, index, reference, status: "budget-exhausted", message: (err as Error).message });
          continue;
        }
        throw err;
      }
      if (isOwner) {
        pending.delete(key);
        outcomes.set(key, canonical);
      }
    }
    items.push({ group, index, reference, ...entryFor(reference, canonical) });
  }

  return { items, partial };
}

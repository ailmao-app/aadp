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
  AadpClientError,
  AadpDiscoveryBudgetExceededError,
  AbortedError,
  AadpRequestError,
  AadpSchemaValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
  UnsupportedAadpVersionError,
  BlockedUrlError,
} from "../../../../client/v1.0/index.js";
import { canonicalTargetKey, releaseNode } from "../../../relations/v1.0/client/budget.js";
import { resolutionContextDigest, type ResolutionContextOptions } from "./resolution-context.js";
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
 * Awaits `promise` but rejects early with `AbortedError` if `signal` fires
 * first — WITHOUT cancelling `promise` itself. A canonical target's
 * underlying fetch (`resolveCanonicalTarget`) can be shared across several
 * concurrent `resolveAnswerTargets` calls, each with its OWN independent
 * `options.signal` (see `stateFor`'s docstring) — this is what keeps one
 * caller's cancellation scoped to just that caller's own wait, never
 * reaching (let alone killing) a fetch other callers are still relying on.
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined, url: string): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AbortedError(url, signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError(url, signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
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
 *
 * Takes `signal` as its own parameter rather than reading `options.signal`:
 * this fetch is keyed by canonical target, not by caller, and may be shared
 * by several concurrent `resolveAnswerTargets` calls each with their OWN
 * independent signal (see `stateFor`'s docstring) — no single caller's
 * `options.signal` may unilaterally cancel a fetch other callers still
 * depend on. The caller below instead passes an INTERNAL `AbortController`'s
 * signal, owned by and scoped to this one canonical fetch, aborted only once
 * every reference waiting on it has stopped waiting (see `PendingFetch`) —
 * so cancellation still actually happens (no zombie background request once
 * truly nobody wants the result), just never at one caller's unilateral say.
 */
async function resolveCanonicalTarget(
  reference: AnswerEntityReferenceV1,
  options: AnswerResolveOptions,
  signal: AbortSignal,
  context: string
): Promise<CanonicalOutcome> {
  const result = await resolveRelationTarget(reference.target, reference.target_type, { ...options, signal }, options.budget, context);
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
 *   flight, as a `PendingFetch` — the shared promise, the `AbortController`
 *   that OWNS this fetch's cancellation (never any one caller's own
 *   `options.signal` — see `resolveCanonicalTarget`'s docstring), and a
 *   `waiters` count. This is what makes concurrent calls race-safe: a
 *   reference that finds neither `outcomes` nor `pending` populated for its
 *   canonical key creates the fetch and synchronously (before its first
 *   `await`) records it in `pending` — so any other reference for the same
 *   key, from this call OR a concurrently running call sharing the same
 *   budget, that runs before the fetch settles finds `pending` already
 *   populated and awaits the SAME promise instead of racing
 *   `resolveRelationTarget` a second time (which would just get Relations'
 *   bare `duplicate` with nothing to replay). Every reference that starts
 *   waiting increments `waiters`; when the LAST one stops waiting (settled,
 *   or bailed out early via its own `raceSignal`) with the fetch still in
 *   flight, `waiters` hits `0` and the entry's `AbortController` is
 *   aborted — real cancellation happens once truly nobody depends on the
 *   result anymore, without any single caller being able to force it
 *   unilaterally while others still wait. `pending`/`outcomes`/`globalStops`
 *   are mutated exactly once, by a `.then()` attached to the shared promise
 *   AT CREATION TIME — deliberately independent of how any individual
 *   reference later awaits it, and guarded to only delete the entry it
 *   itself created (never a NEWER entry a later reference may have since
 *   started for the same key after this one was evicted).
 * - `globalStops`: the canonical key that was in flight when a genuine
 *   shared-budget exhaustion (`AadpDiscoveryBudgetExceededError`) hit it.
 *   `chargeNode` marks a target visited BEFORE the budget/cycle check that
 *   can still throw for it, so that one key's dedup entry survives the
 *   throw — a later call for the very same key gets Relations' bare
 *   `duplicate` with no budget re-check (every OTHER, not-yet-visited key
 *   still re-triggers the same monotonic budget condition on its own,
 *   since none of `chargeNode`'s dimensions ever un-exceed once tripped).
 *   Without this, that one key alone would silently downgrade from the
 *   stop that produced it to a guessed `invalid` on any later replay.
 *   Deliberately NEVER records an `AbortedError`: cancellation via
 *   `options.signal` is scoped to the ONE caller that passed that signal —
 *   `resolveCanonicalTarget` doesn't even forward it to the shared fetch
 *   (see its docstring) — so it must never poison a shared, budget-wide,
 *   cross-caller record the way a real budget exhaustion legitimately does.
 */
/** A canonical target's in-flight resolution — see `BudgetResolutionState.pending`. */
interface PendingFetch {
  promise: Promise<CanonicalOutcome>;
  /** Owns this fetch's cancellation. Aborted only once `waiters` hits `0` — never by any one caller's own `options.signal`. */
  controller: AbortController;
  /** Count of references currently awaiting `promise` (this call or a concurrent one sharing the budget). */
  waiters: number;
}

interface BudgetResolutionState {
  outcomes: Map<string, CanonicalOutcome>;
  pending: Map<string, PendingFetch>;
  globalStops: Map<string, Error>;
  /**
   * Digest of the request-affecting options this budget's state was FIRST
   * used with — see `resolution-context.ts`. `outcomes`/`pending` are keyed
   * by canonical target alone, so without this a second call could replay
   * (or join) a request made under different credentials, URL policy or
   * response-size cap. Only the digest is kept; raw header values never are.
   */
  contextDigest: string;
}

const budgetState = new WeakMap<RelationsTraversalBudgetState, BudgetResolutionState>();

/**
 * Returns the budget's resolution state, binding `options`' resolution
 * context to it on first use.
 *
 * Throws `AadpClientError` (`code: "resolution_context_mismatch"`) when a
 * later call's context differs — fail closed, BEFORE any cache replay,
 * `pending` join, budget charge or HTTP request, so a rejected call is a
 * no-op rather than a half-applied one. This is a caller programming error
 * (one budget must mean one immutable request configuration), not a data
 * condition, so it is not expressible as a per-reference resolution status:
 * reporting it as `forbidden`/`invalid` would hide the mistake inside an
 * ordinary-looking result.
 *
 * The message deliberately names no option, header or digest — it must stay
 * safe to log wherever an `AadpClientError` already is.
 */
function stateFor(
  budget: RelationsTraversalBudgetState,
  options: ResolutionContextOptions
): BudgetResolutionState {
  const contextDigest = resolutionContextDigest(options);
  const state = budgetState.get(budget);
  if (!state) {
    const created: BudgetResolutionState = {
      outcomes: new Map(),
      pending: new Map(),
      globalStops: new Map(),
      contextDigest,
    };
    budgetState.set(budget, created);
    return created;
  }
  if (state.contextDigest !== contextDigest) {
    throw new AadpClientError(
      "This traversal budget was first used with a different resolution context. " +
        "A budget's cached results and in-flight requests are shared, so it must be used with one " +
        "immutable set of request options (credentials, URL policy, cross-origin-safe headers, " +
        "root origin, timeout, redirect/response limits and retry policy). " +
        "Use a separate budget per resolution context.",
      "resolution_context_mismatch"
    );
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
 * A shared-budget exhaustion that hits a canonical key mid-flight is itself
 * remembered per key (`BudgetResolutionState.globalStops`) — a LATER
 * reference (this call or a later call) naming that exact key would
 * otherwise see Relations' bare `duplicate` (it was charged as visited
 * right before the throw) and misreport it `invalid`, silently downgrading
 * a budget stop into a data error and reporting `partial: false` as if the
 * walk had completed. That later reference instead replays
 * `budget-exhausted` (`partial: true`) — the same terminal state the stop
 * originally produced.
 *
 * `options.signal` is scoped to the ONE `resolveAnswerTargets` call it was
 * passed to, even for a canonical target whose fetch is shared with other
 * concurrent calls on the same budget: a canonical target's underlying
 * fetch is never tied to any individual caller's signal (`resolveCanonicalTarget`
 * takes an internally-owned one instead), and each reference races only its
 * OWN wait for that shared fetch against its OWN `options.signal`
 * (`raceSignal`). So one caller aborting cannot make an unrelated
 * concurrent caller's reference fail, cannot make it silently succeed off a
 * fetch it wanted no part of, and never gets recorded as a shared-budget-wide
 * stop — only a genuine `AadpDiscoveryBudgetExceededError` is (`globalStops`,
 * above). Cancellation still actually happens, just never unilaterally: a
 * reference whose `options.signal` is ALREADY aborted never starts a new
 * fetch at all (no charge, no HTTP request on behalf of a call that already
 * gave up), and a canonical target's real, underlying fetch — still
 * in-flight, still consuming shared `maxRequests`/`maxTotalBytes` budget —
 * is genuinely cancelled the moment its LAST remaining waiter stops waiting
 * (`PendingFetch.waiters` reaching `0`), rather than left to run to
 * completion in the background against nobody.
 */
export async function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions
): Promise<AnswerResolvedTargets> {
  // Before `collectReferences` and before anything can charge the budget or
  // touch the network: a context mismatch must leave the budget untouched.
  const { outcomes, pending, globalStops } = stateFor(options.budget, options);
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
      // the same budget); otherwise start one — but never for a reference
      // whose own signal is ALREADY aborted: it must not charge/start real
      // work (`resolveCanonicalTarget` -> `resolveRelationTarget` ->
      // `chargeNode` -> HTTP) on behalf of a call that has already given
      // up. Everything up to and including `pending.set` below is
      // synchronous — no `await` — so no other reference can observe a
      // state where the key is charged without also being in `pending`.
      let entry = pending.get(key);
      if (!entry && options.signal?.aborted) {
        partial = true;
        items.push({
          group,
          index,
          reference,
          status: "budget-exhausted",
          message: new AbortedError(reference.target.url, options.signal.reason).message,
        });
        continue;
      }
      if (!entry) {
        const controller = new AbortController();
        const promise = resolveCanonicalTarget(reference, options, controller.signal, `answer.${group}[${index}]`);
        entry = { promise, controller, waiters: 0 };
        pending.set(key, entry);
        // Settle shared bookkeeping exactly once, driven by the fetch's OWN
        // outcome — not by whichever reference happens to be awaiting it
        // below, since `raceSignal` lets any individual reference bail out
        // of its own wait early without affecting this shared promise or
        // its eventual result. See `BudgetResolutionState`.
        //
        // `pending.get(key) === entry` gates the WHOLE settlement, not just
        // the eviction: once `waiters` hit `0` this attempt was abandoned
        // and synchronously evicted/released/aborted (see the `finally`
        // below), so it is no longer this key's current attempt and MUST
        // NOT commit anything. It can still settle afterwards — an abort
        // landing after the transport's own last cancellation check leaves
        // a purely synchronous tail, so the promise resolves successfully
        // even though nobody is waiting — and committing that would cache a
        // response for a request its caller already abandoned, quite
        // possibly over a NEWER attempt already in flight for the same key
        // under different options. Same for `globalStops`: skipping a
        // budget error here loses nothing, since every budget dimension is
        // monotonic and the replacement attempt re-trips it on its own.
        // Releasing the node charge is likewise never done here — that also
        // happens synchronously at abandonment, because by now a new
        // attempt may already hold the charge and releasing THAT would be a
        // stale-promise ABA bug.
        promise.then(
          (settled) => {
            if (pending.get(key) !== entry) return;
            pending.delete(key);
            outcomes.set(key, settled);
          },
          (err) => {
            if (pending.get(key) !== entry) return;
            pending.delete(key);
            if (err instanceof AadpDiscoveryBudgetExceededError) globalStops.set(key, err);
          }
        );
      }
      entry.waiters++;
      try {
        canonical = await raceSignal(entry.promise, options.signal, reference.target.url);
      } catch (err) {
        if (isGlobalStop(err)) {
          partial = true;
          items.push({ group, index, reference, status: "budget-exhausted", message: (err as Error).message });
          continue;
        }
        throw err;
      } finally {
        entry.waiters--;
        // `pending.get(key) === entry` is true here iff this fetch has NOT
        // already settled through its normal completion path — the
        // creation-time `.then()` above (registered before any waiter's
        // own await) always runs, and evicts this exact `entry`, before a
        // waiter's own `raceSignal`-wrapped await can resume from a NORMAL
        // settle. It reads false only once that has already happened
        // (nothing left to abandon — `outcomes`/`globalStops` already has
        // the real, permanent result) — or once some other waiter already
        // abandoned this very entry (only possible after eviction, so no
        // waiter still holding this `entry` can observe `waiters` fall to
        // `0` a second time for it).
        if (entry.waiters === 0 && pending.get(key) === entry) {
          // Still genuinely in flight, and now has zero dependents:
          // abandon it. Evicted synchronously, right now — NOT left for
          // the (async) rejection this abort is about to cause to clean up
          // later — so a reference arriving even immediately after this
          // point can never join a fetch that's already been abandoned; it
          // starts a fresh attempt instead. `chargeNode` already marked
          // this canonical key visited before the fetch started, so that
          // fresh attempt also needs the charge released right now — not
          // deferred to the fetch's own eventual rejection, which could
          // settle after an arbitrary number of later callers have already
          // run — otherwise every later, unrelated attempt at this exact
          // target would see Relations' bare `duplicate` and be stuck
          // reporting `invalid` forever. Finally, actually cancel the real
          // underlying HTTP work rather than leaving it to complete in the
          // background against nobody, still consuming shared
          // `maxRequests`/`maxTotalBytes` budget for a result no caller
          // remains to receive.
          pending.delete(key);
          releaseNode(options.budget, reference.target.id, reference.target.url);
          entry.controller.abort(new AbortedError(reference.target.url, "no caller is waiting on this canonical target's resolution anymore"));
        }
      }
    }
    items.push({ group, index, reference, ...entryFor(reference, canonical) });
  }

  return { items, partial };
}

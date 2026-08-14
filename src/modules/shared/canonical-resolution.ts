/**
 * Shared, per-budget canonical target resolution — INTERNAL infrastructure
 * for module clients (ADR-0010 §10, specification.md §16 of Evidence `1.0`).
 *
 * Extracted verbatim from the Answer `1.0` client in `1.4.0`, where it had
 * been living as `resolveAnswerTargets`' private state. It was never an
 * Answer-private detail: the state is keyed by the caller-owned traversal
 * budget, and a canonical key that a resolver has never itself touched — say,
 * one charged by a raw Relations step, or by a DIFFERENT module resolver
 * walking the same budget — has no recorded outcome to replay, and gets
 * reported `invalid`. So two modules resolving over one budget through two
 * separate caches would manufacture false `invalid` results for each other.
 * One cache per budget, shared by every module, is what makes a mixed
 * Answer/Evidence walk correct.
 *
 * This module MUST NOT be exported from any public subpath — the same reason
 * Relations keeps `releaseNode` module-internal: its preconditions are not
 * checkable from outside, and a caller holding the raw state could replay an
 * outcome under a request context it never actually used.
 */
import {
  resolveRelationTarget,
  type RelationsClientOptions,
  type RelationsTraversalBudgetState,
  type RelationsTraversalIssue,
} from "../relations/v1.0/client/index.js";
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
} from "../../client/v1.0/index.js";
import { canonicalTargetKey, normalizeTargetUrl, releaseNode } from "../relations/v1.0/client/budget.js";
import { resolutionContextDigest, type ResolutionContextOptions } from "./resolution-context.js";
import type { EntityV1 } from "../../client/v1.0/types.js";
import type { RelationTargetV1 } from "../relations/v1.0/types.js";

/**
 * Resolution status vocabulary, released as `AnswerTargetResolutionStatus`
 * in Answer `1.0` and reused unchanged by Evidence `1.0` (specification.md
 * §10.2 — "no new enum"). Restated structurally here rather than imported
 * from a module's public types so this internal layer does not depend on any
 * one module.
 */
export type CanonicalResolutionStatus = "resolved" | "forbidden" | "not-found" | "invalid" | "budget-exhausted";

/** Caller-owned budget plus the per-call request options every fetch is made with. */
export interface CanonicalResolutionOptions extends RelationsClientOptions {
  /** Caller-owned traversal budget, shared with the rest of the traversal this resolution is part of. */
  budget: RelationsTraversalBudgetState;
}

function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

/**
 * Awaits `promise` but rejects early with `AbortedError` if `signal` fires
 * first — WITHOUT cancelling `promise` itself. A canonical target's
 * underlying fetch (`fetchCanonicalTarget`) can be shared across several
 * concurrent resolver calls, each with its OWN independent `options.signal`
 * (see `budgetResolutionStateFor`'s docstring) — this is what keeps one
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
 * Classifies a Relations resolution issue into the shared status taxonomy
 * (`resolved | forbidden | not-found | invalid | budget-exhausted`), using
 * `issue.cause` (the original caught error — `RelationsTraversalIssue.cause`)
 * rather than the coarse `code` alone, since Relations' `target_unresolvable`
 * code collapses several distinct causes (a 404, a 5xx, a timeout, a
 * schema-invalid response, a checksum/id/type integrity mismatch) into one
 * bucket.
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
 *   deliberate, documented simplification — the taxonomy has no sixth
 *   "unreachable"/"unknown" bucket — rather than defaulting such failures to
 *   `not-found`, which would misreport a transient/transport problem as a
 *   confirmed absence.
 */
function statusFromIssue(issue: RelationsTraversalIssue): CanonicalResolutionStatus {
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

/**
 * A canonical `{id, normalizedUrl}` target's outcome, independent of any one
 * reference's `target_type` — separated on purpose from the per-reference
 * verdict a caller ultimately reports. `ok: true` means the URL was fetched
 * and the response is a schema/checksum-valid, id-matching entity: whether
 * THAT counts as `resolved` for a given reference still depends on whether
 * the entity's `type` matches that reference's own declared `target_type`,
 * which two references pointing at the same canonical target are allowed to
 * declare differently. `ok: false` is a transport/schema/checksum/id-level
 * failure that no reference's `target_type` could have avoided, so it applies
 * to every reference alike.
 */
export type CanonicalOutcome =
  | { ok: true; entity: EntityV1 }
  | {
      ok: false;
      status: CanonicalResolutionStatus;
      message?: string;
      /**
       * The Relations issue code behind the failure, when there was one.
       * Carried because `status` alone is lossy and the two modules
       * deliberately classify one case differently: Answer `1.0` released
       * `blocked_url` as `invalid`, while Evidence `1.0` specifies it as
       * `forbidden` — "access control, not a broken graph" (specification.md
       * §10.2). A module that does not read this field is unaffected, which
       * is what keeps the Answer mapping exactly as released.
       */
      issueCode?: string;
    };

/**
 * Fetches one canonical target exactly once: fetches/validates it via
 * Relations (`resolveRelationTarget`, using `seedTargetType` — whichever
 * reference happens to trigger the fetch) and folds the result into a
 * `CanonicalOutcome` that is NOT yet checked against any particular
 * reference's `target_type`. A Relations-level `target_type` mismatch against
 * `seedTargetType` does not discard the fetched entity —
 * `RelationsTraversalIssue.entity` carries it precisely so a
 * differently-typed reference for the same canonical target can still reuse
 * it without a second fetch. `status: "duplicate"` (the canonical key was
 * already charged by some path outside this layer's own cache) has no fetched
 * entity or issue to fall back on, so it is reported `invalid`, never guessed
 * `resolved`.
 *
 * Takes `signal` as its own parameter rather than reading `options.signal`:
 * this fetch is keyed by canonical target, not by caller, and may be shared
 * by several concurrent calls each with their OWN independent signal — no
 * single caller's `options.signal` may unilaterally cancel a fetch other
 * callers still depend on. The caller below instead passes an INTERNAL
 * `AbortController`'s signal, owned by and scoped to this one canonical
 * fetch, aborted only once every reference waiting on it has stopped waiting
 * (see `PendingFetch`) — so cancellation still actually happens (no zombie
 * background request once truly nobody wants the result), just never at one
 * caller's unilateral say.
 */
async function fetchCanonicalTarget(
  target: RelationTargetV1,
  seedTargetType: string,
  options: CanonicalResolutionOptions,
  signal: AbortSignal,
  context: string
): Promise<CanonicalOutcome> {
  const result = await resolveRelationTarget(target, seedTargetType, { ...options, signal }, options.budget, context);
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
  return { ok: false, status: statusFromIssue(result.issue), message: result.issue.message, issueCode: result.issue.code };
}

/** A canonical target's in-flight resolution — see `BudgetResolutionState.pending`. */
interface PendingFetch {
  promise: Promise<CanonicalOutcome>;
  /** Owns this fetch's cancellation. Aborted only once `waiters` hits `0` — never by any one caller's own `options.signal`. */
  controller: AbortController;
  /** Count of references currently awaiting `promise` (this call or a concurrent one sharing the budget). */
  waiters: number;
}

/**
 * Per-budget state shared across every resolver call over the same
 * caller-owned `budget` — both across sequential calls (a
 * `RelationsTraversalBudgetState` is explicitly caller-owned and can live
 * across many calls in the same parent traversal), across CONCURRENT calls
 * (nothing about a shared budget forbids `Promise.all`-ing several calls, and
 * the package's own scheduler layer supports concurrent in-flight requests),
 * and — since `1.4.0` — across DIFFERENT modules (Answer and Evidence) using
 * the same budget.
 *
 * - `outcomes`: every canonical target this layer has already settled an
 *   outcome for — replayed for any later reference naming the same canonical
 *   `{id, url}`, keeping `resolveRelationTarget`'s own `chargeNode` dedup
 *   honest (fetched/charged at most once per canonical target for the
 *   lifetime of the budget).
 * - `pending`: a canonical target's resolution while it is still in flight,
 *   as a `PendingFetch` — the shared promise, the `AbortController` that OWNS
 *   this fetch's cancellation (never any one caller's own `options.signal` —
 *   see `fetchCanonicalTarget`'s docstring), and a `waiters` count. This is
 *   what makes concurrent calls race-safe: a reference that finds neither
 *   `outcomes` nor `pending` populated for its canonical key creates the
 *   fetch and synchronously (before its first `await`) records it in
 *   `pending` — so any other reference for the same key, from this call OR a
 *   concurrently running call sharing the same budget, that runs before the
 *   fetch settles finds `pending` already populated and awaits the SAME
 *   promise instead of racing `resolveRelationTarget` a second time (which
 *   would just get Relations' bare `duplicate` with nothing to replay). Every
 *   reference that starts waiting increments `waiters`; when the LAST one
 *   stops waiting (settled, or bailed out early via its own `raceSignal`)
 *   with the fetch still in flight, `waiters` hits `0` and the entry's
 *   `AbortController` is aborted — real cancellation happens once truly
 *   nobody depends on the result anymore, without any single caller being
 *   able to force it unilaterally while others still wait.
 *   `pending`/`outcomes`/`globalStops` are mutated exactly once, by a
 *   `.then()` attached to the shared promise AT CREATION TIME — deliberately
 *   independent of how any individual reference later awaits it, and guarded
 *   to only delete the entry it itself created (never a NEWER entry a later
 *   reference may have since started for the same key after this one was
 *   evicted).
 * - `globalStops`: the canonical key that was in flight when a genuine
 *   shared-budget exhaustion (`AadpDiscoveryBudgetExceededError`) hit it.
 *   `chargeNode` marks a target visited BEFORE the budget/cycle check that
 *   can still throw for it, so that one key's dedup entry survives the throw
 *   — a later call for the very same key gets Relations' bare `duplicate`
 *   with no budget re-check (every OTHER, not-yet-visited key still
 *   re-triggers the same monotonic budget condition on its own, since none of
 *   `chargeNode`'s dimensions ever un-exceed once tripped). Without this,
 *   that one key alone would silently downgrade from the stop that produced
 *   it to a guessed `invalid` on any later replay. Deliberately NEVER records
 *   an `AbortedError`: cancellation via `options.signal` is scoped to the ONE
 *   caller that passed that signal — `fetchCanonicalTarget` doesn't even
 *   forward it to the shared fetch — so it must never poison a shared,
 *   budget-wide, cross-caller record the way a real budget exhaustion
 *   legitimately does.
 */
export interface BudgetResolutionState {
  outcomes: Map<string, CanonicalOutcome>;
  /**
   * Settled outcomes for URLs resolved without a declared id, keyed by
   * normalized URL. Only a traversal root arrives that way; see
   * `recordRootOutcome`. Kept beside `outcomes` rather than inside it because a
   * failed root has no id, so it has no canonical key to occupy.
   */
  rootOutcomes: Map<string, CanonicalOutcome>;
  pending: Map<string, PendingFetch>;
  globalStops: Map<string, Error>;
  /**
   * Digest of the request-affecting options this budget's state was FIRST
   * used with — see `./resolution-context.ts`. `outcomes`/`pending` are keyed
   * by canonical target alone, so without this a second call could replay
   * (or join) a request made under different credentials, URL policy or
   * response-size cap. Only the digest is kept; raw header values never are.
   */
  contextDigest: string;
}

const budgetState = new WeakMap<RelationsTraversalBudgetState, BudgetResolutionState>();

/**
 * One LOGICAL resolution of one canonical `{id, normalizedUrl}` target, as
 * decided at this layer's cache boundary — deliberately NOT an HTTP attempt.
 * One logical resolution covers the whole of a target's resolution including
 * every retry and redirect hop inside it (`client/http.ts` restarts an
 * attempt from the original URL, so a retried request records that URL twice
 * at `onBeforeAttempt`), which is exactly the distinction a fan-in dedup
 * assertion needs: "this target was resolved twice" is a defect, "this target
 * was resolved once, over two HTTP attempts" is ordinary transient behavior.
 *
 * `context` is the traversal decision point that asked for the target (e.g.
 * `evidence.evidence_refs[0]`) — request provenance recorded where the
 * decision is made, rather than inferred afterwards from a flat URL list.
 */
export interface CanonicalResolutionEvent {
  /** `canonicalTargetKey(id, url)` — the key this layer dedups on. */
  key: string;
  id: string;
  /** The reference's raw URL. Normalize with `normalizeTargetUrl` before comparing it to anything. */
  url: string;
  /**
   * - `fetch`: this resolution started the single real fetch for the key.
   * - `join`: joined a fetch already in flight for it.
   * - `cache`: replayed an already-settled outcome.
   * - `stopped`: ended in a global stop (budget exhaustion or this caller's own abort) instead of an outcome.
   */
  kind: "fetch" | "join" | "cache" | "stopped";
  context: string;
}

export type CanonicalResolutionObserver = (event: CanonicalResolutionEvent) => void;

/**
 * Observers keyed by the caller-owned budget — instrumentation, never
 * behavior. Kept here rather than as an option on
 * `CanonicalResolutionOptions` for two reasons: this layer is internal by
 * design (see the module docstring), so no module's PUBLIC resolve options
 * grow a hook; and an option would join the resolution-context digest, where
 * merely observing a walk would change which calls may share a budget.
 */
const observers = new WeakMap<RelationsTraversalBudgetState, CanonicalResolutionObserver>();

/**
 * Registers `observer` for every canonical resolution made on `budget`, and
 * returns a function that removes it again. One observer per budget — the
 * budget owner is the only party that can meaningfully instrument its own
 * walk. Used by the Evidence conformance runner, which must prove fan-in
 * dedup and metadata-traversal absence, neither of which is observable from
 * the outside at HTTP-attempt granularity.
 */
export function observeCanonicalResolutions(
  budget: RelationsTraversalBudgetState,
  observer: CanonicalResolutionObserver
): () => void {
  observers.set(budget, observer);
  return () => {
    if (observers.get(budget) === observer) observers.delete(budget);
  };
}

/** An observer that throws must never change a resolution's outcome — the same reasoning as the runner's `onCheck`. */
function emitResolution(budget: RelationsTraversalBudgetState, event: CanonicalResolutionEvent): void {
  const observer = observers.get(budget);
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // Instrumentation is never allowed to decide a verdict.
  }
}

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
 * Every entry point of every module client MUST route through this function
 * before touching the budget — that is the whole of the guarantee that no
 * resolver has a path around the check (ADR-0010 §11).
 *
 * The message deliberately names no option, header or digest — it must stay
 * safe to log wherever an `AadpClientError` already is.
 */
export function budgetResolutionStateFor(
  budget: RelationsTraversalBudgetState,
  options: ResolutionContextOptions
): BudgetResolutionState {
  const contextDigest = resolutionContextDigest(options);
  const state = budgetState.get(budget);
  if (!state) {
    const created: BudgetResolutionState = {
      outcomes: new Map(),
      rootOutcomes: new Map(),
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
 * Records the settled outcome of a URL resolved WITHOUT a declared id — the
 * traversal root, and only it. Every other caller has a referring occurrence
 * supplying `{id, url}` and goes through `resolveCanonicalTarget`.
 *
 * A root is fetched before its id is known, so it cannot be keyed canonically up
 * front. Both halves are recorded here:
 *
 * - **always** under the normalized URL, so a later walk on this budget replays
 *   it — including a stable `not-found`/`forbidden`/`invalid`, which must not be
 *   re-requested on every walk any more than a success is. Without this, a
 *   repeat walk could turn a settled `not-found` into `budget-exhausted` purely
 *   because of call history;
 * - **additionally** under the canonical `{id, url}` key on success, so an edge
 *   elsewhere in the graph pointing back at the root meets an already-settled
 *   target instead of paying for it again.
 *
 * Never overwrites: a key settles once per budget, and letting a later writer
 * replace it would reintroduce exactly the order-dependent result this shared
 * state exists to prevent.
 */
export function recordRootOutcome(state: BudgetResolutionState, url: string, outcome: CanonicalOutcome): void {
  const normalized = normalizeTargetUrl(url);
  if (!state.rootOutcomes.has(normalized)) state.rootOutcomes.set(normalized, outcome);
  if (outcome.ok) {
    const key = canonicalTargetKey(outcome.entity.id, url);
    if (!state.outcomes.has(key)) state.outcomes.set(key, outcome);
  }
}

/**
 * True when this budget has already settled `{id, url}`, or has a fetch for it
 * in flight — i.e. a caller resolving it now would replay or join rather than
 * start anything.
 *
 * Exists so a caller can report its own logical work honestly: a graph walk's
 * `requests` counter means "resolutions this walk started", and a replay or a
 * join costs it nothing. Physical HTTP attempts stay on `budget.requestsMade`.
 * Predicate only — it never registers interest, so asking cannot change what a
 * later resolve does.
 */
export function isCanonicalTargetKnown(state: BudgetResolutionState, id: string, url: string): boolean {
  const key = canonicalTargetKey(id, url);
  return state.outcomes.has(key) || state.pending.has(key);
}

/**
 * Replays a settled outcome for a bare URL, for that same root-shaped caller.
 *
 * Checks the root index first, then falls back to scanning settled canonical
 * outcomes — so a URL first met as an edge target (which did carry an id) is
 * replayed too, rather than being fetched again merely because this walk arrived
 * at it as a root.
 *
 * An in-flight fetch is deliberately never joined here: a URL alone cannot prove
 * it is the same canonical target the pending fetch will produce. A settled
 * normalized-URL match is unambiguous — one URL serves at most one entity, and
 * the id half of a canonical key came from the document that URL returned.
 */
export function replaySettledOutcomeForUrl(
  state: BudgetResolutionState,
  url: string
): CanonicalOutcome | undefined {
  const normalized = normalizeTargetUrl(url);
  const root = state.rootOutcomes.get(normalized);
  if (root) return root;
  for (const [key, outcome] of state.outcomes) {
    // Key layout is `${id}\0${normalizedUrl}` — compare the URL half only.
    const separator = key.indexOf("\0");
    if (separator !== -1 && key.slice(separator + 1) === normalized) return outcome;
  }
  return undefined;
}

/**
 * One canonical target's resolution as seen by a caller: either a settled
 * canonical outcome, or a global stop (budget exhaustion / this caller's own
 * abort) that ends the caller's whole remaining walk with a partial result.
 * A stop is returned rather than thrown so a caller can record the entry it
 * was working on and every entry after it, per the released partial-result
 * contract.
 */
export type CanonicalResolution =
  | { status: "outcome"; outcome: CanonicalOutcome }
  | { status: "stopped"; message: string };

/**
 * Resolves `target` through the budget's shared state: replays a settled
 * outcome, joins an in-flight fetch, or starts one — exactly once per
 * canonical key for the lifetime of the budget.
 *
 * `seedTargetType` is only the type whichever reference triggered the fetch
 * declared; it is NOT applied to the returned outcome. A caller MUST
 * recompute the `target_type` verdict per occurrence against
 * `outcome.entity.type`, because two references may legally declare
 * different types for one canonical target and neither may poison the other
 * (ADR-0010 §10).
 *
 * Rethrows anything that is not a global stop.
 */
export async function resolveCanonicalTarget(
  state: BudgetResolutionState,
  target: RelationTargetV1,
  seedTargetType: string,
  options: CanonicalResolutionOptions,
  context: string
): Promise<CanonicalResolution> {
  const { outcomes, pending, globalStops } = state;
  const key = canonicalTargetKey(target.id, target.url);
  const observe = (kind: CanonicalResolutionEvent["kind"]): void =>
    emitResolution(options.budget, { key, id: target.id, url: target.url, kind, context });

  const priorStop = globalStops.get(key);
  if (priorStop) {
    // This exact canonical key was mid-flight when a global stop hit it
    // earlier on this budget (this call or an earlier one) — replay that
    // stop rather than falling through to `fetchCanonicalTarget`, which
    // would only see Relations' bare `duplicate` (chargeNode already marked
    // the key visited before the throw) and misreport it `invalid`. See
    // `BudgetResolutionState.globalStops`.
    observe("stopped");
    return { status: "stopped", message: priorStop.message };
  }

  const settled = outcomes.get(key);
  if (settled) {
    observe("cache");
    return { status: "outcome", outcome: settled };
  }

  // No settled outcome yet. Join an in-flight fetch for this canonical key
  // if one is already running (this call or a concurrent one over the same
  // budget); otherwise start one — but never for a reference whose own
  // signal is ALREADY aborted: it must not charge/start real work
  // (`fetchCanonicalTarget` -> `resolveRelationTarget` -> `chargeNode` ->
  // HTTP) on behalf of a call that has already given up. Everything up to
  // and including `pending.set` below is synchronous — no `await` — so no
  // other reference can observe a state where the key is charged without
  // also being in `pending`.
  let entry = pending.get(key);
  if (!entry && options.signal?.aborted) {
    observe("stopped");
    return { status: "stopped", message: new AbortedError(target.url, options.signal.reason).message };
  }
  observe(entry ? "join" : "fetch");
  if (!entry) {
    const controller = new AbortController();
    const promise = fetchCanonicalTarget(target, seedTargetType, options, controller.signal, context);
    entry = { promise, controller, waiters: 0 };
    pending.set(key, entry);
    // Settle shared bookkeeping exactly once, driven by the fetch's OWN
    // outcome — not by whichever reference happens to be awaiting it below,
    // since `raceSignal` lets any individual reference bail out of its own
    // wait early without affecting this shared promise or its eventual
    // result. See `BudgetResolutionState`.
    //
    // `pending.get(key) === entry` gates the WHOLE settlement, not just the
    // eviction: once `waiters` hit `0` this attempt was abandoned and
    // synchronously evicted/released/aborted (see the `finally` below), so
    // it is no longer this key's current attempt and MUST NOT commit
    // anything. It can still settle afterwards — an abort landing after the
    // transport's own last cancellation check leaves a purely synchronous
    // tail, so the promise resolves successfully even though nobody is
    // waiting — and committing that would cache a response for a request
    // its caller already abandoned, quite possibly over a NEWER attempt
    // already in flight for the same key under different options. Same for
    // `globalStops`: skipping a budget error here loses nothing, since every
    // budget dimension is monotonic and the replacement attempt re-trips it
    // on its own. Releasing the node charge is likewise never done here —
    // that also happens synchronously at abandonment, because by now a new
    // attempt may already hold the charge and releasing THAT would be a
    // stale-promise ABA bug.
    const created = entry;
    promise.then(
      (outcome) => {
        if (pending.get(key) !== created) return;
        pending.delete(key);
        outcomes.set(key, outcome);
      },
      (err) => {
        if (pending.get(key) !== created) return;
        pending.delete(key);
        if (err instanceof AadpDiscoveryBudgetExceededError) globalStops.set(key, err);
      }
    );
  }

  entry.waiters++;
  try {
    return { status: "outcome", outcome: await raceSignal(entry.promise, options.signal, target.url) };
  } catch (err) {
    if (isGlobalStop(err)) return { status: "stopped", message: (err as Error).message };
    throw err;
  } finally {
    entry.waiters--;
    // `pending.get(key) === entry` is true here iff this fetch has NOT
    // already settled through its normal completion path — the
    // creation-time `.then()` above (registered before any waiter's own
    // await) always runs, and evicts this exact `entry`, before a waiter's
    // own `raceSignal`-wrapped await can resume from a NORMAL settle. It
    // reads false only once that has already happened (nothing left to
    // abandon — `outcomes`/`globalStops` already has the real, permanent
    // result) — or once some other waiter already abandoned this very entry
    // (only possible after eviction, so no waiter still holding this `entry`
    // can observe `waiters` fall to `0` a second time for it).
    if (entry.waiters === 0 && pending.get(key) === entry) {
      // Still genuinely in flight, and now has zero dependents: abandon it.
      // Evicted synchronously, right now — NOT left for the (async)
      // rejection this abort is about to cause to clean up later — so a
      // reference arriving even immediately after this point can never join
      // a fetch that's already been abandoned; it starts a fresh attempt
      // instead. `chargeNode` already marked this canonical key visited
      // before the fetch started, so that fresh attempt also needs the
      // charge released right now — not deferred to the fetch's own eventual
      // rejection, which could settle after an arbitrary number of later
      // callers have already run — otherwise every later, unrelated attempt
      // at this exact target would see Relations' bare `duplicate` and be
      // stuck reporting `invalid` forever. Finally, actually cancel the real
      // underlying HTTP work rather than leaving it to complete in the
      // background against nobody, still consuming shared
      // `maxRequests`/`maxTotalBytes` budget for a result no caller remains
      // to receive.
      pending.delete(key);
      releaseNode(options.budget, target.id, target.url);
      entry.controller.abort(new AbortedError(target.url, "no caller is waiting on this canonical target's resolution anymore"));
    }
  }
}

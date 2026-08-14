/**
 * `traverseGraphV1` — the streaming entry point of `ail-aadp/traversal/v1.0`.
 *
 * Wires the three layers that already exist: options/root identity
 * (`./options.ts`), the ordered walk (`./state-machine.ts`) and the streaming
 * contract (`./scheduler.ts`). Resolution goes through the SHARED canonical
 * resolution layer keyed by the caller's budget — traversal keeps no second
 * cache of its own, and never exports that layer.
 */
import {
  fetchEntity,
  AadpRequestError,
  AadpSchemaValidationError,
  AbortedError,
  type EntityV1,
} from "../../client/v1.0/index.js";
import { AadpDiscoveryBudgetExceededError } from "../../client/discovery-budget.js";
import { BlockedUrlError } from "../../client/url-policy.js";
import { chargeNode, crossOriginAttemptHook } from "../../modules/relations/v1.0/client/budget.js";
import { iterateRelationCollection } from "../../modules/relations/v1.0/index.js";
import {
  budgetResolutionStateFor,
  recordRootOutcome,
  replaySettledOutcomeForUrl,
  resolveCanonicalTarget,
  type CanonicalResolutionOptions,
} from "../../modules/shared/canonical-resolution.js";
import { resolveTraversalOptions } from "./options.js";
import { streamTraversal } from "./scheduler.js";
import {
  createTraversalProgress,
  walkTraversal,
  type TraversalCollectionPager,
  type TraversalNodeResolution,
  type TraversalNodeResolver,
} from "./state-machine.js";
import type { GraphTraversalEventV1, GraphTraversalOptions } from "./types.js";

const CONTEXT = "traverseGraphV1";

/** A cancellation raised by the caller's own signal, not a failure of the walk. */
function isAbort(err: unknown): boolean {
  return err instanceof AbortedError || (err instanceof Error && err.name === "AbortError");
}

/**
 * Maps a failed ROOT fetch onto the released status vocabulary. Target
 * resolution has this mapping already, inside the shared layer; the root is the
 * one fetch that has no referring occurrence to resolve through, so it is
 * classified here on the same rules: an explicit 404 is `not-found`, 401/403 is
 * `forbidden`, and anything that produced no usable entity — including a
 * transport failure — is `invalid` rather than being misreported as a confirmed
 * absence.
 */
function rootStatusFor(err: unknown): TraversalNodeResolution {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AadpRequestError) {
    if (err.status === 404) return { status: "not-found", message };
    if (err.status === 401 || err.status === 403) return { status: "forbidden", message };
  }
  if (err instanceof BlockedUrlError || err instanceof AadpSchemaValidationError) {
    return { status: "invalid", message };
  }
  return { status: "invalid", message };
}

/**
 * Streams the cross-module graph reachable from `root`.
 *
 * Invalid options throw synchronously — before the first request — so a caller
 * never pays for a fetch made under options that could not have produced a
 * usable graph. Everything after that is a result, not an exception: a 404, a
 * blocked URL, an unsupported module or a malformed extension all arrive as a
 * status or an outcome on some node, edge or expansion record.
 *
 * The iterator always ends with exactly one `complete` event, EXCEPT when the
 * consumer breaks out early — then there is no outcome to declare.
 */
export function traverseGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions
): AsyncIterableIterator<GraphTraversalEventV1> {
  const effective = resolveTraversalOptions(root, options);
  const budget = options.budget;

  // A walk-local cancellation, combined with (never replacing) the caller's own
  // signal. The shared resolution layer races a waiter's signal against the
  // fetch WITHOUT cancelling the fetch, so aborting this one only ends this
  // walk's waiting — a request another walk on the same budget is still
  // waiting on survives.
  const walkCancel = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, walkCancel.signal])
    : walkCancel.signal;

  // Every fetch in this walk is made with the SAME request-affecting options,
  // which is what the shared layer's resolution-context digest pins: a budget
  // may not be reused across calls whose credentials, URL policy or size caps
  // differ.
  const requestOptions: CanonicalResolutionOptions = {
    ...options,
    rootOrigin: effective.rootOrigin,
    budget,
    signal,
  };
  const resolutionState = budgetResolutionStateFor(budget, requestOptions);

  const resolve: TraversalNodeResolver = async (request) => {
    // A URL root has no declared id, so it cannot be looked up by canonical key
    // the way a referenced target is. It is still a node of this budget: once
    // some walk has settled it, a later walk replays that outcome instead of
    // paying for the request again (the accounting table's "second walk meets an
    // old node" row). The replay lives in the shared layer, so no second cache
    // appears on one budget.
    if (request.declaredId === undefined) {
      const replayed = replaySettledOutcomeForUrl(resolutionState, request.url);
      if (replayed) {
        return replayed.ok
          ? { status: "resolved", entity: replayed.entity, replayed: true }
          : {
              status: replayed.status,
              ...(replayed.message ? { message: replayed.message } : {}),
              replayed: true,
            };
      }
      try {
        const entity = await fetchEntity(
          request.url,
          {
            ...requestOptions,
            // The root's own origin defines `rootOrigin`, so only a mid-request
            // redirect can make this fire — but ADR-0008's per-hop guarantee
            // applies to the root fetch too, not just to resolved targets.
            onBeforeAttempt: crossOriginAttemptHook(
              budget,
              effective.rootOrigin,
              `${CONTEXT} root`,
              options.onBeforeAttempt
            ),
          },
          budget
        );
        // The root is a node like any other, charged under its real id/url now
        // that both are known — no occurrence pointed at it to charge it. A
        // later edge back to the same {id, url} then sees an already-visited
        // target instead of paying for it twice.
        chargeNode(budget, entity.id, request.url, `${CONTEXT} root`);
        // Now that the id is known, the root becomes an ordinary canonical
        // target of this budget, so a later walk replays it rather than
        // re-requesting it.
        recordRootOutcome(resolutionState, request.url, { ok: true, entity });
        return { status: "resolved", entity };
      } catch (err) {
        if (isAbort(err)) throw err;
        // A budget stop is not an outcome of the root — it is a condition of
        // this walk — so it is never recorded: the next walk, with headroom,
        // must be free to actually try.
        if (err instanceof AadpDiscoveryBudgetExceededError) {
          return { status: "budget-exhausted", message: err.message };
        }
        const failure = rootStatusFor(err);
        // A settled failure IS an outcome of that URL. Recording it means a
        // stable 404/403/invalid root costs one request per budget, not one per
        // walk — the same rule every other node of the graph already follows.
        recordRootOutcome(resolutionState, request.url, {
          ok: false,
          status: failure.status as Exclude<typeof failure.status, "resolved">,
          ...(failure.message ? { message: failure.message } : {}),
        });
        return failure;
      }
    }
    const resolution = await resolveCanonicalTarget(
      resolutionState,
      { id: request.declaredId, url: request.url },
      request.declaredTargetType ?? "",
      requestOptions,
      CONTEXT
    );
    // `started` is the decision the shared layer took atomically for THIS call:
    // only the caller that actually created the fetch counts it as a logical
    // resolution of its own. Two concurrent walks meeting the same target
    // therefore split into one starter and one joiner, never two starters.
    const replayed = !resolution.started;

    if (resolution.status === "stopped") {
      // The shared layer reports budget exhaustion and this caller's own abort
      // through one `stopped` channel. They are different terminal states —
      // `budget` is a result, an abort is the caller's own decision — so they
      // are told apart here rather than collapsed into one stop reason.
      if (signal.aborted) throw new AbortedError(resolution.message);
      return { status: "budget-exhausted", message: resolution.message, replayed };
    }
    const { outcome } = resolution;
    return outcome.ok
      ? { status: "resolved", entity: outcome.entity, replayed }
      : { status: outcome.status, ...(outcome.message ? { message: outcome.message } : {}), replayed };
  };

  // Row 2 paging is the released Relations client's own: cursor-cycle
  // detection, per-page validation against the expectation, and per-hop
  // request/byte/cross-origin accounting all stay where they were shipped.
  const pageCollection: TraversalCollectionPager = (request) =>
    iterateRelationCollection(request.url, request.expectation, requestOptions, budget);

  const progress = createTraversalProgress();
  const walk = walkTraversal(root, {
    rootUrl: effective.rootUrl,
    lookup: effective.lookup,
    resolve,
    pageCollection,
    maxDepth: budget.maxDepth,
    followCollections: effective.followCollections,
    includeGeneratedSummarySources: effective.includeGeneratedSummarySources,
    progress,
  });

  return streamTraversal(walk, {
    maxBufferedEvents: effective.maxBufferedEvents,
    progress,
    signal: options.signal,
    onCancel: () => walkCancel.abort(),
  });
}

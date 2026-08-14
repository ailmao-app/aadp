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

  // Every fetch in this walk is made with the SAME request-affecting options,
  // which is what the shared layer's resolution-context digest pins: a budget
  // may not be reused across calls whose credentials, URL policy or size caps
  // differ.
  const requestOptions: CanonicalResolutionOptions = { ...options, rootOrigin: effective.rootOrigin, budget };
  const resolutionState = budgetResolutionStateFor(budget, requestOptions);

  const resolve: TraversalNodeResolver = async (request) => {
    // A URL root has no declared id, so it cannot go through the shared layer,
    // which is keyed by canonical `{id, normalizedUrl}`: there is nothing to
    // look it up by until it has been fetched once. A second walk on the same
    // budget therefore re-fetches the ROOT (every referenced target is still a
    // cache hit), and `chargeNode` still dedupes its node charge. Caching it by
    // URL here would mean a second canonical cache on one budget — precisely
    // what the shared layer exists to prevent.
    if (request.declaredId === undefined) {
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
        return { status: "resolved", entity };
      } catch (err) {
        if (isAbort(err)) throw err;
        if (err instanceof AadpDiscoveryBudgetExceededError) {
          return { status: "budget-exhausted", message: err.message };
        }
        return rootStatusFor(err);
      }
    }
    const resolution = await resolveCanonicalTarget(
      resolutionState,
      { id: request.declaredId, url: request.url },
      request.declaredTargetType ?? "",
      requestOptions,
      CONTEXT
    );
    if (resolution.status === "stopped") {
      // The shared layer reports budget exhaustion and this caller's own abort
      // through one `stopped` channel. They are different terminal states —
      // `budget` is a result, an abort is the caller's own decision — so they
      // are told apart here rather than collapsed into one stop reason.
      if (options.signal?.aborted) throw new AbortedError(resolution.message);
      return { status: "budget-exhausted", message: resolution.message };
    }
    const { outcome } = resolution;
    return outcome.ok
      ? { status: "resolved", entity: outcome.entity }
      : { status: outcome.status, ...(outcome.message ? { message: outcome.message } : {}) };
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
  });
}

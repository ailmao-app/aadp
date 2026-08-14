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
  type EntityV1,
} from "../../client/v1.0/index.js";
import { BlockedUrlError } from "../../client/url-policy.js";
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
  type TraversalNodeResolution,
  type TraversalNodeResolver,
} from "./state-machine.js";
import type { GraphTraversalEventV1, GraphTraversalOptions } from "./types.js";

const CONTEXT = "traverseGraphV1";

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
    if (request.declaredId === undefined) {
      try {
        const entity = await fetchEntity(request.url, requestOptions, budget);
        return { status: "resolved", entity };
      } catch (err) {
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
      return { status: "budget-exhausted", message: resolution.message };
    }
    const { outcome } = resolution;
    return outcome.ok
      ? { status: "resolved", entity: outcome.entity }
      : { status: outcome.status, ...(outcome.message ? { message: outcome.message } : {}) };
  };

  const progress = createTraversalProgress();
  const walk = walkTraversal(root, {
    rootUrl: effective.rootUrl,
    lookup: effective.lookup,
    resolve,
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

/**
 * Option validation and root identity for one walk (ADR-0011 §6, plan 1.5.0
 * §"Root identity").
 *
 * Everything here runs BEFORE the first request: an invalid-options walk must
 * fail without having touched the network, so a caller never pays for a request
 * made under options that were never going to produce a usable graph.
 */
import type { EntityV1 } from "../../client/v1.0/index.js";
import { assertAllowed, createStrictUrlPolicy, type UrlPolicy } from "../../client/url-policy.js";
import { createAdapterLookup, type TraversalAdapterLookup } from "./registry.js";
import type { GraphTraversalOptions } from "./types.js";

/**
 * Thrown before the first request when a walk's options cannot describe a
 * traversal at all. Distinct from a traversal RESULT: a blocked URL, a 404 or a
 * malformed extension are outcomes on a node/edge, while these are programming
 * errors in the call itself.
 */
export class InvalidGraphTraversalOptionsError extends Error {
  readonly code = "invalid_options";
  constructor(message: string) {
    super(message);
    this.name = "InvalidGraphTraversalOptionsError";
  }
}

export const DEFAULT_MAX_BUFFERED_EVENTS = 256;

export interface EffectiveGraphTraversalOptions {
  /** Canonical identity of the root node AND the source of `rootOrigin`. Never fetched as an option. */
  rootUrl: string;
  /** Always `new URL(rootUrl).origin` — the value every fetch in the walk is accounted against. */
  rootOrigin: string;
  followCollections: boolean;
  includeGeneratedSummarySources: boolean;
  maxBufferedEvents: number;
  /** The adapter set this call resolves against: `options.adapters` if given, otherwise the global registry. */
  lookup: TraversalAdapterLookup;
}

/**
 * Resolves the root URL by the precedence in plan §"Root identity":
 *
 * 1. the root's own URL, when the root was passed as a URL;
 * 2. otherwise `entity.canonical_url` of the root entity;
 * 3. otherwise `options.rootUrl`.
 *
 * A URL is required rather than an origin because the graph is keyed by
 * canonical `{id, normalizedUrl}` throughout — the root's node key, the `from`
 * of its edges and its expansion records all need it. Pairing an origin with
 * `entity.id` would invent a URL that is not on the wire, and an edge pointing
 * back at the root would then fail to match its own canonical key, so a cycle
 * through the root would go unrecognised.
 */
function resolveRootUrl(root: string | EntityV1, options: GraphTraversalOptions): string {
  if (typeof root === "string") return root;
  if (typeof root.canonical_url === "string" && root.canonical_url.length > 0) return root.canonical_url;
  if (typeof options.rootUrl === "string" && options.rootUrl.length > 0) return options.rootUrl;
  throw new InvalidGraphTraversalOptionsError(
    "A traversal root needs a URL: pass the root as a URL, give the root entity a canonical_url, or set options.rootUrl. " +
      "An origin alone cannot produce the canonical {id, normalizedUrl} key the graph is built on."
  );
}

/**
 * Validates options and derives every effective value the walk needs.
 *
 * `rootOrigin` is always derived from the root URL. `RelationsClientOptions`
 * already carries a `rootOrigin` of its own, so a caller can supply one that
 * disagrees; that is rejected rather than silently resolved in either
 * direction, because the losing value would still be the one some accounting
 * path used, quietly disabling `maxCrossOriginRequests`.
 */
export function resolveTraversalOptions(
  root: string | EntityV1,
  options: GraphTraversalOptions
): EffectiveGraphTraversalOptions {
  if (!options || typeof options !== "object") {
    throw new InvalidGraphTraversalOptionsError("options is required: a walk borrows the caller's budget.");
  }
  if (!options.budget) {
    throw new InvalidGraphTraversalOptionsError(
      "options.budget is required: traversal borrows a caller-owned budget and never creates one of its own (ADR-0011 §10)."
    );
  }

  const rootUrl = resolveRootUrl(root, options);
  let parsed: URL;
  try {
    parsed = new URL(rootUrl);
  } catch {
    throw new InvalidGraphTraversalOptionsError(`The traversal root URL is not a valid absolute URL: ${rootUrl}`);
  }

  // The root URL goes through the same URL policy as every other URL in the
  // walk even though it is never fetched as an option — it still names the
  // origin the walk accounts against, and a caller must not be able to smuggle
  // a policy-blocked origin in through identity instead of through a request.
  const policy: UrlPolicy = options.urlPolicy ?? createStrictUrlPolicy();
  assertAllowed(parsed, policy);

  const rootOrigin = parsed.origin;
  if (options.rootOrigin !== undefined && options.rootOrigin !== rootOrigin) {
    throw new InvalidGraphTraversalOptionsError(
      `options.rootOrigin (${options.rootOrigin}) disagrees with the origin of the traversal root URL (${rootOrigin}). ` +
        "Pass the matching origin or omit it — traversal will not pick one for you."
    );
  }

  return {
    rootUrl,
    rootOrigin,
    followCollections: options.followCollections ?? false,
    includeGeneratedSummarySources: options.includeGeneratedSummarySources ?? false,
    maxBufferedEvents: options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS,
    lookup: createAdapterLookup({ adapters: options.adapters, capabilities: options.capabilities }),
  };
}

/**
 * Relations traversal budget (`AADP-REL-005`, ADR-0008 "shared traversal
 * budget"). Wraps the core `DiscoveryBudgetState` (`../../../../client/discovery-budget.js`)
 * — page/byte/deadline/request accounting is entirely inherited, not
 * reimplemented — and adds the three dimensions unique to walking a
 * *graph* of relations rather than a paginated list: depth, distinct
 * nodes, and cross-origin request count. Every HTTP call this module
 * makes is still charged in `http.ts`'s own per-hop `maxRequests`
 * accounting; this module only adds what that shared layer cannot know
 * about (it has no concept of "origin relative to the walk's root", "graph
 * depth", or "a target already visited under a different relation").
 */
import {
  createDiscoveryBudget,
  AadpDiscoveryBudgetExceededError,
  type DiscoveryBudget,
  type DiscoveryBudgetState,
} from "../../../../client/discovery-budget.js";

// ADR-0008 "Reference defaults" — these apply only to the Relations
// traversal opt-in (this factory), never to the core-only client: core
// `createDiscoveryBudget()` keeps its own pre-1.2.0 unbounded defaults for
// `maxRequests`/`maxTotalBytes` so omitting Relations options never
// changes core-only client behavior (ADR-0008 "Compatibility với 1.1.0").
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_NODES = 1_000;
const DEFAULT_MAX_REQUESTS = 2_000;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MiB
const DEFAULT_MAX_CROSS_ORIGIN_REQUESTS = 100;

export interface RelationsTraversalLimits extends DiscoveryBudget {
  /** Maximum graph depth from the root (root = 0, each resolved edge = +1). Default 3 (ADR-0008). */
  maxDepth?: number;
  /** Maximum distinct targets (by canonical `{id, normalizedUrl}` key) resolved across the whole walk. Default 1000 (ADR-0008). */
  maxNodes?: number;
  /** Maximum requests whose target origin differs from the walk's root origin. Default 100 (ADR-0008). */
  maxCrossOriginRequests?: number;
}

export interface RelationsTraversalBudgetState extends DiscoveryBudgetState {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCrossOriginRequests: number;
  nodesVisited: number;
  crossOriginRequestsMade: number;
  /** Canonical `{id, normalizedUrl}` keys already resolved as a target — see `canonicalTargetKey`/`chargeNode`. */
  readonly visitedTargets: Set<string>;
  /**
   * Canonical keys whose OWN outgoing relations have already been
   * expanded during a `traverseRelations` walk — distinct from
   * `visitedTargets` (which tracks "resolved as a leaf") so that
   * resolving a node as a target and then expanding its relations count
   * as two different, both-legitimate steps, while expanding the *same*
   * node's relations twice (a graph cycle re-entering it) does not. See
   * `markExpanded`.
   */
  readonly expandedTargets: Set<string>;
}

/**
 * Builds the full six-dimension traversal budget (ADR-0008), applying the
 * Relations reference defaults to every dimension the caller didn't set —
 * including `maxRequests`/`maxTotalBytes`, which `createDiscoveryBudget`
 * alone would otherwise default to unbounded (its own core-only-client
 * default). `deadlineMs`'s reference default (5 minutes) already equals
 * core's own default, so it needs no override here.
 */
export function createRelationsTraversalBudget(limits: RelationsTraversalLimits = {}): RelationsTraversalBudgetState {
  const base = createDiscoveryBudget({
    ...limits,
    maxRequests: limits.maxRequests ?? DEFAULT_MAX_REQUESTS,
    maxTotalBytes: limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  });
  return {
    ...base,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: limits.maxNodes ?? DEFAULT_MAX_NODES,
    maxCrossOriginRequests: limits.maxCrossOriginRequests ?? DEFAULT_MAX_CROSS_ORIGIN_REQUESTS,
    nodesVisited: 0,
    crossOriginRequestsMade: 0,
    visitedTargets: new Set(),
    expandedTargets: new Set(),
  };
}

/**
 * Canonical dedup key per specification.md's traversal invariants: two
 * relation items pointing at the same entity `id` via differently-cased
 * hosts or different-but-equivalent URL forms are still "the same node" —
 * `new URL(url).href` normalizes scheme/host casing and default ports the
 * same way the rest of this package's URL handling does (`client/http.ts`,
 * `client/url-policy.ts`), so this reuses that normalization rather than
 * inventing a second one.
 *
 * Separator is the `\0` escape sequence (two source characters, backslash
 * then zero) — not a literal control byte in this file, which would make
 * `rg`/git tooling treat the file as binary. An entity id can never
 * legally contain it (id pattern is `[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*`),
 * so it's a safe, unambiguous separator against a URL.
 */
export function canonicalTargetKey(id: string, url: string): string {
  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(url).href;
  } catch {
    normalizedUrl = url;
  }
  return `${id}\0${normalizedUrl}`;
}

/**
 * Throws `AadpDiscoveryBudgetExceededError` once `depth` exceeds
 * `maxDepth`. Root is depth 0; called with the depth a *new* edge would
 * land on, i.e. before descending into it.
 */
export function chargeDepth(budget: RelationsTraversalBudgetState, depth: number, context: string): void {
  if (depth > budget.maxDepth) {
    throw new AadpDiscoveryBudgetExceededError(
      `${context} would reach depth ${depth}, exceeding the maxDepth limit of ${budget.maxDepth}`
    );
  }
}

/**
 * Records a target as visited and charges the node budget, UNLESS its
 * canonical key was already visited — per specification.md, a duplicate
 * target (inline list, or re-encountered via a different relation/branch)
 * is not charged a second time and is reported to the caller as already
 * visited rather than re-resolved, which is also how a graph cycle is
 * contained to just the branch that would have re-entered it.
 */
export function chargeNode(
  budget: RelationsTraversalBudgetState,
  id: string,
  url: string,
  context: string
): { alreadyVisited: boolean } {
  const key = canonicalTargetKey(id, url);
  if (budget.visitedTargets.has(key)) {
    return { alreadyVisited: true };
  }
  budget.visitedTargets.add(key);
  budget.nodesVisited++;
  if (budget.nodesVisited > budget.maxNodes) {
    throw new AadpDiscoveryBudgetExceededError(
      `${context} visited more than the maxNodes limit of ${budget.maxNodes} distinct targets`
    );
  }
  return { alreadyVisited: false };
}

/**
 * Undoes exactly what `chargeNode` did for `id`/`url` — removes it from
 * `visitedTargets` and decrements `nodesVisited` — for a resolution that
 * was ABANDONED (e.g. cancelled) before producing any outcome a caller
 * could observe, so a later, unrelated attempt at the same canonical
 * target is not stuck permanently treating it as an already-resolved
 * duplicate with nothing to replay.
 *
 * Callers MUST only invoke this for a canonical target they THEMSELVES
 * charged and that never produced a `resolved`/`issue` outcome ANY caller
 * observed (e.g. Answer's `resolveAnswerTargets`, when a canonical
 * target's own internally-owned in-flight fetch is cancelled because no
 * caller remains to receive its result) — never for a target that DID
 * resolve, even if that particular caller is discarding the result for
 * unrelated reasons, since that would let the same canonical target be
 * charged (and potentially fetched) more than once, which `chargeNode`'s
 * per-walk dedup guarantee forbids. No-op if `id`/`url`'s canonical key
 * was never charged (e.g. already released, or charged by an unrelated
 * caller this one has no business releasing).
 *
 * Deliberately NOT re-exported from `./index.ts` (the `ail-aadp/modules/
 * relations/v1.0` public subpath): those preconditions are not checkable
 * here, and an external caller releasing a charge for a target that did
 * resolve would silently break `chargeNode`'s "fetched/charged at most
 * once per walk" guarantee. Keep it module-internal.
 */
export function releaseNode(budget: RelationsTraversalBudgetState, id: string, url: string): void {
  const key = canonicalTargetKey(id, url);
  if (budget.visitedTargets.delete(key)) {
    budget.nodesVisited--;
  }
}

/**
 * Marks `{id, url}`'s outgoing relations as expanded. Returns `false`
 * (already expanded — the caller MUST NOT re-expand it) if this exact
 * canonical key was marked before, `true` otherwise. This is how a graph
 * cycle is contained to just the branch that would have re-entered an
 * already-expanded node — no error, no budget charge, just "stop this
 * branch here."
 */
export function markExpanded(budget: RelationsTraversalBudgetState, id: string, url: string): boolean {
  const key = canonicalTargetKey(id, url);
  if (budget.expandedTargets.has(key)) return false;
  budget.expandedTargets.add(key);
  return true;
}

/** Charges the cross-origin request dimension. Callers decide "cross-origin" relative to their own walk's root. */
export function chargeCrossOrigin(budget: RelationsTraversalBudgetState, context: string): void {
  budget.crossOriginRequestsMade++;
  if (budget.crossOriginRequestsMade > budget.maxCrossOriginRequests) {
    throw new AadpDiscoveryBudgetExceededError(
      `${context} made more than the maxCrossOriginRequests limit of ${budget.maxCrossOriginRequests} cross-origin requests`
    );
  }
}

/** True if `url`'s origin differs from `rootOrigin`. Returns `true` (treats as cross-origin) if `url` fails to parse. */
export function isCrossOrigin(url: string, rootOrigin: string): boolean {
  try {
    return new URL(url).origin !== rootOrigin;
  } catch {
    return true;
  }
}

/**
 * Builds a `FetchJsonOptions.onBeforeAttempt` hook (`../../../../client/http.js`)
 * that charges `chargeCrossOrigin` for every hop whose URL is cross-origin
 * relative to `rootOrigin` — the original request, every retry, and every
 * redirect hop, since `http.ts`'s per-hop loop calls this at the same
 * point it charges `maxRequests`. This is what makes
 * `maxCrossOriginRequests` bound the whole per-attempt cost of resolving
 * one target/collection page, not just its first logical request — a
 * same-origin request that retries into a cross-origin redirect target
 * still gets charged on that hop, and a request that starts cross-origin
 * is charged on attempt 1 even before any retry/redirect.
 *
 * `existing`, when given, is a caller-supplied `onBeforeAttempt` (e.g. for
 * the caller's own auditing/metrics/policy) that every Relations client
 * entry point (`resolveRelationTarget`, `iterateRelationCollection`,
 * `traverseRelations`) MUST preserve rather than silently replace — every
 * one of those call sites passes its incoming `options.onBeforeAttempt`
 * here as `existing` for exactly that reason. `existing` runs first, on
 * every hop, before this function's own cross-origin charge; if it
 * throws, this function's charge never runs and the hop's network
 * attempt never happens either (same short-circuit `http.ts` already
 * gives any `onBeforeAttempt` that throws).
 */
export function crossOriginAttemptHook(
  budget: RelationsTraversalBudgetState,
  rootOrigin: string,
  context: string,
  existing?: (url: URL) => void
): (url: URL) => void {
  return (url: URL) => {
    existing?.(url);
    if (isCrossOrigin(url.toString(), rootOrigin)) {
      chargeCrossOrigin(budget, context);
    }
  };
}

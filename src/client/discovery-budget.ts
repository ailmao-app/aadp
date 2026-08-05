/**
 * Traversal budgets shared by every pagination entry point (`iterateSitemap`
 * and `discoverAllEntities` in both `./v0.1/index.ts` and
 * `./v1.0/index.ts`). A schema-valid, honest-looking server can still hand
 * out an unbounded number of pages via an ever-fresh `cursor.next` — cycle
 * detection alone only catches a *repeated* cursor, not an endless stream
 * of novel ones — so every public pagination helper must charge against a
 * budget, not just top-level orchestration like `discoverAllEntities`.
 *
 * A `DiscoveryBudgetState` can be created once and threaded through
 * multiple `iterateSitemap` calls (one per sitemap in a walk) via its
 * `budget` option so the limits apply to the whole walk in aggregate,
 * rather than resetting per sitemap.
 */

const DEFAULT_MAX_PAGES = 10_000;
const DEFAULT_MAX_ENTITIES = 100_000;
const DEFAULT_DEADLINE_MS = 5 * 60_000;
// Unbounded by default (ADR-0006): omitting `maxTotalBytes` means every
// release before 1.1.0's behavior — only the existing per-request
// `maxResponseBytes` cap applies, no whole-run total.
const DEFAULT_MAX_TOTAL_BYTES = Number.POSITIVE_INFINITY;

export interface DiscoveryBudget {
  /** Maximum sitemap pages fetched. Default 10000. */
  maxPages?: number;
  /** Maximum entities yielded. Default 100000. */
  maxEntities?: number;
  /** Wall-clock deadline, in ms. Default 5 minutes. */
  deadlineMs?: number;
  /**
   * Maximum total response bytes across every request the whole walk
   * makes (ADR-0006) — distinct from `FetchJsonOptions.maxResponseBytes`,
   * which caps a single response. Default unbounded.
   */
  maxTotalBytes?: number;
}

export interface DiscoveryBudgetState {
  readonly maxPages: number;
  readonly maxEntities: number;
  readonly deadlineMs: number;
  readonly maxTotalBytes: number;
  readonly startedAt: number;
  pagesFetched: number;
  entitiesYielded: number;
  bytesFetched: number;
}

/** A traversal exceeded one of its `DiscoveryBudget` limits. */
export class AadpDiscoveryBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AadpDiscoveryBudgetExceededError";
  }
}

export function createDiscoveryBudget(budget: DiscoveryBudget = {}): DiscoveryBudgetState {
  return {
    maxPages: budget.maxPages ?? DEFAULT_MAX_PAGES,
    maxEntities: budget.maxEntities ?? DEFAULT_MAX_ENTITIES,
    deadlineMs: budget.deadlineMs ?? DEFAULT_DEADLINE_MS,
    maxTotalBytes: budget.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    startedAt: Date.now(),
    pagesFetched: 0,
    entitiesYielded: 0,
    bytesFetched: 0,
  };
}

/** Increments the counter for `kind` and throws if it (or the deadline) is now exceeded. */
export function chargeDiscoveryBudget(
  state: DiscoveryBudgetState,
  kind: "page" | "entity",
  context: string
): void {
  if (Date.now() - state.startedAt > state.deadlineMs) {
    throw new AadpDiscoveryBudgetExceededError(`${context} exceeded its deadline of ${state.deadlineMs}ms`);
  }
  if (kind === "page") {
    state.pagesFetched++;
    if (state.pagesFetched > state.maxPages) {
      throw new AadpDiscoveryBudgetExceededError(
        `${context} fetched more than the maxPages limit of ${state.maxPages} sitemap pages`
      );
    }
  } else {
    state.entitiesYielded++;
    if (state.entitiesYielded > state.maxEntities) {
      throw new AadpDiscoveryBudgetExceededError(
        `${context} yielded more than the maxEntities limit of ${state.maxEntities} entities`
      );
    }
  }
}

/**
 * Adds `bytes` (a response body actually read, e.g. `FetchJsonResult.bodyBytes`)
 * to the whole-run total and throws if `maxTotalBytes` is now exceeded.
 * Distinct budget dimension from `chargeDiscoveryBudget`'s page/entity
 * counts, charged at every request that reads a body — per the precedent
 * in `ERROR_LOG.md` 2026-07-27, a request charged for page/entity count but
 * not for bytes would let this dimension be bypassed the same way.
 */
export function chargeDiscoveryBudgetBytes(state: DiscoveryBudgetState, bytes: number, context: string): void {
  state.bytesFetched += bytes;
  if (state.bytesFetched > state.maxTotalBytes) {
    throw new AadpDiscoveryBudgetExceededError(
      `${context} fetched more than the maxTotalBytes limit of ${state.maxTotalBytes} bytes in total across the run`
    );
  }
}

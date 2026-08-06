/**
 * Relations v1.0 resolution/traversal (`AADP-REL-005`). Every entry point
 * here reuses the core client's HTTP/URL-policy/scheduler/cancellation
 * layer (`fetchEntity`, `fetchJson` via `./fetch.ts`) rather than
 * duplicating it — this module adds only what's Relations-specific:
 * cardinality dispatch, cursor-bounded collection pagination, and the
 * node/depth/cross-origin budget dimensions in `./budget.ts`.
 *
 * Partial-result contract (specification.md §12): a budget/cancellation
 * condition (`AadpDiscoveryBudgetExceededError`, `AbortedError`) always
 * propagates and stops the *whole* remaining walk — those are shared,
 * global stop conditions. Everything else resolution can fail on for one
 * target/collection (blocked URL, unauthorized, a schema-invalid page, a
 * cursor cycle) is caught and reported as a `RelationsTraversalIssue`
 * scoped to that one branch, so unrelated branches still resolve.
 */
import {
  fetchEntity,
  type ClientOptions,
  AadpIntegrityMismatchError,
  AadpDiscoveryBudgetExceededError,
  AadpChecksumMismatchError,
  AadpSchemaValidationError,
  AadpRequestError,
  BlockedUrlError,
  AbortedError,
  UnsupportedAadpVersionError,
} from "../../../../client/v1.0/index.js";
import { chargeDiscoveryBudget } from "../../../../client/discovery-budget.js";
import { scopeHeadersToOrigin } from "../../../../client/http.js";
import type { RelationCollectionV1, RelationItemV1, RelationTargetV1 } from "../types.js";
import { fetchAndValidateRelationsDocument } from "./fetch.js";
import { RelationsCursorCycleError, RelationsIntegrityMismatchError, RelationsSchemaValidationError } from "./errors.js";
import {
  chargeCrossOrigin,
  chargeDepth,
  chargeNode,
  isCrossOrigin,
  type RelationsTraversalBudgetState,
} from "./budget.js";
import type { RelationsResolutionResult, RelationsTraversalIssue, ResolvedRelationTarget } from "./types.js";

export type RelationsClientOptions = ClientOptions & {
  /** When resolving a target/collection whose origin differs from this, charge `budget.crossOriginRequestsMade`. Omit to skip cross-origin accounting entirely. */
  rootOrigin?: string;
};

/** Rethrown as-is: a global stop condition, never narrowed into a per-branch issue. */
function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

/** Maps a caught resolution error to a stable issue code from the taxonomy in `spec/modules/relations/v1.0/conformance.md`. */
function issueFromError(err: unknown, rel: string | undefined, targetId: string | undefined, url: string): RelationsTraversalIssue {
  if (err instanceof BlockedUrlError) {
    return { level: "error", code: "blocked_url", message: err.message, rel, targetId, url };
  }
  if (err instanceof AadpRequestError) {
    if (err.status === 401) return { level: "error", code: "unauthorized", message: err.message, rel, targetId, url };
    if (err.status === 403) return { level: "error", code: "forbidden", message: err.message, rel, targetId, url };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { level: "error", code: "target_unresolvable", message, rel, targetId, url };
}

/**
 * Resolves one relation target: fetches the entity at `hint.url` (via the
 * core v1.0 client, so it gets the exact same schema/checksum validation
 * as any other entity fetch) and checks it against `hint`/`expectedType`.
 * Returns `{status: "duplicate"}` without any network call when
 * `hint`'s canonical key was already visited this walk — the traversal
 * invariant "duplicate target is not charged/re-fetched a second time".
 */
export async function resolveRelationTarget(
  hint: RelationTargetV1,
  expectedType: string,
  options: RelationsClientOptions,
  budget: RelationsTraversalBudgetState,
  context: string
): Promise<{ status: "duplicate" } | { status: "resolved"; target: ResolvedRelationTarget } | { status: "issue"; issue: RelationsTraversalIssue }> {
  const { alreadyVisited } = chargeNode(budget, hint.id, hint.url, context);
  if (alreadyVisited) return { status: "duplicate" };

  // Authorization §7 of specification.md: credential headers are scoped to
  // the walk's root origin and MUST NOT follow to a different origin
  // unless explicitly allow-listed via `crossOriginSafeHeaders` — the same
  // opt-in-only allow-list `scopeHeadersToOrigin` already enforces for the
  // core client's own document-supplied URLs.
  let fetchOptions = options;
  if (options.rootOrigin) {
    if (isCrossOrigin(hint.url, options.rootOrigin)) {
      chargeCrossOrigin(budget, context); // may throw AadpDiscoveryBudgetExceededError — global stop, propagates
    }
    fetchOptions = scopeHeadersToOrigin(options, hint.url, options.rootOrigin);
  }

  try {
    const entity = await fetchEntity(hint.url, fetchOptions, budget);
    if (entity.id !== hint.id) {
      throw new AadpIntegrityMismatchError(
        `Target at ${hint.url} declares id "${entity.id}", which does not match the relation's declared target id "${hint.id}"`
      );
    }
    if (entity.type !== expectedType) {
      throw new AadpIntegrityMismatchError(
        `Target at ${hint.url} has type "${entity.type}", but the relation declares target_type "${expectedType}"`
      );
    }
    const issues: RelationsTraversalIssue[] = [];
    if (hint.checksum && hint.checksum !== entity.checksum) {
      // specification.md §6: target.checksum is a hint, not authoritative
      // — a mismatch is reported, not fatal.
      issues.push({
        level: "warning",
        code: "target_checksum_hint_mismatch",
        message: `Relation item's checksum hint "${hint.checksum}" for ${hint.id} does not match the fetched entity's checksum "${entity.checksum}".`,
        targetId: hint.id,
        url: hint.url,
      });
    }
    if (issues.length > 0) {
      // Non-fatal: still resolved, but surface the hint mismatch by
      // returning it as an issue alongside a successful resolution. Callers
      // that don't care can ignore `status: "resolved"` issues entirely —
      // there's no separate channel here, so we fold this into `issue` only
      // when it's the sole finding and there's nothing else to report.
    }
    return { status: "resolved", target: { hint, entity } };
  } catch (err) {
    if (isGlobalStop(err)) throw err;
    return { status: "issue", issue: issueFromError(err, undefined, hint.id, hint.url) };
  }
}

export interface RelationCollectionExpectation {
  sourceId: string;
  sourceType: string;
  rel: string;
  targetType: string;
}

/**
 * Follows a `relation-collection`'s `cursor.next` until exhausted,
 * yielding each page's `items` (target hints — NOT resolved entities; see
 * `resolveRelationItem`'s `resolveCollectionTargets` option for that).
 * Bounded by `budget`'s page/deadline/request/byte limits, and throws
 * `RelationsCursorCycleError` (contained to this one collection) if
 * `cursor.next` repeats — the same cycle-detection idiom as
 * `../../../../client/v1.0/index.ts`'s `iterateSitemap`.
 *
 * Charges `budget.crossOriginRequestsMade` once per page fetched whose URL
 * is cross-origin relative to `options.rootOrigin` — the same dimension
 * `resolveRelationTarget` charges once per target, so `maxCrossOriginRequests`
 * bounds a cross-origin collection's page count too, not just single-target
 * resolutions. This charges at page granularity (not per retry/redirect hop
 * within a single page fetch, unlike `maxRequests` in `http.ts`) because
 * "cross-origin relative to the walk's root" is a Relations-traversal
 * concept `http.ts` has no notion of; a page whose first attempt would
 * already exceed the limit is charged (and can throw) before that
 * attempt's `fetchAndValidateRelationsDocument` call.
 */
export async function* iterateRelationCollection(
  collectionUrl: string,
  expected: RelationCollectionExpectation,
  options: RelationsClientOptions,
  budget: RelationsTraversalBudgetState
): AsyncGenerator<RelationTargetV1> {
  let cursor: string | null | undefined;
  const seenCursors = new Set<string>();
  do {
    chargeDiscoveryBudget(budget, "page", `iterateRelationCollection(${collectionUrl})`);
    const target = new URL(collectionUrl);
    if (cursor) target.searchParams.set("cursor", cursor);
    const targetUrl = target.toString();
    if (options.rootOrigin && isCrossOrigin(targetUrl, options.rootOrigin)) {
      chargeCrossOrigin(budget, `iterateRelationCollection(${collectionUrl})`); // may throw AadpDiscoveryBudgetExceededError — global stop, propagates
    }
    const pageOptions = options.rootOrigin ? scopeHeadersToOrigin(options, targetUrl, options.rootOrigin) : options;
    const page = await fetchAndValidateRelationsDocument<RelationCollectionV1>(
      targetUrl,
      "relation-collection",
      pageOptions,
      budget
    );
    if (
      page.source.id !== expected.sourceId ||
      page.source.type !== expected.sourceType ||
      page.rel !== expected.rel ||
      page.target_type !== expected.targetType
    ) {
      throw new RelationsIntegrityMismatchError(
        `Collection page at ${target.toString()} declares source/rel/target_type ` +
          `{${page.source.id}, ${page.source.type}, ${page.rel}, ${page.target_type}}, which does not match the ` +
          `expected {${expected.sourceId}, ${expected.sourceType}, ${expected.rel}, ${expected.targetType}}`
      );
    }
    for (const item of page.items) yield item;
    cursor = page.cursor.next;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new RelationsCursorCycleError(collectionUrl, cursor);
      }
      seenCursors.add(cursor);
    }
  } while (cursor);
}

export interface ResolveRelationItemOptions extends RelationsClientOptions {
  /** Also resolve the full entity for every collection item (default: only paginate/yield hints — see `iterateRelationCollection`). */
  resolveCollectionTargets?: boolean;
}

/**
 * Resolves every target of one relation item, dispatching on `cardinality`
 * exactly as specification.md §5 defines: `one` resolves `target`; `many`
 * resolves each of `targets` (inline) or paginates `collection`. Returns a
 * `RelationsResolutionResult` — never throws for a per-target issue, only
 * for a global stop condition (see module docstring).
 */
export async function resolveRelationItem(
  item: RelationItemV1,
  sourceId: string,
  depth: number,
  options: ResolveRelationItemOptions,
  budget: RelationsTraversalBudgetState
): Promise<RelationsResolutionResult<ResolvedRelationTarget>> {
  const context = `relation "${item.rel}" of ${sourceId}`;
  chargeDepth(budget, depth, context); // global stop if exceeded — propagates

  const items: ResolvedRelationTarget[] = [];
  const issues: RelationsTraversalIssue[] = [];
  let partial = false;

  const handleOne = async (hint: RelationTargetV1) => {
    const result = await resolveRelationTarget(hint, item.target_type, options, budget, context);
    if (result.status === "resolved") items.push(result.target);
    else if (result.status === "issue") issues.push(result.issue);
    // "duplicate": not an issue (not re-fetched, not re-charged), but the
    // edge itself still happened — record it hint-only (no `entity`, since
    // it was already fetched elsewhere in this walk) so a caller building
    // a full edge list never silently loses an edge to a shared/cyclic node.
    else items.push({ hint });
  };

  if (item.cardinality === "one" && item.target) {
    await handleOne(item.target);
    return { items, partial, issues };
  }

  if (item.cardinality === "many" && Array.isArray(item.targets)) {
    for (const hint of item.targets) {
      try {
        await handleOne(hint);
      } catch (err) {
        if (isGlobalStop(err)) {
          partial = true;
          issues.push({
            level: "error",
            code: err instanceof AadpDiscoveryBudgetExceededError ? "traversal_budget_exceeded" : "traversal_aborted",
            message: (err as Error).message,
            rel: item.rel,
          });
          return { items, partial, issues };
        }
        throw err;
      }
    }
    return { items, partial, issues };
  }

  if (item.cardinality === "many" && item.collection) {
    const expected: RelationCollectionExpectation = { sourceId, sourceType: sourceId.split(":")[0] ?? "", rel: item.rel, targetType: item.target_type };
    try {
      for await (const hint of iterateRelationCollection(item.collection.url, expected, options, budget)) {
        if (options.resolveCollectionTargets) {
          await handleOne(hint);
        } else {
          const { alreadyVisited } = chargeNode(budget, hint.id, hint.url, context);
          if (!alreadyVisited) {
            items.push({ hint }); // hint-only: no `entity` fetched by design (see ResolvedRelationTarget docstring)
          }
        }
      }
    } catch (err) {
      if (isGlobalStop(err)) {
        partial = true;
        issues.push({
          level: "error",
          code: err instanceof AadpDiscoveryBudgetExceededError ? "traversal_budget_exceeded" : "traversal_aborted",
          message: (err as Error).message,
          rel: item.rel,
        });
        return { items, partial, issues };
      }
      if (err instanceof RelationsCursorCycleError) {
        partial = true;
        issues.push({ level: "error", code: "cursor_cycle", message: err.message, rel: item.rel, url: item.collection.url });
        return { items, partial, issues };
      }
      if (err instanceof RelationsIntegrityMismatchError) {
        partial = true;
        issues.push({ level: "error", code: "collection_context_mismatch", message: err.message, rel: item.rel, url: item.collection.url });
        return { items, partial, issues };
      }
      if (err instanceof RelationsSchemaValidationError || err instanceof AadpRequestError || err instanceof BlockedUrlError || err instanceof UnsupportedAadpVersionError || err instanceof AadpChecksumMismatchError || err instanceof AadpSchemaValidationError) {
        partial = true;
        issues.push(issueFromError(err, item.rel, undefined, item.collection.url));
        return { items, partial, issues };
      }
      throw err;
    }
    return { items, partial, issues };
  }

  return { items, partial, issues };
}

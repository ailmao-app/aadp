/**
 * Wire-adjacent types for the Relations v1.0 client/traversal layer
 * (`AADP-REL-005`). Deliberately separate from `../types.ts` (the wire
 * shapes): those describe what a document *contains*; these describe what
 * *resolving* one produces — a resolved target's fetched `EntityV1`, or an
 * issue explaining why resolution stopped for one branch of a walk.
 */
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { RelationItemV1, RelationTargetV1 } from "../types.js";

/**
 * Same shape as `ModuleSemanticIssue` (pure validation) but for a
 * *resolution*-time finding — something only discoverable by actually
 * fetching a target/collection/schema URL, which pure validation
 * (`../semantic.ts`) never does. Carries provenance a caller needs to
 * locate the finding: which relation (`rel`) and which target (`targetId`)
 * it came from, when applicable.
 */
export interface RelationsTraversalIssue {
  level: "error" | "warning";
  /** Stable machine-readable code, e.g. "traversal_budget_exceeded", "cursor_cycle", "graph_cycle", "blocked_url". */
  code: string;
  message: string;
  /** The relation token this issue occurred under, when applicable. */
  rel?: string;
  /** The target id this issue occurred for, when applicable. */
  targetId?: string;
  /** The URL being resolved when this issue occurred, when applicable. */
  url?: string;
  /**
   * The original error this issue was derived from, when the issue came
   * from a caught exception (as opposed to a synthesized issue like
   * `traversal_budget_exceeded`). `code`/`message` alone collapse several
   * distinct causes into one coarse bucket (e.g. `target_unresolvable`
   * covers a 404, a 5xx, a timeout, a schema-invalid response and a
   * checksum mismatch alike); a caller that needs to distinguish them —
   * e.g. Answer's `resolveAnswerTargets` telling a confirmed-absent target
   * apart from a malformed one — can inspect `cause`'s type
   * (`AadpRequestError.status`, `AadpSchemaValidationError`,
   * `AadpChecksumMismatchError`, ...) instead of parsing `message`, which
   * is not a stable API. Optional and additive: existing consumers that
   * only read `code`/`message` are unaffected.
   */
  cause?: Error;
  /**
   * The fetched, schema/checksum-validated entity, when this issue is
   * `target_unresolvable` specifically because the entity's declared
   * `type` disagreed with `expectedType` (an id mismatch does NOT set
   * this — that means the resource itself is not the declared target at
   * all, so there is nothing safe to reuse). Absent for every other issue.
   * Lets a caller that tracks its OWN, differently-scoped expected type
   * for the same canonical target (e.g. Answer's `resolveAnswerTargets`,
   * which allows two references to declare different `target_type` for
   * the same `{id, url}`) re-validate the already-fetched entity against
   * its own expectation instead of re-fetching or discarding it.
   */
  entity?: EntityV1;
}

/**
 * A relation target as returned by resolution: always carries the wire
 * `RelationTargetV1` hint it came from. `entity` is the target's fetched,
 * schema-validated `EntityV1` — present for `cardinality: one`/inline-many
 * targets and for collection items resolved with
 * `resolveCollectionTargets: true`; absent for collection items collected
 * by default (paginated but not individually fetched, to bound cost on a
 * large collection — see `resolveRelationItem`'s docstring).
 */
export interface ResolvedRelationTarget<T = unknown> {
  hint: RelationTargetV1;
  entity?: EntityV1<T>;
}

/**
 * Every resolution entry point returns this shape rather than throwing on
 * a partial outcome: `partial: true` means the walk stopped before
 * resolving everything it was asked to (budget/policy/cycle/unsupported
 * version) — per specification.md §12, a partial result MUST NOT be
 * reported as complete, so callers must check `partial` before treating
 * `items` as exhaustive. `issues` explains every gap; a `partial: false`
 * result may still carry `warning`-level issues (e.g. a target's `checksum`
 * hint disagreeing with the authoritative fetched entity).
 */
export interface RelationsResolutionResult<T> {
  items: T[];
  partial: boolean;
  issues: RelationsTraversalIssue[];
}

/** One edge resolved during a `traverseRelations` walk, with its graph depth (root = 0). */
export interface TraversedRelationEdge {
  depth: number;
  sourceId: string;
  item: RelationItemV1;
  target: ResolvedRelationTarget;
}

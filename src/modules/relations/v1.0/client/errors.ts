import type { ModuleSemanticIssue } from "../../../../module-registry/index.js";
import type { RelationsDocumentKind } from "../schemas.js";

/** A fetched Relations module document failed schema or pure semantic validation. */
export class RelationsSchemaValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly kind: RelationsDocumentKind,
    public readonly errors: unknown[],
    public readonly semanticIssues: ModuleSemanticIssue[]
  ) {
    super(`Relations document at ${url} ("${kind}") failed validation.`);
    this.name = "RelationsSchemaValidationError";
  }
}

/**
 * A fetched `relation-collection` page's declared `source`/`rel`/`target_type`
 * disagrees with what the caller expected of it (the relation item that
 * pointed at this collection, or a previous page of the same walk).
 * Distinct from `collection_context_mismatch` (a pure semantic check on
 * the page's own internal consistency): this is a *resolution*-time,
 * cross-document integrity check — mirrors `AadpIntegrityMismatchError`
 * (`../../../../client/validated-document.js`) for the core client.
 */
export class RelationsIntegrityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationsIntegrityMismatchError";
  }
}

/**
 * A `relation-collection` page's `cursor.next` repeated a previously seen
 * cursor within the same collection walk. Contained to the one collection
 * being paginated — a caller resolving multiple independent relations
 * catches this per-collection and marks that one branch partial rather
 * than aborting the whole traversal (specification.md §12).
 */
export class RelationsCursorCycleError extends Error {
  constructor(url: string, cursor: string) {
    super(`Cursor cycle detected: "${cursor}" was already seen while paginating ${url}`);
    this.name = "RelationsCursorCycleError";
  }
}

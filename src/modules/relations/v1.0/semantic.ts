/**
 * AADP Relations Module v1.0 pure semantic validators (`AADP-REL-004`,
 * specification.md §11). Pure functions only — no HTTP, no filesystem
 * access, no fetching a target/collection/schema URL. Input to each
 * function MUST already be schema-valid for the corresponding document
 * kind; these checks cover constraints JSON Schema cannot express:
 * cardinality/container consistency, relation token validity, target
 * ID/type-prefix agreement, duplicate targets, and checksum/uniqueness
 * invariants. Reference resolution (does the target actually exist, does
 * a collection page's `cursor` actually terminate) is a separate
 * traversal concern — `AADP-REL-005` — not this module.
 *
 * Mirrors the shape of `../../../validator/semantic.ts` (core manifest
 * semantics): reuses its `ModuleSemanticIssue`/level contract from
 * `../../../module-registry/index.js` rather than defining a parallel one.
 */
import { checksumOf } from "../../../canonical-json/checksum.js";
import type { ModuleSemanticIssue } from "../../../module-registry/index.js";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * specification.md §8 table — the fixed v1.0 standard relation token set.
 * `follows`/`followers` are deliberately absent (privacy risk, per spec).
 * Any unnamespaced token outside this set MUST be rejected; vendor tokens
 * (`x_<namespace>:<token>`) are always accepted regardless of this list.
 */
export const STANDARD_RELATION_TOKENS: ReadonlySet<string> = new Set([
  "creator",
  "created",
  "author",
  "authored",
  "posts",
  "series",
  "part_of",
  "has_part",
  "mentions",
  "mentioned_by",
  "about",
  "subject_of",
  "supports",
  "supported_by",
  "evidence",
  "source",
  "source_of",
  "related",
]);

const VENDOR_TOKEN_PATTERN = /^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;

/** True for a standard v1.0 token or a namespaced vendor token; false for any other unnamespaced word. */
export function isValidRelationToken(token: string): boolean {
  return STANDARD_RELATION_TOKENS.has(token) || VENDOR_TOKEN_PATTERN.test(token);
}

function idTypePrefix(id: string): string | undefined {
  const i = id.indexOf(":");
  return i === -1 ? undefined : id.slice(0, i);
}

interface RelationTargetLike {
  id?: unknown;
}

interface RelationItemLike {
  rel?: unknown;
  target_type?: unknown;
  cardinality?: unknown;
  inverse?: unknown;
  target?: RelationTargetLike;
  targets?: RelationTargetLike[];
  collection?: unknown;
}

interface RelationSetLike {
  items?: RelationItemLike[];
}

function checkItemTokens(item: RelationItemLike, path: string, issues: ModuleSemanticIssue[]): void {
  if (isString(item.rel) && !isValidRelationToken(item.rel)) {
    issues.push({
      level: "error",
      code: "invalid_relation_token",
      path: `${path}/rel`,
      message: `Relation token "${item.rel}" is neither a standard v1.0 token nor a namespaced vendor token (^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$).`,
    });
  }
  if (isString(item.inverse) && !isValidRelationToken(item.inverse)) {
    issues.push({
      level: "error",
      code: "invalid_relation_token",
      path: `${path}/inverse`,
      message: `Inverse token "${item.inverse}" is neither a standard v1.0 token nor a namespaced vendor token (^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$).`,
    });
  }
}

const MAX_INLINE_TARGETS = 100;

function checkItemCardinality(item: RelationItemLike, path: string, issues: ModuleSemanticIssue[]): void {
  const hasTarget = item.target !== undefined;
  const hasTargets = item.targets !== undefined;
  const hasCollection = item.collection !== undefined;

  if (item.cardinality === "one") {
    if (!hasTarget) {
      issues.push({
        level: "error",
        code: "invalid_cardinality_container",
        path,
        message: `cardinality "one" MUST have "target"; none was present.`,
      });
    }
    if (hasTargets || hasCollection) {
      issues.push({
        level: "error",
        code: "invalid_cardinality_container",
        path,
        message: `cardinality "one" MUST NOT have "targets" or "collection".`,
      });
    }
    return;
  }

  if (item.cardinality === "many") {
    if (hasTarget) {
      issues.push({
        level: "error",
        code: "invalid_cardinality_container",
        path,
        message: `cardinality "many" MUST NOT have "target".`,
      });
    }
    if (hasTargets === hasCollection) {
      // both present or both absent
      issues.push({
        level: "error",
        code: "invalid_cardinality_container",
        path,
        message: hasTargets
          ? `cardinality "many" MUST have exactly one of "targets" or "collection", not both.`
          : `cardinality "many" MUST have exactly one of "targets" or "collection".`,
      });
    }
    if (hasTargets && Array.isArray(item.targets) && item.targets.length > MAX_INLINE_TARGETS) {
      issues.push({
        level: "error",
        code: "invalid_cardinality_container",
        path: `${path}/targets`,
        message: `Inline "targets" has ${item.targets.length} entries, exceeding the ${MAX_INLINE_TARGETS}-item limit; use "collection" instead.`,
      });
    }
  }
}

function checkTargetIdentity(
  target: RelationTargetLike,
  expectedType: unknown,
  path: string,
  issues: ModuleSemanticIssue[]
): void {
  if (!isString(target.id) || !isString(expectedType)) return;
  const prefix = idTypePrefix(target.id);
  if (prefix !== expectedType) {
    issues.push({
      level: "error",
      code: "target_identity_mismatch",
      path: `${path}/id`,
      message: `Target id "${target.id}" has type prefix "${prefix ?? ""}", which does not match target_type "${expectedType}".`,
    });
  }
}

function checkDuplicateTargets(targets: RelationTargetLike[], path: string, issues: ModuleSemanticIssue[]): void {
  const seen = new Map<string, number>();
  targets.forEach((t, i) => {
    if (!isString(t.id)) return;
    const first = seen.get(t.id);
    if (first !== undefined) {
      issues.push({
        level: "error",
        code: "duplicate_target",
        path: `${path}/${i}/id`,
        message: `Target id "${t.id}" duplicates the entry at index ${first}; each target MUST appear at most once.`,
      });
    } else {
      seen.set(t.id, i);
    }
  });
}

/**
 * Runs every `AADP-REL-004` pure rule against a schema-valid `relation-set`
 * document (the value of `entity.x_relations`). Returns an empty array
 * when no issue was found.
 */
export function checkRelationSetSemantics(doc: unknown): ModuleSemanticIssue[] {
  const issues: ModuleSemanticIssue[] = [];
  if (doc === null || typeof doc !== "object") {
    return [{ level: "error", code: "invalid_module_document", path: "", message: "relation-set document is not an object." }];
  }
  const items = (doc as RelationSetLike).items;
  if (!Array.isArray(items)) return issues;

  items.forEach((item, i) => {
    const path = `/items/${i}`;
    checkItemTokens(item, path, issues);
    checkItemCardinality(item, path, issues);
    if (item.target) checkTargetIdentity(item.target, item.target_type, `${path}/target`, issues);
    if (Array.isArray(item.targets)) {
      item.targets.forEach((t, j) => checkTargetIdentity(t, item.target_type, `${path}/targets/${j}`, issues));
      checkDuplicateTargets(item.targets, `${path}/targets`, issues);
    }
  });

  return issues;
}

interface RelationCollectionLike {
  source?: { id?: unknown; type?: unknown };
  rel?: unknown;
  target_type?: unknown;
  checksum?: unknown;
  items?: RelationTargetLike[];
}

/**
 * Runs every `AADP-REL-004` pure rule against a schema-valid
 * `relation-collection` page. Returns an empty array when no issue was
 * found. Does not resolve `cursor.next` or fetch `source` — see
 * `AADP-REL-005` for traversal/resolution checks.
 */
export function checkRelationCollectionSemantics(doc: unknown): ModuleSemanticIssue[] {
  const issues: ModuleSemanticIssue[] = [];
  if (doc === null || typeof doc !== "object") {
    return [
      { level: "error", code: "invalid_module_document", path: "", message: "relation-collection document is not an object." },
    ];
  }
  const collection = doc as RelationCollectionLike;

  if (isString(collection.rel) && !isValidRelationToken(collection.rel)) {
    issues.push({
      level: "error",
      code: "invalid_relation_token",
      path: "/rel",
      message: `Relation token "${collection.rel}" is neither a standard v1.0 token nor a namespaced vendor token.`,
    });
  }

  const items = Array.isArray(collection.items) ? collection.items : [];
  items.forEach((item, i) => {
    if (isString(item.id) && isString(collection.target_type)) {
      const prefix = idTypePrefix(item.id);
      if (prefix !== collection.target_type) {
        issues.push({
          level: "error",
          code: "collection_context_mismatch",
          path: `/items/${i}/id`,
          message: `Item id "${item.id}" has type prefix "${prefix ?? ""}", which does not match the collection's target_type "${collection.target_type}".`,
        });
      }
    }
  });
  checkDuplicateTargets(items, "/items", issues);

  if (isString(collection.checksum)) {
    const expected = checksumOf(items);
    if (expected !== collection.checksum) {
      issues.push({
        level: "error",
        code: "collection_checksum_mismatch",
        path: "/checksum",
        message: `Declared checksum "${collection.checksum}" does not match the canonical checksum of "items" (${expected}).`,
      });
    }
  }

  return issues;
}

interface RelationRegistryEntryLike {
  token?: unknown;
  inverse?: unknown;
  symmetric?: unknown;
}

interface RelationRegistryLike {
  checksum?: unknown;
  relations?: RelationRegistryEntryLike[];
}

/**
 * Runs every `AADP-REL-004` pure rule against a schema-valid
 * `relation-registry` document. Returns an empty array when no issue was
 * found.
 */
export function checkRelationRegistrySemantics(doc: unknown): ModuleSemanticIssue[] {
  const issues: ModuleSemanticIssue[] = [];
  if (doc === null || typeof doc !== "object") {
    return [
      { level: "error", code: "invalid_module_document", path: "", message: "relation-registry document is not an object." },
    ];
  }
  const registry = doc as RelationRegistryLike;
  const relations = Array.isArray(registry.relations) ? registry.relations : [];

  const seen = new Map<string, number>();
  relations.forEach((entry, i) => {
    // specification.md §8: a registry entry's own `token`/`inverse` are
    // grammar-checked the same way an item's `rel`/`inverse` are — a
    // registry MUST NOT itself define a token outside the standard set
    // and outside the vendor namespace.
    if (isString(entry.token) && !isValidRelationToken(entry.token)) {
      issues.push({
        level: "error",
        code: "invalid_relation_token",
        path: `/relations/${i}/token`,
        message: `Token "${entry.token}" is neither a standard v1.0 token nor a namespaced vendor token (^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$).`,
      });
    }
    if (isString(entry.inverse) && !isValidRelationToken(entry.inverse)) {
      issues.push({
        level: "error",
        code: "invalid_relation_token",
        path: `/relations/${i}/inverse`,
        message: `Inverse "${entry.inverse}" is neither a standard v1.0 token nor a namespaced vendor token (^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$).`,
      });
    }
    // specification.md §8: "symmetric: true yêu cầu inverse bằng chính token."
    // A missing `inverse` fails this exactly like a mismatched one — schema
    // makes `inverse` optional, but `symmetric: true` normatively requires
    // it to be present and equal to `token`, so `undefined !== token` must
    // flag it too, not just an explicit-but-wrong string.
    if (entry.symmetric === true && isString(entry.token) && entry.inverse !== entry.token) {
      issues.push({
        level: "error",
        code: "symmetric_inverse_mismatch",
        path: `/relations/${i}/inverse`,
        message: isString(entry.inverse)
          ? `Entry "${entry.token}" declares symmetric: true, which requires inverse to equal the token itself; got inverse "${entry.inverse}".`
          : `Entry "${entry.token}" declares symmetric: true, which requires inverse to be present and equal to the token itself; inverse is missing.`,
      });
    }

    if (!isString(entry.token)) return;
    const first = seen.get(entry.token);
    if (first !== undefined) {
      issues.push({
        level: "error",
        code: "duplicate_registry_token",
        path: `/relations/${i}/token`,
        message: `Token "${entry.token}" duplicates the entry at index ${first}; each registry token MUST be unique.`,
      });
    } else {
      seen.set(entry.token, i);
    }
  });

  if (isString(registry.checksum)) {
    const expected = checksumOf(relations);
    if (expected !== registry.checksum) {
      issues.push({
        level: "error",
        code: "registry_checksum_mismatch",
        path: "/checksum",
        message: `Declared checksum "${registry.checksum}" does not match the canonical checksum of "relations" (${expected}).`,
      });
    }
  }

  return issues;
}

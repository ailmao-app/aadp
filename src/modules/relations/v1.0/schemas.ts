/**
 * Loads the Relations Module v1.0 JSON Schema artifacts from
 * `schemas/modules/relations/v1.0/` (specification.md §10). Mirrors the
 * loading approach in `../../../validator/schemas.ts` for the core
 * schemas, kept separate because module schemas are not core schemas
 * (ADR-0007 "Module registry lookup is outside the closed core schema
 * registry").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "relations", "v1.0");

/** The three document kinds this module registers with the module registry (specification.md §3). */
export type RelationsDocumentKind = "relation-set" | "relation-collection" | "relation-registry";

export const RELATIONS_DOCUMENT_KINDS: readonly RelationsDocumentKind[] = [
  "relation-set",
  "relation-collection",
  "relation-registry",
];

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(schemasRoot, file), "utf8"));
}

/** Top-level document schema for `relation-set` (the `entity.x_relations` value). */
export const relationSetSchema = loadSchema("relation-set.schema.json");
/** Top-level document schema for `relation-collection` (one collection page). */
export const relationCollectionSchema = loadSchema("relation-collection.schema.json");
/** Top-level document schema for `relation-registry` (the standard token registry). */
export const relationRegistrySchema = loadSchema("relation-registry.schema.json");

/** Component schemas — never registered as module-registry document kinds on their own (specification.md §10). */
export const relationItemSchema = loadSchema("relation-item.schema.json");
export const targetSchema = loadSchema("target.schema.json");
export const collectionLinkSchema = loadSchema("collection-link.schema.json");

/** The `modules[].schema` dispatch document — `oneOf`-selects one of the three document schemas above by `kind`. */
export const moduleDispatchSchema = loadSchema("module.schema.json");

export const schemasByKind: Record<RelationsDocumentKind, object> = {
  "relation-set": relationSetSchema,
  "relation-collection": relationCollectionSchema,
  "relation-registry": relationRegistrySchema,
};

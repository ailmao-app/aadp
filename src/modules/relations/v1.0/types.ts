/**
 * AADP Relations Module v1.0 wire types. Field shapes mirror
 * `schemas/modules/relations/v1.0/*.schema.json` and
 * `spec/modules/relations/v1.0/specification.md`.
 *
 * Deliberately independent of `../../../client/v1.0/types.ts` — a
 * `RelationTargetV1` is not an `EntityV1`; the core entity envelope
 * types are never duplicated here, they are simply referenced by ID/URL.
 */

/** Every AADP v1.0 module object permits `x_*` extension fields (spec v1.0 §3.1.10). */
interface ExtensionFields {
  [key: `x_${string}`]: unknown;
}

export type RelationCardinality = "one" | "many";

/** specification.md §6 — identifies one relation target by ID and authoritative URL. */
export interface RelationTargetV1 extends ExtensionFields {
  id: string;
  url: string;
  label?: string;
  /** `sha256:<hex>` hint; authoritative value lives on the fetched entity. */
  checksum?: string;
  updated_at?: string;
}

/** specification.md §5.3 — points a `many` relation at its paginated collection instead of an inline list. */
export interface RelationCollectionLinkV1 extends ExtensionFields {
  url: string;
  pagination: "cursor";
}

/**
 * specification.md §5. Schema-shape only: which of `target` / `targets` /
 * `collection` is actually present for a given `cardinality` is a pure
 * semantic constraint, not encoded in this type — see
 * `checkRelationSetSemantics` in `./semantic.js`.
 */
export interface RelationItemV1 extends ExtensionFields {
  rel: string;
  target_type: string;
  cardinality: RelationCardinality;
  inverse?: string;
  ordered?: boolean;
  updated_at?: string;
  target?: RelationTargetV1;
  targets?: RelationTargetV1[];
  collection?: RelationCollectionLinkV1;
}

/**
 * specification.md §4 — top-level module document kind `relation-set`:
 * the value of an AADP v1.0 entity's `x_relations` field. Nested inside an
 * already-versioned entity, so it self-describes `module`/`version`/`kind`
 * but not `aadp_version` (ADR-0007 "Envelope boundary").
 */
export interface RelationSetV1 extends ExtensionFields {
  module: "aadp:relations";
  version: "1.0";
  kind: "relation-set";
  items: RelationItemV1[];
}

/**
 * specification.md §7 — top-level module document kind
 * `relation-collection`: one page of a relation's paginated collection
 * endpoint. Standalone document, so it self-describes `aadp_version`,
 * `module`, `module_version` and `kind` per ADR-0007.
 */
export interface RelationCollectionV1 extends ExtensionFields {
  aadp_version: "1.0";
  module: "aadp:relations";
  module_version: "1.0";
  kind: "relation-collection";
  source: ({ id: string; type: string } & ExtensionFields);
  rel: string;
  target_type: string;
  ordered?: boolean;
  generated_at: string;
  /** `sha256:<hex>` of canonical `items` — specification.md §7. */
  checksum: string;
  items: RelationTargetV1[];
  cursor: { next: string | null };
}

/** specification.md §8 — one entry of the standard relation registry. */
export interface RelationRegistryEntryV1 extends ExtensionFields {
  token: string;
  inverse?: string;
  symmetric?: boolean;
  /** Untrusted informational text (spec v1.0 §3.1.9-style caveat applies). */
  description?: string;
}

/**
 * specification.md §8 — top-level module document kind
 * `relation-registry`: the machine-readable standard relation token
 * registry. Standalone document; self-describes `aadp_version`, `module`,
 * `module_version` and `kind` per ADR-0007.
 */
export interface RelationRegistryV1 extends ExtensionFields {
  aadp_version: "1.0";
  module: "aadp:relations";
  module_version: "1.0";
  kind: "relation-registry";
  generated_at: string;
  /** `sha256:<hex>` of canonical `relations` — specification.md §8. */
  checksum: string;
  relations: RelationRegistryEntryV1[];
}

/** Union of the three Relations v1.0 top-level module document kinds. */
export type RelationsDocumentV1 = RelationSetV1 | RelationCollectionV1 | RelationRegistryV1;

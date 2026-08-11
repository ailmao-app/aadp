# AADP Relations Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:relations` |
| Module version | `1.0` |
| Core compatibility | AADP `1.0` |
| Package target | `ail-aadp@1.2.0` |

## Abstract

This document defines the normative wire contract for Relations Module v1.0. The
module expresses typed relations between AADP entities as an inline relation set
or a paginated collection, without changing the core v1.0 schemas. Uppercase BCP
14 keywords carry their normative meaning.

## 1. Scope

The module defines discovery, `x_relations`, the one/inline-many/collection
relation forms, canonical targets, the standard registry, validation and
traversal conformance. The module does not define ranking, graph inference, a
database model, business authorization or automatic credential acquisition.

## 2. Discovery and compatibility

```json
{
  "id": "aadp:relations",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json"
}
```

A server MUST advertise the module only once its payloads, endpoints, schemas
and conformance artifacts are deployed. A core-only client MUST ignore the
declaration and `x_relations`. A Relations client MUST exact-match the ID and
version, and MUST NOT fall back to another version. The `schema` field points at
the dispatch schema for the top-level Relations documents; the discovery entry
itself is validated by the core manifest schema v1.0, not by that schema.

## 3. Document kinds

- `relation-set`: the value of `entity.x_relations`.
- `relation-collection`: one page from a collection endpoint.
- `relation-registry`: the machine-readable standard registry.

Relation items and targets are schema components only.

## 4. Relation set

```json
{
  "module": "aadp:relations",
  "version": "1.0",
  "kind": "relation-set",
  "items": []
}
```

`module`, `version`, `kind` and `items` are REQUIRED. An unknown non-`x_*` field
MUST be rejected; `x_*` MAY appear on any object the module defines.

## 5. Relation item

| Field | Required | Contract |
|---|---|---|
| `rel` | Yes | A standard token or a namespaced vendor token |
| `target_type` | Yes | An AADP resource type token |
| `cardinality` | Yes | `one` or `many` |
| `inverse` | No | Descriptive inverse token |
| `ordered` | No | Defaults to `false` |
| `updated_at` | No | RFC 3339 date-time |

### 5.1 One

```json
{
  "rel": "creator",
  "target_type": "character",
  "cardinality": "one",
  "inverse": "created",
  "target": {
    "id": "character:alice",
    "url": "https://example.com/ai/v1.0/entities/character/alice.json"
  }
}
```

`one` MUST have exactly `target`, and MUST NOT have `targets` or `collection`.

### 5.2 Inline many

```json
{
  "rel": "series",
  "target_type": "series",
  "cardinality": "many",
  "ordered": false,
  "targets": [
    {
      "id": "series:example",
      "url": "https://example.com/ai/v1.0/entities/series/example.json"
    }
  ]
}
```

`many` MUST have exactly one of `targets` or `collection`. An inline list MUST
NOT exceed 100 items; larger lists use a collection.

### 5.3 Collection many

```json
{
  "rel": "posts",
  "target_type": "post",
  "cardinality": "many",
  "ordered": true,
  "collection": {
    "url": "https://example.com/ai/v1.0/relations/character/alice/posts.json",
    "pagination": "cursor"
  }
}
```

`collection.pagination` MUST be `cursor` in v1.0.

## 6. Canonical target

`id` and an absolute HTTP(S) `url` are REQUIRED. `label`, `checksum` and
`updated_at` are hints. The entity at the URL is authoritative and MUST have an
ID equal to the target ID and a type equal to `target_type`. The ID prefix
before `:` MUST equal `target_type`.

## 7. Relation collection

```json
{
  "aadp_version": "1.0",
  "module": "aadp:relations",
  "module_version": "1.0",
  "kind": "relation-collection",
  "source": {
    "id": "character:alice",
    "type": "character"
  },
  "rel": "posts",
  "target_type": "post",
  "ordered": true,
  "generated_at": "2026-08-05T00:00:00Z",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "items": [],
  "cursor": {
    "next": null
  }
}
```

Every field is REQUIRED except `ordered`, which defaults to `false`. `checksum`
is the SHA-256 of the canonical `items` per the core convention. `cursor.next`
is an opaque string or `null`, bound to the source, relation, target type,
ordering and filters. A page MUST NOT contain duplicate target IDs.
`ordered: true` requires a stable snapshot ordering.

## 8. Standard registry

The machine-readable registry uses this envelope:

```json
{
  "aadp_version": "1.0",
  "module": "aadp:relations",
  "module_version": "1.0",
  "kind": "relation-registry",
  "generated_at": "2026-08-05T00:00:00Z",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "relations": [
    {
      "token": "related",
      "inverse": "related",
      "symmetric": true,
      "description": "A general symmetric relationship"
    }
  ]
}
```

`aadp_version`, `module`, `module_version`, `kind`, `generated_at`, `checksum`
and `relations` are REQUIRED. `checksum` is computed over the canonical
`relations`. Every token MUST be unique. `inverse` MAY be omitted when there is
no standard inverse; `symmetric: true` requires `inverse` to equal the token
itself. `description` is untrusted informational text.

| Token | Inverse hint | Semantics |
|---|---|---|
| `creator` | `created` | The target created the source |
| `created` | `creator` | The target was created by the source |
| `author` | `authored` | The target wrote the source |
| `authored` | `author` | The target was written by the source |
| `posts` | `creator` or `author` | The target is a post by the source |
| `series` | `has_part` | The target is a series of the source |
| `part_of` | `has_part` | The source is part of the target |
| `has_part` | `part_of` | The target is part of the source |
| `mentions` | `mentioned_by` | The source mentions the target |
| `mentioned_by` | `mentions` | The target mentions the source |
| `about` | `subject_of` | The source is about the target |
| `subject_of` | `about` | The target is about the source |
| `supports` | `supported_by` | The source supports the target |
| `supported_by` | `supports` | The target supports the source |
| `evidence` | `supports` | The target is evidence |
| `source` | `source_of` | The target is a source |
| `source_of` | `source` | The target uses the source entity |
| `related` | `related` | A general symmetric relationship |

`follows`/`followers` are not part of the v1.0 registry because of privacy risk.
A vendor token MUST match `^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$`. An unknown
unnamespaced token MUST be rejected. Inverse consistency is a SHOULD, not a
MUST.

## 9. HTTP behaviour

- Success: `200 application/json`.
- Empty collection: `200` with `items: []`.
- Unknown source: AADP `not_found`.
- Invalid or cross-context cursor: AADP `invalid_request`.
- Missing credential: AADP `unauthorized`.
- Policy-blocked known relation: AADP `forbidden`.

A collection SHOULD support ETag, Last-Modified and conditional GET. A generic
HTML error page or a silent scraping fallback MUST NOT be used.

## 10. Schema artifacts

The package MUST ship exactly these artifacts:

```text
schemas/modules/relations/v1.0/
├── module.schema.json
├── relation-set.schema.json
├── relation-item.schema.json
├── target.schema.json
├── collection-link.schema.json
├── relation-collection.schema.json
└── relation-registry.schema.json
```

`module.schema.json` is the module's dispatch schema and MUST use `oneOf` on
`kind` to reach exactly the three top-level document schemas. It MUST NOT
validate the discovery entry `{id, version, schema}`; that entry belongs to the
core manifest schema v1.0. Component schemas MUST NOT be registered as document
kinds.

## 11. Validation model

Pure validation checks schema, cardinality, tokens, ID prefixes and duplicates
without making network calls. Resolution validation fetches targets and
collections and checks identity, context and cursors using the shared HTTP stack
and budget. Pure validation MUST run before any URL in a module payload is
trusted.

## 12. Traversal

Traversal MUST follow ADR-0008: a shared depth/node/request/byte/deadline
budget, a cross-origin cap, cancellation, a cycle guard and deduplication. A
partial or inconclusive result MUST NOT be reported as complete.

## 13. Security and privacy

- Relation text and labels are untrusted data.
- Every URL goes through the SSRF/redirect policy.
- The module MUST NOT bypass a target's security scheme.
- Public AADP MUST NOT expose private, block or moderation relations.
- A broken relation MUST NOT trigger scraping or tool execution.

## 14. Compatibility

A core-only consumer ignores `x_relations`. The Relations 1.0 schemas, types,
validator, client and conformance suite MUST be released together.

## 15. IANA Considerations

This document has no IANA actions.

## 16. References

- [AADP v1.0 specification](../../../v1.0/specification.md)
- [ADR-0007](../../../../docs/adr/0007-module-versioning-and-discovery.md)
- [ADR-0008](../../../../docs/adr/0008-module-traversal-and-authorization.md)
- [Conformance contract](conformance.md)

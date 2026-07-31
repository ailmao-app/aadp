# AADP Relations Module Design

| Field | Value |
|---|---|
| Document type | Design memo |
| Status | Draft |
| Audience | Module designers and reviewers |
| Normative authority | None until accepted by ADR and versioned module specification |
| Decision owner | AADP maintainers |
| Blocking dependency | Module versioning ADR |
| Vietnamese internal edition | [`../vi/design/relations-module-design.md`](../vi/design/relations-module-design.md) |

## Abstract

This memo proposes typed relationships between AADP entities. All identifiers,
versions, shapes, and URLs in this draft are non-normative until the module
versioning ADR and a module specification are accepted.

## Status of This Memo

This document is a design input, not an implemented protocol extension. A server
MUST NOT advertise the proposed module merely because an example appears here.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Purpose

The Relations Module defines typed links between AADP entities so clients can traverse an application graph instead of treating every entity as an isolated document.

The module is optional and independently versioned. A server advertises it through `manifest.modules` only after its schema and endpoints pass module conformance.

## Design goals

- Represent outbound and inbound relationships with stable relation types.
- Preserve the canonical target entity ID and retrieval URL.
- Distinguish a single relation from a collection.
- Support pagination for large relation collections.
- Allow inverse-relation discovery without forcing duplicated domain data.
- Keep application-specific graph semantics outside AADP core.

## Proposed declaration

```json
{
  "id": "aadp:relations",
  "version": "0.1",
  "schema": "https://aadp.dev/schemas/modules/relations/v0.1/schema.json"
}
```

## Proposed entity shape

```json
{
  "relations": [
    {
      "type": "authored_by",
      "cardinality": "one",
      "target": {
        "id": "character:alice",
        "url": "https://example.com/ai/v1.0/entities/character/alice.json"
      },
      "inverse": "authored"
    }
  ]
}
```

Collections should use a separate paginated relation document rather than embedding an unbounded target list in an entity.

## Validation requirements

- Relation type tokens must use a documented grammar.
- Target IDs must follow the AADP canonical-ID grammar.
- Target URLs must be absolute and pass the same URL policy as other discovered URLs.
- `cardinality: "one"` must not contain multiple targets.
- Inverse relations are descriptive metadata and must not be trusted without validating the target document.
- Unknown relation types must not make the core entity envelope invalid.

## Open work

- Publish the module JSON Schema.
- Define the relation collection envelope and cursor behavior.
- Define namespacing rules for vendor-specific relation types.
- Add module fixtures, validator support, and conformance tests.
- Resolve cycle-handling guidance for graph traversal clients.

## Draft exit criteria

This memo may move from Draft to Proposed only when the module-versioning ADR is
accepted, open envelope/cursor questions are closed, and schema plus conformance
fixtures exist. It may move to Accepted only after interoperability review. The
example version `0.1` is not allocated by this memo.

# AEO and GEO Integration Plan for AADP

| Field | Value |
|---|---|
| Document type | Design plan |
| Status | Draft |
| Audience | Module designers, application adapters, and reviewers |
| Normative authority | None |
| Decision owner | AADP maintainers |
| Blocking dependencies | Module versioning ADR and Relations Module contract |
| Vietnamese internal edition | [`../vi/design/aeo-geo-integration-plan.md`](../vi/design/aeo-geo-integration-plan.md) |

## Abstract

This memo describes a delivery sequence for Answer Engine Optimization and
Generative Engine Optimization modules. Proposed module identifiers and versions
are examples, not allocated wire contracts.

## Status of This Memo

The work remains subject to module-versioning ADRs, schemas, interoperability
tests, and independent conformance. Requirement words follow
[the AADP documentation conventions](../document-conventions.md).

## Objective

Define Answer Engine Optimization and Generative Engine Optimization as versioned semantic modules inside AADP rather than as marketing capability tokens.

- The Answer Module makes questions, concise answers, applicability, and related entities machine-readable.
- The Evidence Module makes claims, supporting evidence, sources, freshness, and canonical citation targets traceable.
- The Relations Module provides shared graph links used by answer and evidence documents.

## Principles

- AADP core remains a generic discovery and retrieval envelope.
- Modules are optional, versioned, schema-backed, and independently conformant.
- Servers advertise only modules that are deployed.
- Claims must remain distinguishable from evidence and sources.
- Generated summaries must preserve uncertainty and source context.
- Citation metadata must point to canonical, retrievable resources.
- Application-specific ranking and generation logic stays outside protocol core.

## Proposed modules

```json
[
  {
    "id": "aadp:answer",
    "version": "0.1",
    "schema": "https://aadp.dev/schemas/modules/answer/v0.1/schema.json"
  },
  {
    "id": "aadp:evidence",
    "version": "0.1",
    "schema": "https://aadp.dev/schemas/modules/evidence/v0.1/schema.json"
  },
  {
    "id": "aadp:relations",
    "version": "0.1",
    "schema": "https://aadp.dev/schemas/modules/relations/v0.1/schema.json"
  }
]
```

## Delivery plan

1. Define module terminology and boundaries.
2. Publish JSON Schemas and valid and invalid fixtures.
3. Add module-specific validators.
4. Add reference entities for answers, claims, evidence, and sources.
5. Add conformance tests for citation integrity and freshness metadata.
6. Add client helpers without coupling core traversal to module support.
7. Pilot modules in an application adapter only after core conformance passes.

## Release gates

- Every advertised module has a stable ID, version, and reachable schema.
- Answer payloads distinguish factual content from generated summaries.
- Evidence links resolve to canonical sources.
- Claim-to-evidence references are valid and testable.
- Unknown modules remain safely ignorable by core-only clients.
- Module free text remains untrusted data.

## Draft exit criteria

This plan may move to Proposed only after module versioning and the Relations
Module boundary are accepted. Answer and Evidence schemas, fixtures, citation
integrity rules, and independent conformance checks are required before the plan
can move to Accepted. Versions shown in examples are non-normative placeholders.

See also:

- [Manifest v1.0 design](manifest-v1.0-design.md)
- [Relations Module design](relations-module-design.md)
- [AADP v1.0 specification](../../spec/v1.0/specification.md)

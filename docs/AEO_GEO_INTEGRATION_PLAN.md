# AEO and GEO Integration Plan for AADP

> Status: Design plan.
>
> Vietnamese edition: [`vi/AEO_GEO_INTEGRATION_PLAN.md`](vi/AEO_GEO_INTEGRATION_PLAN.md).

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

See also:

- [Manifest v1.0 design](MANIFEST_V1.0_DESIGN.md)
- [Relations Module design](RELATIONS_MODULE_DESIGN.md)
- [AADP v1.0 specification](../spec/v1.0/specification.md)

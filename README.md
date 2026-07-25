# AI Application Discovery Protocol (AADP)

AADP is an open protocol that helps AI discover and read structured data directly from applications or APIs.

The normative specification is at [`spec/v0.1/specification.md`](spec/v0.1/specification.md); the plan to build AADP into a standalone product, and only later apply it experimentally to Ailmao, is at [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

The plan to build Answer Engine Optimization and Generative Engine Optimization into standard modules inside AADP is at [`docs/AEO_GEO_INTEGRATION_PLAN.md`](docs/AEO_GEO_INTEGRATION_PLAN.md).

The v1.0 manifest design, based on the application discovery document model, is at [`docs/MANIFEST_V1.0_DESIGN.md`](docs/MANIFEST_V1.0_DESIGN.md).

The typed relation and graph traversal design is at [`docs/RELATIONS_MODULE_DESIGN.md`](docs/RELATIONS_MODULE_DESIGN.md).

## v0.1 Scope

- Manifest at `/.well-known/ai-manifest.json`.
- Sitemap index and sitemaps by resource type.
- Read-only Entity API.
- JSON Schema, valid examples, and contract tests.
- A validator and conformance test suite usable by any application.
- A reference client demonstrating the discovery flow independently of Ailmao.
- `ailmao-landing` implements an adapter (`lib/aadp/`) consuming the `ail-aadp` package.

## Structure

```text
aadp/
├── README.md
├── CHANGELOG.md
├── docs/                 # Design docs and ADRs
├── spec/                 # Versioned standard specification
├── schemas/              # JSON Schema for manifest, sitemap, and entity
├── examples/             # Sample payloads independent of Ailmao
├── src/                  # Canonical JSON, validator, reference client
└── tests/                # Protocol contract tests and fixtures
```

## Integration Principles

AADP is designed, versioned, and tested independently of Ailmao. Do not introduce Ailmao-specific data types, URLs, or rules into the core specification. `ailmao-landing` implements an adapter that conforms to the standard and is validated by AADP's own conformance suite.

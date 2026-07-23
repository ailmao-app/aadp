# AI Application Discovery Protocol (AADP)

AADP is a project specifying an open protocol that helps AI discover and read structured data directly from applications or APIs.

This project is currently at the v0.1 design stage. The source draft is at [`docs/AADP_Draft.md`](docs/AADP_Draft.md); the plan to build AADP into a standalone product, and only later apply it experimentally to Ailmao, is at [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

The plan to build Answer Engine Optimization and Generative Engine Optimization into standard modules inside AADP is at [`docs/AEO_GEO_INTEGRATION_PLAN.md`](docs/AEO_GEO_INTEGRATION_PLAN.md).

The v0.2 manifest design, based on the application discovery document model, is at [`docs/MANIFEST_V0.2_DESIGN.md`](docs/MANIFEST_V0.2_DESIGN.md).

The typed relation and graph traversal design is at [`docs/RELATIONS_MODULE_DESIGN.md`](docs/RELATIONS_MODULE_DESIGN.md).

## v0.1 Scope

- Manifest at `/.well-known/ai-manifest.json`.
- Sitemap index and sitemaps by resource type.
- Read-only Entity API.
- JSON Schema, valid examples, and contract tests.
- A validator and conformance test suite usable by any application.
- A reference client demonstrating the discovery flow independently of Ailmao.
- The `ailmao-landing` adapter will only be built after AADP v0.1 passes its release gate.

## Planned Structure

```text
aadp/
├── README.md
├── docs/
│   └── IMPLEMENTATION_PLAN.md
├── spec/                 # Versioned standard specification
├── schemas/              # JSON Schema for manifest, sitemap, and entity
├── examples/             # Sample payloads independent of Ailmao
└── tests/                # Protocol contract tests and fixtures
```

The `spec`, `schemas`, `examples`, and `tests` directories belong to the AADP product and must be completed before starting the Ailmao integration.

## Rename Follow-ups (AIDP → AADP)

The protocol was renamed from "AI Data Discovery Protocol (AIDP)" to "AI Application Discovery Protocol (AADP)". The v0.1 wire contract is unchanged (`aidp_version` field, schema `$id` URLs under `https://aidp.dev/schemas/v0.1/`), so no consumer needs any code change today. Pending items, to be done only when the time comes:

- `ailmao-landing` still consumes the old package (`"aidp": "file:./vendor/aidp-0.1.0.tgz"`, `import ... from "aidp"`, adapter code under `lib/aidp/`). This keeps working as-is. When it upgrades to the next package release, switch the dependency to `aadp` (tarball `aadp-0.1.x.tgz`) and update the imports; renaming `lib/aidp/` is optional.
- v0.2 identifiers reference the `aadp.dev` domain (module schema URLs). Secure that domain, or adjust the URLs in `docs/MANIFEST_V0.2_DESIGN.md` and `docs/RELATIONS_MODULE_DESIGN.md`, before publishing v0.2.

## Integration Principles

AADP is designed, versioned, and tested independently of Ailmao. Do not introduce Ailmao-specific data types, URLs, or rules into the core specification. Only after AADP v0.1 is released will `ailmao-landing` implement an adapter that conforms to the standard and is validated by AADP's own conformance suite.

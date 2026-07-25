# AI Application Discovery Protocol (AADP)

AADP is an open protocol that helps AI discover and read structured data directly from applications or APIs.

The normative specifications are at [`spec/v0.1/specification.md`](spec/v0.1/specification.md) and [`spec/v1.0/specification.md`](spec/v1.0/specification.md); the plan to build AADP into a standalone product, and only later apply it experimentally to Ailmao, is at [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

The plan to build Answer Engine Optimization and Generative Engine Optimization into standard modules inside AADP is at [`docs/AEO_GEO_INTEGRATION_PLAN.md`](docs/AEO_GEO_INTEGRATION_PLAN.md).

The v1.0 manifest design, based on the application discovery document model, is at [`docs/MANIFEST_V1.0_DESIGN.md`](docs/MANIFEST_V1.0_DESIGN.md) (accepted as [ADR-0005](docs/adr/0005-manifest-v1-discovery.md)).

The typed relation and graph traversal design is at [`docs/RELATIONS_MODULE_DESIGN.md`](docs/RELATIONS_MODULE_DESIGN.md).

## v0.1 Scope

- Manifest at `/.well-known/ai-manifest.json`.
- Sitemap index and sitemaps by resource type.
- Read-only Entity API.
- JSON Schema, valid examples, and contract tests.
- A validator and conformance test suite usable by any application.
- A reference client demonstrating the discovery flow independently of Ailmao.
- `ailmao-landing` implements an adapter (`lib/aadp/`) consuming the `ail-aadp` package.

## v1.0 Scope

v1.0 replaces the v0.1 wire contract outright — there is no dual manifest,
content negotiation, or migration runtime from v0.1 (`docs/IMPLEMENTATION_PLAN.md`
§1). It is a new, independently versioned envelope:

- Application discovery document (`application`, `links`, `discovery`,
  `modules`, `resources`, `interfaces`, `security_schemes`, `policies`,
  `usage_guidance`) published at the same well-known URL.
- `discovery.sitemap_index` is the authoritative entry point for enumeration;
  `sitemap.items[].url` is the authoritative entity URL.
- Version-aware schema registry and validator (`validateDocument({ version,
  kind, data })`) — v0.1 and v1.0 schemas never silently fall back to each
  other.
- Pure semantic validator layered on top of schema validation: reference
  uniqueness/integrity, placeholder-URL and secret-shaped-value heuristics,
  and an advisory-only "looks like an instruction" check on `usage_guidance`
  that never blocks discovery and is never treated as executable by the
  reference client.
- A dedicated v1.0 reference client (`ail-aadp/client/v1.0`) with SSRF-aware
  URL policy, bounded response size/timeout/redirects, and schema+semantic
  validation gating every hop before its URLs are trusted for further
  traversal.
- A v1.0 conformance suite (`tests/conformance/v1.0/`), runnable against the
  bundled mock server or any external deployment via `AADP_BASE_URL`.

`import { discover, ... } from "ail-aadp/client"` (no version segment)
continues to resolve to the v0.1 client unchanged, for existing consumers.
New code should import from `ail-aadp/client/v1.0` explicitly, or use the
`v1` namespace re-exported from `ail-aadp/client`:

```ts
import { v1 } from "ail-aadp/client";

const manifest = await v1.discover("https://example.com");
if (manifest.aadp_version !== "1.0") {
  throw new v1.UnsupportedAadpVersionError(manifest.aadp_version);
}
```

Schemas are exported per version — `ail-aadp/schemas/v0.1/*` and
`ail-aadp/schemas/v1.0/*` — plus the pre-existing unversioned
`ail-aadp/schemas/*`, which continues to resolve to v0.1 unchanged so no
existing consumer is silently repointed to v1.0.

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

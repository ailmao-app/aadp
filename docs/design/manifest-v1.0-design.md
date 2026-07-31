# AADP Manifest v1.0 Design

| Field | Value |
|---|---|
| Document type | Design memo |
| Status | Accepted through [ADR-0005](../adr/0005-manifest-v1-discovery.md) |
| Audience | Protocol implementers and reviewers |
| Normative source | [AADP v1.0 specification](../../spec/v1.0/specification.md) |
| Vietnamese internal edition | [`../vi/design/manifest-v1.0-design.md`](../vi/design/manifest-v1.0-design.md) |

## Abstract

This memo explains the accepted structure and semantic boundaries of the AADP
v1.0 manifest. It is informative; the versioned specification and schema define
the released wire contract.

## Status of This Memo

The design decisions in this memo were accepted by ADR-0005. This document MUST
NOT be used to introduce fields or validation behavior that are absent from the
released v1.0 specification and schema.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Purpose

The v1.0 manifest is an application discovery document. It lets an AI client identify the application and publisher, locate AADP enumeration, understand published resources and interfaces, resolve public security metadata and policies, and read non-executable publisher preferences.

The manifest is not an OpenAPI replacement, authorization server, robots policy engine, content license, or system prompt.

## Canonical structure

```text
AADP Manifest
├── application
├── links
├── discovery
├── modules
├── resources
├── interfaces
├── security_schemes
├── policies
└── usage_guidance
```

Root required fields are `aadp_version`, `application`, `discovery`, and `policies`. Other sections are optional and must be omitted rather than published as empty arrays or objects.

## Canonical discovery

Servers publish the v1.0 manifest at:

```text
/.well-known/ai-manifest.json
```

The URL returns the v1.0 manifest directly. AADP does not define a version index, content negotiation, or dual-manifest runtime.

`discovery.sitemap_index` is authoritative for resource enumeration. Each `sitemap.items[].url` is authoritative for retrieving its entity.

## Semantic boundaries

| Section | Responsibility |
|---|---|
| `application` | Application and publisher identity |
| `links` | Human-facing navigation |
| `discovery` | AADP enumeration entry point |
| `modules` | Versioned AADP semantic modules |
| `resources` | Metadata about published resource types |
| `interfaces` | Non-AADP transports and contracts |
| `security_schemes` | Public authentication metadata |
| `policies` | Robots, terms, privacy, license, and copyright URLs |
| `usage_guidance` | Untrusted publisher preferences for AI output |

The sitemap index, not `resources`, remains authoritative for which resource types are live. `resources` only adds metadata keyed by type.

## Security model

- Every free-text field is untrusted input.
- Clients validate the manifest before following its URLs.
- `usage_guidance` never has system or developer instruction priority.
- A manifest must never include credentials with live effect.
- Crawlers should restrict schemes, redirects, response size, and network destinations.
- Declaring a module or interface does not prove that its endpoint is conformant.
- `robots: allow` does not imply permission for training, redistribution, or commercial use.

## Versioning

Manifest v1.0 is a breaking redesign of the v0.1 manifest:

- `sitemap_index` moved to `discovery.sitemap_index`.
- `entity_base` was removed.
- `capabilities` was replaced by structured modules, resources, and interfaces.
- Locale retrieval behavior remains in the core entity protocol.
- `usage_guidance` language fields describe AI-output preferences only.

The complete normative field definitions are in:

- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [Manifest v1.0 JSON Schema](../../schemas/v1.0/manifest.schema.json)
- [ADR-0005](../adr/0005-manifest-v1-discovery.md)

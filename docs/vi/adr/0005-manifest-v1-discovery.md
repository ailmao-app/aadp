# ADR-0005: Manifest v1.0 application discovery document and canonical discovery URL

> Ngôn ngữ: Tiếng Việt.

## Status

Accepted — AADP v1.0 (Phase 0 design gate closed)

## Context

AADP v0.1's manifest (`schemas/v0.1/manifest.schema.json`) is a minimal
protocol-envelope document: `aadp_version`, `default_locale`,
`available_locales`, `sitemap_index`, optional `entity_base` and
`capabilities`. It does not let an AI client answer application-level
questions before it starts reading data — who publishes this, what human
URLs exist, what non-AADP interfaces (REST/GraphQL/MCP) are available, what
auth they need, what policies apply, what the publisher's citation/summary
preference is.

`docs/IMPLEMENTATION_PLAN.md` §3 lists four design questions that block
writing the v1.0 JSON Schema:

1. Localization semantics — does `usage_guidance.default_language` also
   control retrieval, or is retrieval locale a separate concern?
2. Resource authority — is the sitemap index or `resources[]` the source
   of truth for which resource types exist?
3. Security metadata scope — minimal (`none` only) or full (`api_key`,
   `oauth2` with enough metadata for a client to act on)?
4. Root required-fields table — which top-level manifest fields are
   mandatory vs optional, and how is "omitted" distinguished from "empty"?

This ADR closes all four, plus extension-point and token-grammar
questions that follow directly from them, so Phase 1 (JSON Schema) has an
unambiguous contract to encode.

## Decision

### Canonical discovery

- Manifest v1.0 is an **application discovery document**: identity, human
  links, AADP discovery entry point, non-AADP interfaces, security
  metadata, policies, and untrusted publisher preference — not an OpenAPI
  replacement, authorization server, or system prompt.
- Canonical URL stays `/.well-known/ai-manifest.json`. It returns the
  v1.0 manifest directly (`aadp_version: "1.0"`); no version index, no
  content negotiation between v0.1/v1.0 at that URL, consistent with
  ADR-0004's existing versioning model and with the fact that AADP has no
  v0.1 production consumer to keep serving in parallel.
- `discovery.sitemap_index` remains the sole entry point for AADP
  enumeration; `sitemap.items[].url` remains the sole authoritative entity
  URL (both carried over unchanged from v0.1 §3.1/§3.3).

### 1. Localization (closes gate 3.1)

v1.0 does **not** add a `localization` object. Retrieval locale continues
to be governed exclusively by the existing core envelope mechanism (entity
`locale` field / query param, spec v0.1 §4), unchanged. `usage_guidance.
default_language` / `available_languages` is AI **output** preference only
— clients MUST NOT use it to select retrieval locale. This keeps one field
controlling exactly one concern, per the constraint in the implementation
plan ("Không dùng một field vừa điều khiển content negotiation vừa là
publisher preference").

### 2. Resource authority (closes gate 3.2)

Sitemap index is authoritative for which resource types are published and
their sitemap URL. `resources[]` in the manifest adds metadata only
(`media_types`, `security`) keyed by `type`; it has **no `sitemap` field**.
This removes the two-sources-of-truth risk the plan flagged. Cross-checking
`resources[].type` against the live sitemap index is an HTTP-dependent
check and therefore belongs to the conformance suite (Phase 5), not the
pure semantic validator (Phase 3), consistent with the existing
architecture boundary ("Validator không tự thực hiện HTTP request",
`IMPLEMENTATION_PLAN.md` §4).

### 3. Security metadata (closes gate 3.3)

v1.0 takes the full option: three security scheme types, each with the
minimum metadata a client needs to act on it, none of which is a working
credential:

| `type` | Required fields |
|---|---|
| `none` | — |
| `api_key` | `in` (`"header"` \| `"query"`), `name` |
| `oauth2` | `authorization_url` (`token_url`, `scopes` optional) |

`security_schemes` is a discriminated union on `type`. A server MUST NOT
advertise `api_key`/`oauth2` without the required fields for that type —
Phase 1 schema enforces this structurally (`oneOf`/`if-then`), not just by
documentation convention.

### 4. Root required fields (closes gate 3.4)

Required at root: `aadp_version`, `application`, `discovery`, `policies`.
Optional: `links`, `modules`, `resources`, `interfaces`,
`security_schemes`, `usage_guidance`. `security_schemes` becomes
conditionally required whenever any `resources[].security` or
`interfaces[].security` references a scheme ID — enforced by the semantic
validator (Phase 3), since JSON Schema alone cannot express "required if
referenced elsewhere" cleanly across sibling arrays.

**Omitted vs empty**: every top-level array (`resources`, `modules`,
`interfaces`) and the `security_schemes` object MUST be omitted entirely
when there is nothing to publish — publishing `[]` or `{}` is not
equivalent to omission and MUST NOT be used. This avoids needing a parallel
`*_declared` boolean per section to disambiguate "nothing here" from
"section not applicable to this deployment."

Full field table and per-object required/optional breakdown live in
`MANIFEST_V1.0_DESIGN.md` §3a.4 and §5.

### Extension points

Unchanged in spirit from ADR-0003: `^x_[a-zA-Z0-9_]*$` fields are permitted
on every object the manifest defines (root, `application`,
`application.publisher`, each `modules[]`/`resources[]`/`interfaces[]`
entry, each `security_schemes` entry, `policies`, `usage_guidance`,
`usage_guidance.attribution`), each object otherwise closed
(`additionalProperties: false`). This is the only sanctioned mechanism for
vendor-specific manifest data in v1.0, same as v0.1.

### Token grammar

`modules[].id` is `namespace:name` (`^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$`);
the `aadp` namespace is reserved for modules this spec defines.
`resources[].type`, `interfaces[].id`, and `security_schemes` keys all use
the single-segment grammar `^[a-z][a-z0-9_-]*$` — the same grammar as a
canonical-ID segment in the v0.1 core envelope (spec §2), reused rather
than inventing a new token class, and chosen so `resources[].type` can be
compared directly against the `type` segment of a `{type}:{id}` canonical
ID without translation.

### HTTP behavior

`Content-Type: application/json`, same as v0.1. Server SHOULD set
`Cache-Control` (recommended `max-age=300`); manifest v1.0 carries forward
v0.1's decision (ADR-0002) that the manifest itself is not required to
have a checksum-backed `ETag`, since it stays a small, near-static
discovery document. Server SHOULD keep the manifest under 64 KiB;
reference client (Phase 4) MUST reject/refuse to parse any manifest
response over **256 KiB**, as a hard client-side protection against
oversized or malicious responses — this is a client-side ceiling, not a
server-side size recommendation.

## Consequences

- Phase 1 (JSON Schema) has a closed, unambiguous root-field and
  per-object contract to encode directly — no schema decisions are
  deferred to schema-authoring time.
- Semantic validator (Phase 3) inherits two concrete conditional rules
  from this ADR: `security_schemes` presence gated on cross-references,
  and `default_language` staying disjoint from retrieval locale (i.e.
  nothing to validate there beyond `default_language` membership in
  `available_languages`, since it no longer touches retrieval).
- Reference client (Phase 4) inherits one concrete numeric ceiling (256
  KiB) it did not have before this ADR.
- Because `resources[].sitemap` never ships, any future need to
  special-case a resource type's sitemap URL requires a new,
  explicitly-named field and a minor-version bump under ADR-0004 — not a
  reinterpretation of an existing field.
- This ADR does not itself define the JSON Schema files; Phase 1
  (`AADP-V1-003`) implements the contract described here.

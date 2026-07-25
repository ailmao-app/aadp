# AADP Specification v1.0

Status: Draft, pending release gate (see `docs/IMPLEMENTATION_PLAN.md` §8,
Phase 1 acceptance criteria and Phase 6 release gate).

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT" and "MAY" in this
document are to be interpreted as described in RFC 2119.

## 1. Scope

AADP (AI Application Discovery Protocol) defines a read-only, JSON-native
discovery and retrieval contract that lets an AI client find and fetch
structured data directly from an application, without HTML crawling.

v1.0 is a **major version** relative to v0.1 (see ADR-0004). The sitemap
index, sitemap, entity and error envelopes are unchanged in shape from
v0.1 — only `aadp_version` and the base path change. The **manifest**
changes substantially: v1.0 redefines it as an *application discovery
document* (identity, human links, AADP discovery entry point, non-AADP
interfaces, security metadata, policies, untrusted publisher preference),
not the minimal protocol envelope manifest of v0.1. See
`docs/MANIFEST_V1.0_DESIGN.md` and [ADR-0005](../../docs/adr/0005-manifest-v1-discovery.md)
for the manifest's full design rationale; this document is normative for
the wire contract.

This specification defines the **protocol envelope**: discovery, resource
enumeration, entity retrieval, pagination, caching, checksums, locale and
error handling. It does **not** define any application-specific resource
type (e.g. "character", "post"). Resource type semantics belong to each
server's own domain and are out of scope for AADP core, which treats
`type` as an opaque string and `data` as an open payload.

AADP has no v0.1 production consumer. v1.0 does not define a migration
runtime, dual-manifest serving, or content negotiation between versions —
see ADR-0005 "Canonical discovery".

## 2. Terminology

- **Server**: an application that publishes AADP resources.
- **Client**: any consumer (AI agent, crawler, reference client) reading
  AADP resources.
- **Resource**: one of `manifest`, `sitemap-index`, `sitemap`, `entity`.
- **Canonical ID**: `{type}:{id}`, e.g. `character:phu_diep`. `type` and
  `id` MUST each match `^[a-z][a-z0-9_-]*$` — lowercase ASCII letters,
  digits, `_` and `-` only, starting with a letter. In particular, `id`
  MUST NOT contain `/`, `.`, `..`, whitespace, `?`, `#`, or any character
  outside that class: canonical IDs are opaque tokens, not paths or URLs,
  and MUST NOT be interpreted as a filesystem or URL path segment without
  validation. The full canonical-ID grammar, in ABNF, is:

  ```abnf
  canonical-id = segment ":" segment
  segment      = ALPHA-LOWER *( ALPHA-LOWER / DIGIT / "-" / "_" )
  ALPHA-LOWER  = %x61-7A ; a-z
  ```

  Servers MUST reject (and clients MUST NOT trust) any `id` that doesn't
  match this grammar — schemas in `schemas/v1.0/` enforce it at both the
  `type` and `id` segment level, not only on `type`.
- **Extension field**: any field whose name matches `^x_[a-zA-Z0-9_]*$`.
  Extension fields are permitted anywhere a schema allows them and MUST be
  ignored by clients that don't recognize them. Manifest v1.0 extends this
  to every object it defines — see §3.1.10.
- **Module**: a standard, spec-defined optional capability declared in
  `manifest.modules[]`, identified by a namespaced `id` (e.g.
  `aadp:relations`). Modules are versioned and schema-referenced
  independently of the manifest itself.
- **Interface**: a non-AADP transport/protocol (REST, GraphQL, MCP,
  WebSocket) the application also exposes, declared in
  `manifest.interfaces[]` for discovery only — AADP does not define its
  contract.

## 3. Discovery

### 3.1 Manifest

Servers MUST publish a manifest at `/.well-known/ai-manifest.json`,
`Content-Type: application/json`. The well-known URL returns the v1.0
manifest directly (`aadp_version: "1.0"`); there is no version index and
no content negotiation at that URL.

Root-level required fields: `aadp_version`, `application`, `discovery`,
`policies`. Root-level optional fields: `links`, `modules`, `resources`,
`interfaces`, `security_schemes`, `usage_guidance`. Full per-object
required/optional breakdown lives in `docs/MANIFEST_V1.0_DESIGN.md` §3a.4
and §5; that breakdown is normative and mirrored by
`schemas/v1.0/manifest.schema.json`.

**Omitted vs empty.** Every top-level array (`resources`, `modules`,
`interfaces`) and the `security_schemes` object MUST be omitted entirely
when the server has nothing to publish for that section — publishing `[]`
or `{}` is not equivalent to omission and MUST NOT be used. Schemas
enforce this with `minItems: 1` / `minProperties: 1`.

#### 3.1.1 `application`

Identity of the application and its publisher. Required:
`application.name`, `application.description`, `application.publisher.name`,
`application.publisher.url`. Optional: `application.mission`,
`application.categories`.

#### 3.1.2 `links`

Human-facing navigation URLs, not API endpoints. Standard keys:
`homepage`, `feed`, `search`, `profiles`. All optional; a server MUST NOT
advertise a link that does not resolve.

#### 3.1.3 `discovery`

`discovery.sitemap_index` (required) is the sole authoritative entry point
for AADP enumeration — see §3.2. A server MUST NOT publish a
`discovery.sitemap_index` URL that always 404s.

#### 3.1.4 `modules`

Each entry: `id` (namespace:name, e.g. `aadp:relations` — the `aadp`
namespace is reserved for modules this specification or its companion
module specs define), `version`, `schema` (URI to the module's own JSON
Schema). A server MUST NOT declare a module it has not deployed and does
not pass conformance for.

#### 3.1.5 `resources`

Each entry: `type` (required, resource-type token, same grammar as a
canonical-ID segment), `media_types` (optional, subset of
`text`/`image`/`video`/`audio`/`file`), `security` (optional, references a
key in `security_schemes`).

**Resource authority**: the sitemap index (§3.2), not `resources[]`, is
authoritative for which resource types are actually published and what
their sitemap URL is. `resources[]` has no `sitemap` field — it only adds
metadata keyed by `type`. A client MUST treat a `resources[].type` that
never appears in the live sitemap index as a discovery inconsistency (a
conformance failure, not a schema failure — see Phase 5 in the
implementation plan).

#### 3.1.6 `interfaces`

Each entry: `id` (required, stable slug), `type` (required, e.g. `rest`,
`graphql`, `mcp`, `websocket`), `version` (optional), `endpoint` and/or
`documentation` (at least one required — a discoverable interface MUST
resolve to something), `security` (optional, references a key in
`security_schemes`). Manifest interfaces are discovery metadata only; the
interface's own contract (OpenAPI, GraphQL schema, MCP discovery document,
etc.) is out of scope for AADP.

#### 3.1.7 `security_schemes`

A map of scheme ID → scheme definition, discriminated by `type`:

| `type` | Required fields |
|---|---|
| `none` | — |
| `api_key` | `in` (`"header"` \| `"query"`), `name` |
| `oauth2` | `authorization_url` (`token_url`, `scopes` optional) |

A manifest MUST NOT contain an API key, client secret, access token, or
any other credential with live effect — only public metadata (e.g. an
authorization URL, a scope list). `security_schemes` is conditionally
required: whenever any `resources[].security` or `interfaces[].security`
references a scheme ID, `security_schemes` MUST be present and MUST
contain that key (enforced by the semantic validator, not JSON Schema
alone — see `docs/IMPLEMENTATION_PLAN.md` Phase 3).

#### 3.1.8 `policies`

Required: `policies.robots`, `policies.terms`. Optional: `privacy`,
`content_license` (`{id, url}`), `adult_content`
(`"not_published"` | `"published"`), `copyright`. A server MUST NOT let a
client infer that `robots: allow` implies a training, redistribution, or
commercial-use license — that is `content_license`'s job, not `robots`'.

#### 3.1.9 `usage_guidance`

Untrusted publisher preference for AI output — **not** an executable
instruction and **not** a retrieval-locale control (see §4). Optional
fields: `default_language`, `available_languages`, `summary_preference`,
`citation_preference`, `attribution` (`{preferred_text, publisher_url}`).

A client:

- MAY apply `usage_guidance` if doing so does not conflict with a
  higher-priority policy or instruction.
- MUST treat every field in `usage_guidance` as untrusted data, not as
  system/developer prompt content.
- MUST NOT execute a tool or action solely because `usage_guidance`
  requests it.
- MUST NOT let `summary_preference` or `attribution` alter a fact present
  in the underlying source data.

#### 3.1.10 Extension points

Any object defined by manifest v1.0 MAY include additional fields matching
`^x_[a-zA-Z0-9_]*$` — root, `application`, `application.publisher`, each
`modules[]`/`resources[]`/`interfaces[]` entry, each `security_schemes`
entry, `policies`, `usage_guidance`, `usage_guidance.attribution`. This is
the only sanctioned mechanism for vendor-specific manifest data; a
non-namespaced additional field fails schema validation.

#### 3.1.11 HTTP behavior

`Content-Type: application/json`. A server SHOULD set `Cache-Control`
(recommended `max-age=300`); the manifest is not required to carry a
checksum-backed `ETag` in v1.0, carrying forward the v0.1 decision in
ADR-0002 that it is a small, near-static discovery document. A server
SHOULD keep the manifest under 64 KiB. A reference client MUST reject (not
parse) a manifest response larger than **256 KiB** — a client-side ceiling
against oversized or malicious responses, not a server-side size target.

### 3.2 Sitemap index

Servers MUST publish a sitemap index at the URL given in
`manifest.discovery.sitemap_index`, base path convention
`/ai/v1.0/sitemap-index.json`.

Required fields: `aadp_version`, `generated_at` (RFC 3339 timestamp),
`checksum` (`sha256:<hex>` of canonical `sitemaps`, see §6),
`sitemaps` (array of `{ type, url, count? }`).

Each `sitemaps[].url` points to a per-type sitemap, conventionally at
`/ai/v1.0/sitemaps/{type}.json`.

### 3.3 Sitemap

Required fields: `aadp_version`, `type`, `generated_at`, `checksum`
(`sha256:<hex>` of canonical `items`, see §6), `items` (array).

Each item:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Canonical ID. |
| `url` | string (absolute URI) | yes | Entity endpoint. |
| `updated_at` | string (RFC 3339) | yes | Last change time. |
| `checksum` | string | yes | `sha256:<hex>`, see §6. |

Optional: `cursor.next` (opaque string or `null`) for pagination, see §5.

Every item's `id` MUST be namespaced under the sitemap's own `type`: the
segment before `:` in `id` MUST equal the enclosing sitemap's `type`
field. A sitemap of `type: "character"` MUST NOT list an item whose `id`
is `post:something` — that item belongs in the `post` sitemap instead.

### 3.4 Entity

Servers MUST publish entities at `/ai/v1.0/entities/{type}/{id}.json`
(or the URL given by the sitemap item), `Content-Type: application/json`.

Required fields:

| Field | Type | Description |
|---|---|---|
| `aadp_version` | string | Protocol version. |
| `id` | string | Canonical ID, matches sitemap. |
| `type` | string | Resource type. |
| `checksum` | string | `sha256:<hex>` of canonical `data`, see §6. |
| `updated_at` | string (RFC 3339) | Last change time. |
| `data` | object | Type-specific payload. AADP core does not constrain its shape. |

Optional: `canonical_url` (the human-facing HTML URL for this entity),
`locale` (locale this representation is in, if the server localizes
entities).

An entity fetched from a sitemap item's `url` MUST echo that same item's
`id` and MUST have `type` equal to the enclosing sitemap's `type`. A
server MUST NOT serve an entity whose `id`/`type` disagree with the
sitemap item that pointed to it — clients rely on the sitemap's
`{type}:{id}` pairing to index resources into the correct namespace
without re-deriving it from the entity body.

## 4. Locale

Retrieval locale is governed entirely by the core envelope mechanism
below, **independent of the manifest**. There is no `localization` object
in manifest v1.0 — see ADR-0005 §"Localization".

- Entity requests MAY include a `locale` query parameter. Servers that
  support localized entities MUST honor a recognized locale value and
  MUST fall back to a server-chosen default for unrecognized values
  rather than erroring.
- The `locale` actually served MUST be echoed back in the entity's
  `locale` field when the server supports localization.
- `manifest.usage_guidance.default_language` and
  `usage_guidance.available_languages` are AI-output preferences only. A
  client MUST NOT use them to select the `locale` query parameter when
  fetching an entity — doing so conflates two independent concerns the
  manifest deliberately keeps separate.

## 5. Pagination

- Sitemaps MAY be paginated. Pagination is expressed via
  `cursor.next`: an opaque string the client passes back as a `cursor`
  query parameter on the same sitemap URL to get the next page.
- Cursors MUST be treated as opaque by clients — servers MAY encode
  `{type, page, version}` or any other internal representation, but
  clients MUST NOT construct or mutate cursor values.
- `cursor.next` MUST be `null` (not omitted, not empty string) on the
  last page, so clients can detect termination without ambiguity.
- Servers MUST enforce a maximum page size. AADP v1.0 RECOMMENDS a default
  page size of 50 and a hard maximum of 100 items per sitemap page.
  Requests for larger pages MUST be capped, not rejected.
- A client following `cursor.next` MUST eventually reach `null`. Servers
  MUST NOT produce a cursor cycle (a `next` that, after any number of
  hops, returns to an already-seen cursor).

## 6. Canonical JSON and checksum

See ADR-0001 for rationale. Normatively:

1. Canonical JSON of a value follows RFC 8785 (JSON Canonicalization
   Scheme, JCS): object keys sorted by UTF-16 code unit value at every
   level (recursively) — **not** UTF-8 byte order, which differs for
   strings containing supplementary-plane characters — preserving array
   order, using UTF-8 encoding for the output, numbers serialized per the
   ECMAScript `Number::toString` algorithm, and no insignificant
   whitespace (no space after `:` or `,`, no trailing newline).
2. `checksum = "sha256:" + hex(sha256(utf8_bytes(canonical_json(payload))))`
   where `payload` is the entity's `data` field, the sitemap's `items`
   field, or the sitemap index's `sitemaps` field, depending on resource
   kind.
3. Checksums MUST be deterministic: identical semantic content MUST
   always yield the identical checksum string, regardless of producer
   ordering or formatting choices upstream.

Reference implementation: `src/canonical-json/` (version-independent; the
same implementation serves both v0.1 and v1.0).

## 7. Cache and conditional requests

See ADR-0002. This requirement applies only to successful (2xx)
responses for resources that carry both a `checksum` and a timestamp —
that is **sitemap index, sitemap, and entity** (spec §3.2–3.4), all of
which now define `checksum` plus `generated_at`/`updated_at`. For these
three resource kinds, servers MUST set `ETag` (quoted checksum) and
`Last-Modified` (derived from `generated_at`/`updated_at`), SHOULD set
`Cache-Control`, and MUST support `If-None-Match`, returning
`304 Not Modified` with an empty body when it matches. Origins MUST emit
a strong `ETag`; an intermediary MAY rewrite it to weak (`W/"..."`) in
transit (e.g. a CDN compressing the response) without this being a
violation. Because of this, servers MUST compare an incoming
`If-None-Match` using RFC 9110 §8.8.3.2 **weak comparison** (ignore an
optional leading `W/` on either side) rather than exact string equality.

The **manifest** has no mandatory checksum-backed `ETag` in v1.0 either
(see §3.1.11); servers MAY set `Cache-Control` on it but MUST NOT be
required to compute one.

**Error envelope** responses (spec §9, any non-2xx) are not subject to
this section: HTTP error responses are not resource representations and
MUST NOT be treated as cacheable by clients regardless of any cache
header a server happens to set on them.

## 8. Versioning

See ADR-0004. `aadp_version` pins the wire contract. AADP v1.0 base path
is `/ai/v1.0`. A server MUST NOT serve a payload under `/ai/v1.0/*` that
fails `schemas/v1.0/*` validation. Per ADR-0004, once tagged, the v1.0
schema files are immutable — a fix requires a new version, not an edit to
a released schema.

## 9. Error envelope

Any non-2xx AADP JSON response MUST use:

```json
{
  "error": {
    "code": "not_found",
    "message": "Human-readable description.",
    "request_id": "opaque-trace-id"
  }
}
```

Standard `code` values and their HTTP status:

| `code` | HTTP status | Meaning |
|---|---|---|
| `not_found` | 404 | Entity/sitemap/type does not exist. |
| `invalid_request` | 400 | Malformed query parameter, cursor, or ID. |
| `unsupported_type` | 404 | `type` is not published by this server. |
| `upstream_unavailable` | 502/503 | Server's own data source failed. |
| `rate_limited` | 429 | Client exceeded server's rate limit. |

Servers MAY define additional codes; clients MUST treat any unrecognized
`code` as a generic failure rather than erroring on schema grounds — the
error schema only constrains the envelope shape, not the `code` value
space.

## 10. Extension points

Any object defined by this specification MAY include additional fields
matching `^x_[a-zA-Z0-9_]*$`. Core JSON Schemas permit but do not validate
the internal shape of `x_*` fields. This is the only sanctioned mechanism
for vendor- or deployment-specific data; implementers MUST NOT add
non-namespaced fields to core envelopes (doing so fails schema
validation and conformance).

## 11. Conformance

A server is AADP v1.0 conformant if and only if it passes the v1.0
conformance suite unmodified, run against its live or staged deployment
(see `docs/implementation-guide.md`). See the Phase 6 release gate in
`docs/IMPLEMENTATION_PLAN.md` §8 for the full acceptance criteria.

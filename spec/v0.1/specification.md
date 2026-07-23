# AADP Specification v0.1

Status: Draft, pending release gate (see `docs/IMPLEMENTATION_PLAN.md` §8,
Phase A3).

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT" and "MAY" in this
document are to be interpreted as described in RFC 2119.

## 1. Scope

AADP (AI Application Discovery Protocol) defines a read-only, JSON-native
discovery and retrieval contract that lets an AI client find and fetch
structured data directly from an application, without HTML crawling.

> **Naming note.** AADP was formerly named "AI Data Discovery Protocol
> (AADP)". The v0.1 wire contract predates the rename, so the
> `aadp_version` field and the published v0.1 schema `$id` URLs under
> `https://aadp.dev/schemas/v0.1/` keep the `aadp` prefix and MUST NOT be
> changed within `0.1.x`. Renamed wire identifiers (`aadp_version`,
> `aadp:*` module IDs) apply from v0.2.

This specification defines the **protocol envelope**: discovery, resource
enumeration, entity retrieval, pagination, caching, checksums, locale and
error handling. It does **not** define any application-specific resource
type (e.g. "character", "post"). Resource type semantics belong to each
server's own domain and are out of scope for AADP core, which treats
`type` as an opaque string and `data` as an open payload.

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
  match this grammar — schemas in `schemas/v0.1/` enforce it at both the
  `type` and `id` segment level, not only on `type`.
- **Extension field**: any field whose name matches `^x_[a-zA-Z0-9_]*$`.
  Extension fields are permitted anywhere a schema allows them and MUST be
  ignored by clients that don't recognize them.

## 3. Discovery

### 3.1 Manifest

Servers MUST publish a manifest at `/.well-known/ai-manifest.json`,
`Content-Type: application/json`.

Required fields:

| Field | Type | Description |
|---|---|---|
| `aadp_version` | string | Protocol version, e.g. `"0.1"`. |
| `default_locale` | string | BCP-47-ish locale tag, e.g. `"vi"`. |
| `available_locales` | string[] | Non-empty list including `default_locale`. |
| `sitemap_index` | string (absolute URI) | URL of the sitemap index. |

Optional fields: `entity_base`, `capabilities` (string[], see ADR-0003),
and any `x_*` extension field.

`entity_base`, when present, is a **URI construction prefix, not a
dereferenceable endpoint**. A client that already has a canonical ID
`{type}:{id}` (e.g. resolved from a `canonical_url` elsewhere, or cached
from a previous crawl) MAY construct that entity's URL as
`{entity_base}/{type}/{id}.json`, without walking the sitemap first.
`GET` on `entity_base` by itself (with no `{type}/{id}.json` suffix) is
**undefined behavior** — servers MAY 404, MAY redirect, or MAY return
anything; clients MUST NOT treat a bare-`entity_base` response as
meaningful, and MUST NOT infer server health or protocol conformance
from it. The authoritative, guaranteed-dereferenceable entity URL for
any given item is always `sitemap.items[].url` (§3.3) — `entity_base` is
purely a convenience shortcut for clients that want to skip re-crawling
the sitemap for an ID they already know, and servers that don't want to
offer that shortcut MAY omit the field entirely.

### 3.2 Sitemap index

Servers MUST publish a sitemap index at the URL given in
`manifest.sitemap_index`, base path convention `/ai/v0.1/sitemap-index.json`.

Required fields: `aadp_version`, `generated_at` (RFC 3339 timestamp),
`checksum` (`sha256:<hex>` of canonical `sitemaps`, see §6),
`sitemaps` (array of `{ type, url, count? }`).

Each `sitemaps[].url` points to a per-type sitemap, conventionally at
`/ai/v0.1/sitemaps/{type}.json`.

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

Servers MUST publish entities at `/ai/v0.1/entities/{type}/{id}.json`
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

- `manifest.default_locale` and `manifest.available_locales` declare what
  the server supports.
- Entity requests MAY include a `locale` query parameter. Servers that
  support localized entities MUST honor a recognized locale value and
  MUST fall back to `default_locale` for unrecognized values rather than
  erroring.
- The `locale` actually served MUST be echoed back in the entity's
  `locale` field when the server supports localization.

## 5. Pagination

- Sitemaps MAY be paginated. Pagination is expressed via
  `cursor.next`: an opaque string the client passes back as a `cursor`
  query parameter on the same sitemap URL to get the next page.
- Cursors MUST be treated as opaque by clients — servers MAY encode
  `{type, page, version}` or any other internal representation, but
  clients MUST NOT construct or mutate cursor values.
- `cursor.next` MUST be `null` (not omitted, not empty string) on the
  last page, so clients can detect termination without ambiguity.
- Servers MUST enforce a maximum page size. AADP v0.1 RECOMMENDS a default
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

Reference implementation: `src/canonical-json/`.

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
optional leading `W/` on either side) rather than exact string equality
— a server that only matches strong-to-strong will silently fail to
return `304` for any client whose request went through a compressing
intermediary, which in practice is most of them. See ADR-0002 for the
production incident this was found from.

The **manifest** has no checksum or per-request timestamp in v0.1 (it is
a small, near-static discovery document); servers MAY set `Cache-Control`
on it but MUST NOT be required to compute a checksum-backed `ETag` for
it. A future minor version MAY add manifest cache validators as an
additive change (see ADR-0004).

**Error envelope** responses (spec §9, any non-2xx) are not subject to
this section: HTTP error responses are not resource representations and
MUST NOT be treated as cacheable by clients regardless of any cache
header a server happens to set on them.

## 8. Versioning

See ADR-0004. `aadp_version` pins the wire contract. AADP v0.1 base path
is `/ai/v0.1`. A server MUST NOT serve a payload under `/ai/v0.1/*` that
fails `schemas/v0.1/*` validation.

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

A server is AADP v0.1 conformant if and only if it passes
`tests/conformance/conformance.test.ts` unmodified, run against its live
or staged deployment via `AADP_BASE_URL=<origin> npx vitest run
tests/conformance/conformance.test.ts` (see `docs/implementation-guide.md`).
That file asserts only invariants that hold for any conformant server —
it does not assume this repo's own fixture dataset. See the Phase A3
release gate in `docs/IMPLEMENTATION_PLAN.md` §8 for the full acceptance
criteria.

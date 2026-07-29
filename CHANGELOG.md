# Changelog

All notable changes to `ail-aadp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Protocol compatibility follows [ADR-0004](docs/adr/0004-backward-compatibility.md); released schemas are immutable and wire-breaking changes require a new protocol version.

## 1.0.6 - 2026-07-29

### Added

- Added a `LICENSE` file (MIT) and included it in the published tarball.
- Added a GitHub Actions CI workflow that runs `npm ci`, build, test, `npm audit --omit=dev`, and `npm pack --dry-run` on every push and pull request.
- Added `InvalidOptionError`, thrown by `fetchJson`/`probeUrl` when `timeoutMs`, `maxRedirects`, or `maxResponseBytes` is non-finite or out of range, before any request is made.

## 1.0.5 - 2026-07-28

### Added

- Added a declarative server runtime at `ail-aadp/server`: `defineAADP()`/`defineResource()` build and serve the manifest, sitemap index, sitemap, and entity documents from application-supplied `list`/`get`/`serialize` callbacks — `list`/`get` may call a database, an internal HTTP API, or anything else, and `serialize()` is the one mandatory boundary between a raw record and the published document. `handleRequest` is a plain `(Request) => Promise<Response>`, usable directly as a Next.js route handler with no adapter.
- The runtime validates the manifest (schema + semantic rules) at `defineAADP()` time, computes checksums and sets `ETag`/`Last-Modified`/`Cache-Control` (honoring `If-None-Match` with `304`) on every sitemap/entity response, and wraps pagination cursors so one resource type's cursor is rejected if replayed against another type or protocol version.
- A resource's `security` field is advertised in the manifest but is metadata only — `defineAADP()` never checks credentials itself. `list`/`get` receive the inbound `request` and must enforce their own declared scheme, throwing the new `unauthorized()`/`forbidden()` errors to reject it. A resource with `security` set gets `Cache-Control: private, no-store` automatically, so an authorized response is never served to a different caller from a shared cache.
- Added the `aadp` binary (`npx aadp init`, `npx aadp add-resource <type>`) and `ail-aadp/scaffold` to scaffold a starter `defineAADP()` config and resource file. By default both commands refuse to overwrite an existing file; `--force` overwrites the exact target. Neither command ever parses or merges an existing config.
- Added a standalone conformance runner at `ail-aadp/conformance`: `runConformance(...)` executes the AADP v1.0 checks against a live deployment and returns a structured report, with no test framework and no repository fixtures involved.
- Added the `aadp-conformance` binary (`npx aadp-conformance https://example.com`) with a text report, a `--json` report for CI, `--output` to a file, and stable exit codes (`0` conformant, `1` failed check, `2` run could not be performed, `3` protocol version mismatch, `4` run left unfinished).
- Added traversal controls to the runner and CLI: protocol version, request timeout, redirect and response-size caps, sitemap page/entity/sitemap-count budgets, and a wall-clock deadline. Every document fetch is charged to one shared budget, and a run a budget cut short is reported `inconclusive` with exit code `4` — never as a pass.
- Added `negativeTargets` (`--unknown-entity-url`, `--unknown-type-url`) for the error-envelope checks. AADP defines no routing template, so the runner never constructs a URL it believes does not exist — a content-addressed, signed or gateway-served URL would make it fail a conformant deployment. Without these the two checks report `inconclusive`; with them, a successful response is a failure.
- Added option validation to `runConformance`: non-finite, non-integer or out-of-range budgets, timeouts and limits now throw `InvalidConformanceOptionsError` (CLI exit `2`) before any request, instead of surfacing as a failing check blamed on the deployment. The CLI defers range checking to the runner so both enforce identical bounds.
- Added `probeUrl` to the client transport for liveness-checking URLs a manifest advertises, under the same URL policy, timeout, redirect and size limits as `fetchJson`.
- Added a clean-install test that packs the real tarball, unpacks it elsewhere, and runs the packed CLI against a live server.
- Added header scoping to the runner: headers the caller configures reach the target origin only, and a URL a document points at another host receives them only when explicitly allow-listed through `crossOriginSafeHeaders` — a manifest cannot make the runner forward an API key to a third party.
- Added both validator forms to the conditional-GET checks. Spec v1.0 §7 mandates weak comparison, so `"checksum"` and `W/"checksum"` are both sent; a server that only honours the exact tag it emitted now fails.

### Changed

- `fetchJson` now also returns the final response `headers`, the `bodyBytes` actually read, and the final `url` after redirects, so callers can verify HTTP-level behaviour without a second unchecked `fetch`. A `304` response now has its (required-empty) body read under the size cap instead of being discarded unread.

## 1.0.2 - 2026-07-26

### Changed

- Yêu cầu Node.js 20.18.1 trở lên để tương thích với transport HTTP đã được tăng cường bảo mật.

## 1.0.1 - 2026-07-25

### Changed

- Reworked the README around installation, client usage, validation, server implementation, conformance, versioning, and security.
- Moved Vietnamese design documents under `docs/vi/` and kept public documentation paths in English.
- Normalized the `aadp-validate` binary path in `package.json` for npm publishing.

## 1.0.0 - 2026-07-25

### Added

- Added the normative AADP v1.0 specification and JSON Schemas for manifests, sitemap indexes, sitemaps, entities, and error envelopes.
- Added the application discovery manifest with application identity, human-facing links, resources, interfaces, security schemes, policies, and untrusted publisher preferences.
- Added a version-aware schema registry through `validateDocument({ version, kind, data })`.
- Added semantic manifest validation for reference integrity, uniqueness, language membership, placeholder URLs, secret-shaped values, and instruction-like text.
- Added the versioned v1.0 reference client at `ail-aadp/client/v1.0`.
- Added bounded HTTP fetching with timeout, redirect, response-size, and SSRF-aware URL policies.
- Added a v1.0 conformance suite that can run against the bundled mock server or an external deployment through `AADP_BASE_URL`.
- Added versioned client and schema exports for v0.1 and v1.0.

### Changed

- Redefined the manifest as an application discovery document.
- Moved the sitemap index URL from `sitemap_index` to `discovery.sitemap_index`.
- Replaced the v0.1 locale fields with AI-output preferences under `usage_guidance`; entity retrieval locale remains part of the core entity request behavior.
- Replaced the open `capabilities` list with structured `modules`, `resources`, and `interfaces`.
- Removed `entity_base`; sitemap item URLs are authoritative for entity retrieval.
- Changed the conventional protocol base path from `/ai/v0.1` to `/ai/v1.0`.

### Security

- Manifest free-text fields are treated as untrusted data and are never executable instructions.
- The v1.0 client validates each document before following URLs discovered within it.
- Strict URL policy blocks private, loopback, and link-local destinations by default.

### Breaking changes

- AADP v1.0 is a new wire contract and is not schema-compatible with the v0.1 manifest.
- The well-known URL returns the v1.0 manifest directly; AADP does not define dual-manifest serving or version negotiation.
- New integrations must import `ail-aadp/client/v1.0` or use the `v1` namespace from `ail-aadp/client`.
- The unversioned `ail-aadp/client` and `ail-aadp/schemas/*` exports remain pinned to v0.1 for existing consumers.

## 0.1.0 - 2026-07-23

### Added

- Added the initial AADP protocol envelope for manifest, sitemap index, sitemap, entity, and error documents.
- Added JSON Schema Draft 2020-12 schemas and positive and negative fixtures.
- Added RFC 8785 canonical JSON serialization and SHA-256 checksum utilities.
- Added the schema validator library and `aadp-validate` CLI.
- Added the initial reference client for manifest-to-entity discovery.
- Added mock-server conformance tests covering status codes, cache headers, checksum stability, and pagination.
- Added architecture decisions for checksums, cache semantics, capability discovery, and compatibility.

### Changed

- Renamed the project from AI Data Discovery Protocol to AI Application Discovery Protocol before the first public release.
- Standardized the wire field as `aadp_version`, the package as `ail-aadp`, the CLI as `aadp-validate`, and the conformance environment variable as `AADP_BASE_URL`.

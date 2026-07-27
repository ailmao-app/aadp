# Changelog

All notable changes to `ail-aadp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Protocol compatibility follows [ADR-0004](docs/adr/0004-backward-compatibility.md); released schemas are immutable and wire-breaking changes require a new protocol version.

## Unreleased

### Added

- Added a standalone conformance runner at `ail-aadp/conformance`: `runConformance(...)` executes the AADP v1.0 checks against a live deployment and returns a structured report, with no test framework and no repository fixtures involved.
- Added the `aadp-conformance` binary (`npx aadp-conformance https://example.com`) with a text report, a `--json` report for CI, `--output` to a file, and stable exit codes (`0` conformant, `1` failed check, `2` run could not be performed, `3` protocol version mismatch).
- Added traversal controls to the runner and CLI: protocol version, request timeout, redirect and response-size caps, sitemap page/entity/sitemap-count budgets, and a wall-clock deadline. A run stopped by a budget is reported as `skipped`, never as a pass.
- Added `probeUrl` to the client transport for liveness-checking URLs a manifest advertises, under the same URL policy, timeout, redirect and size limits as `fetchJson`.
- Added a clean-install test that packs the real tarball, unpacks it elsewhere, and runs the packed CLI against a live server.

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

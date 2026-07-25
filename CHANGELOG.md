# Changelog

All notable changes to `ail-aadp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Protocol compatibility follows [ADR-0004](docs/adr/0004-backward-compatibility.md); released schemas are immutable and wire-breaking changes require a new protocol version.

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

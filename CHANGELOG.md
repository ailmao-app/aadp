# Changelog

All notable changes to AADP are documented here. AADP follows its own
[backward compatibility policy](docs/adr/0004-backward-compatibility.md):
patch releases within `0.1.x` MUST NOT break schema or wire compatibility.

## [Unreleased]

### Changed

- Renamed the protocol from "AI Data Discovery Protocol (AIDP)" to
  "AI Application Discovery Protocol (AADP)": package name (`aadp`),
  validator CLI (`aadp-validate`), exported types (`Aadp*`) and the
  conformance env var (`AADP_BASE_URL`). The v0.1 wire contract is
  unchanged: the `aidp_version` field and the published v0.1 schema
  `$id` URLs keep the `aidp` prefix. Renamed wire identifiers
  (`aadp_version`, `aadp:*` module IDs) apply from v0.2.

## [0.1.0] - Phase A (pending release gate)

### Added

- Normative specification v0.1 (`spec/v0.1/specification.md`).
- JSON Schema Draft 2020-12 for `manifest`, `sitemap-index`, `sitemap`, `entity`
  envelope and `error` envelope (`schemas/v0.1/`).
- Canonical JSON serialization and SHA-256 checksum implementation
  (`src/canonical-json/`).
- Validator library and CLI (`src/validator/`).
- Reference client implementing discovery → sitemap → entity flow
  (`src/client/`).
- Positive/negative fixtures and checksum test vectors (`examples/v0.1/`,
  `tests/fixtures/`).
- Mock reference server and conformance suite exercising status codes,
  cache headers, checksum stability and pagination limits
  (`tests/conformance/`).
- ADRs for checksum algorithm, cache semantics, capability discovery and
  backward compatibility (`docs/adr/`).

### Notes

- Core does not import or reference any Ailmao-specific type, hostname or
  policy. See [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) §2.
- Release gate defined in `docs/IMPLEMENTATION_PLAN.md` §8 (Phase A3) must
  be green before Chặng B (Ailmao adapter) starts.

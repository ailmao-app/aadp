# Changelog

All notable changes to AADP are documented here. AADP follows its own
[backward compatibility policy](docs/adr/0004-backward-compatibility.md):
patch releases within `0.1.x` MUST NOT break schema or wire compatibility.

## [Unreleased]

### Added

- AADP v1.0 wire contract and normative specification
  (`spec/v1.0/specification.md`), accepted via
  [ADR-0005](docs/adr/0005-manifest-v1-discovery.md). v1.0 is a clean break
  from v0.1 — no dual manifest, content negotiation, or migration runtime
  (`docs/IMPLEMENTATION_PLAN.md` §1).
- JSON Schema Draft 2020-12 for the v1.0 manifest, sitemap index, sitemap,
  entity and error envelopes (`schemas/v1.0/`), plus valid/invalid example
  fixtures (`examples/v1.0/`, `tests/fixtures/invalid/v1.0/`).
- Version-aware schema validator registry: `validateDocument({ version,
  kind, data })` throws a distinct `UnsupportedAadpVersionError` for an
  unregistered version instead of silently falling back to a different
  version's schema (`src/validator/schemas.ts`, `src/validator/index.ts`).
  The CLI accepts `--version` or reads `aadp_version` from the document.
- Pure semantic validator (`src/validator/semantic.ts`) for rules JSON
  Schema cannot express: module/resource/interface ID uniqueness, security
  scheme reference integrity, placeholder-URL and secret-shaped-value
  detection, and an advisory (never blocking) "looks like an instruction"
  heuristic on `usage_guidance`.
- v1.0 reference client (`src/client/v1.0/`, exported as
  `ail-aadp/client/v1.0` and as the `v1` namespace on `ail-aadp/client`):
  SSRF-aware `UrlPolicy` blocking private/loopback/link-local destinations
  by default, a bounded fetch layer (streamed response-size cap, timeout,
  manually-capped redirects), and schema+semantic validation gating every
  document before its URLs are trusted for further discovery traversal.
- v1.0 conformance suite (`tests/conformance/v1.0/`) with its own mock
  server, runnable against the bundled fixture server or an external
  deployment via `AADP_BASE_URL`.
- Per-version package exports: `ail-aadp/client/v0.1`, `ail-aadp/client/v1.0`,
  `ail-aadp/schemas/v0.1/*`, `ail-aadp/schemas/v1.0/*`. The pre-existing
  unversioned `ail-aadp/client` and `ail-aadp/schemas/*` continue to resolve
  to v0.1 unchanged, so no existing consumer is silently repointed to v1.0.

### Changed

- Renamed the protocol from "AI Data Discovery Protocol (AIDP)" to
  "AI Application Discovery Protocol (AADP)": package name (`ail-aadp`),
  validator CLI (`aadp-validate`), exported types (`Aadp*`) and the
  conformance env var (`AADP_BASE_URL`).
- Renamed the v0.1 wire contract to match: the `aidp_version` field is now
  `aadp_version` in every payload (manifest, sitemap index, sitemap, entity,
  error), and the published v0.1 schema `$id` URLs moved from
  `https://aidp.dev/schemas/v0.1/` to `https://aadp.dev/schemas/v0.1/`.
  Originally planned for v0.2 (see ADR-0004), but pulled forward into v0.1
  while it is still pre-release (`0.1.0`, pending release gate — no consumer
  has shipped against the old field name), so there is exactly one wire
  identifier to remember instead of two. Updated everywhere the field
  appears: `spec/v0.1/`, `schemas/v0.1/`, `examples/v0.1/`, `tests/`,
  `src/client/index.ts`, and all docs/ADRs.
- `ailmao-landing`'s adapter now consumes the `ail-aadp` package instead of the
  old `aidp` tarball; adapter directory renamed `lib/aidp/` → `lib/aadp/`.

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

# Changelog

All notable changes to `ail-aadp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Protocol compatibility follows [ADR-0004](docs/adr/0004-backward-compatibility.md); released schemas are immutable and wire-breaking changes require a new protocol version.

## 1.2.0 - 2026-08-06

Module infrastructure and Relations Module pilot (`docs/adr/0007-module-versioning-and-discovery.md`, `docs/adr/0008-module-traversal-and-authorization.md`, `spec/modules/relations/v1.0/specification.md`, `docs/vi/plans/implementation-plan-v1.2.0.md`). Does not change AADP wire version `1.0`, the core entity schemas, or the package public API for any consumer that does not opt into a module subpath.

### Added

- Added a generic module registry engine (`ail-aadp/module-registry`, `src/module-registry/`): `registerModule`/`getModuleEntry`/`isModuleRegistered`/`validateModuleDocument`/`assertValidModuleDocument` let a concrete module (schema, types, semantic validator) register itself under a versioned module ID and be looked up/validated generically, without the core package knowing about any specific module. `MODULE_ID_PATTERN`/`isValidModuleId` enforce the module ID grammar from ADR-0007. This export is infrastructure only — no concrete module is re-exported from the package root; each module ships under its own versioned subpath.
- Added the Relations Module v1.0 pilot (`ail-aadp/modules/relations/v1.0`, `src/modules/relations/v1.0/`): schema (`schemas/modules/relations/v1.0/*.schema.json`), types, semantic validator, and a client (`resolve`/`graph`/`fetch`/`budget`) for reading a resource's relation sets and paginated relation collections. Authorization, shared traversal budget, cursor and cycle semantics follow ADR-0008. `followers`/`follows` are intentionally not published in this pilot pending a separate privacy-policy decision (see the module's spec `spec/modules/relations/v1.0/specification.md` §"Ngoài phạm vi").
- Added a Relations Module conformance profile (`src/modules/relations/v1.0/conformance/`) and fixture suite (`tests/fixtures/relations/v1.0/`) per `spec/modules/relations/v1.0/conformance.md`, exercised against an implementation independent of the reference client to demonstrate interoperability.
- Added ADR-0007 (module versioning, discovery, and package export-path rules) and ADR-0008 (module traversal budget and authorization), formalizing the module version matrix and its relationship to `aadp_version: "1.0"`.
- Added package export paths `./module-registry`, `./modules/relations/v1.0`, and `./schemas/modules/relations/v1.0/*`.

### Scope notes

- No standard relation field was added to the core entity schema v1.0.
- No cross-module graph composition; deferred to `1.5.0`.
- No Answer or Evidence & Provenance Module in this release.

## 1.1.0 - 2026-08-05

Bounded traversal controls (`docs/adr/0006-bounded-traversal-controls.md`, `docs/vi/plans/implementation-plan-v1.1.0.md`). Does not change AADP wire version `1.0`. Every new field is optional and additive; a caller who upgrades and passes no new options keeps `1.0.x`'s exact request count, ordering, and timing.

### Added

- Added caller-driven cancellation: `FetchJsonOptions`/`ConformanceOptions` gain an optional `signal?: AbortSignal`, combined with this package's own per-hop timeout controller via `AbortSignal.any()`. Aborting stops the in-flight request (headers and body), any pending retry backoff timer, and causes `iterateSitemap`/`discoverAllEntities`/`runConformance` to stop issuing further requests and reject/return promptly.
- Added bounded concurrency: new optional `concurrency?: number` on `DiscoverAllEntitiesOptions` bounds how many entity fetches may be in flight at once, backed by a new pure scheduler module (`src/client/scheduler.ts`). Default `1` — fully serial, identical request ordering and timing to every `1.0.x` release.
- Added opt-in retry/backoff: new optional `retry?: RetryOptions` (`{ maxAttempts?, baseDelayMs?, maxDelayMs? }`) on `FetchJsonOptions` and `ConformanceOptions`. Retries only a network/connect-level error, this package's own per-hop timeout, and HTTP `429`/`503` — never a `BlockedUrlError`, an aborted request, or a retry that would exceed a shared traversal budget/deadline. Backoff is exponential with full jitter; a `Retry-After` response header overrides the computed delay, itself capped at `maxDelayMs`. Default is no retry (identical to every `1.0.x` release).
- Added a total response-byte traversal budget: `DiscoveryBudgetState` (`src/client/discovery-budget.ts`) gains an optional `maxTotalBytes` limit charged from bytes actually streamed across every request in a walk, distinct from the existing per-response `maxResponseBytes` cap. Default unbounded (same as every `1.0.x` release).
- Added a conformance profile registry (`src/conformance/types.ts`): `ConformanceOptions.profile?: "core" | "public-web" | "full-traversal" | "authenticated"` is a named preset of budget/retry defaults, applied first and overridable per field. `core`/`public-web` are `1.0.x`'s implicit defaults; `full-traversal` raises `maxPages`/`maxEntities`/`deadlineMs` for deliberately exhaustive crawls; `authenticated` documents the expectation that the caller supplies credentials via `headers`. `report.profile` records which preset a run used.

### Fixed

- Fixed `links.no_dead_urls` bypassing the shared traversal budget/deadline and swallowing budget/abort errors as warnings instead of propagating them, so a probe made under this check now counts against the same shared budget every other HTTP call site does.
- Fixed a retry that could exceed the shared deadline and a `maxTotalBytes` check that was only enforced after a full body read instead of streaming; both are now checked before a retry sleeps and while a body is still being read. See `ERROR_LOG.md` 2026-08-03.

## 1.0.11 - 2026-08-03

Production certification operations (docs/vi/plans/implementation-plan-v1.0.11.md). Does not change AADP wire version `1.0`, the JSON Schemas, package public API, or any validation result — CI/test tooling only.

### Added

- Added `.github/workflows/scheduled-conformance.yml`: runs `aadp-conformance` on a schedule (plus manual `workflow_dispatch`) against `examples/reference-server`, built and started fresh in the job from a packed tarball on an ephemeral loopback address — never a shared or production environment, so the run needs no credential. A failed, erroring, or inconclusive run fails the job; JSON and JUnit reports are uploaded as a build artifact named with the package version, protocol version and a UTC timestamp, retained 90 days.
- Documented artifact retention (`docs/vi/operations/npm-release-guide.md` §9) and cross-referenced the new scheduled workflow from `docs/vi/operations/git-workflow.md` §3.

### Fixed

- Fixed a flaky `npm error code EOF` in `tests/package/*.test.ts` (`exports.test.ts`, `compatibility-contract.test.ts`, `validate-cli.test.ts`, `scaffold-cli.test.ts`, `conformance-cli.test.ts`, `reference-server.test.ts`): each file's `beforeAll` independently ran `npm run build && npm pack` against the same shared `dist/`, and Vitest runs test files in parallel workers by default, so one file's `tsc` rebuild could rewrite `dist/**` mid-read of another file's concurrent `npm pack`. Build/pack now happens exactly once, serially, in a new Vitest `globalSetup` (`tests/package/global-setup.ts`) before any worker starts, and every test file's `packAndExtractTarball()` (`tests/package/tarball-helpers.ts`) only copies/extracts that already-built tarball. Test-only; does not affect the published package. See `ERROR_LOG.md` 2026-08-03.

## 1.0.10 - 2026-08-02

Robustness fix (docs/vi/plans/implementation-plan-v1.0.10.md). Does not change AADP wire version `1.0`, the JSON Schemas, or any validation result.

### Fixed

- Fixed `renderJUnitReport` (`ail-aadp/conformance`): `xmlEscape()` only escaped `& < > " '`, so a server-supplied string that reaches a check message or detail (entity id, sitemap type, a response header value, ...) could carry a raw C0 control byte other than tab/LF/CR straight into the emitted `--junit` XML. `canonicalize()`/the JSON Schemas accept such a byte as an ordinary JSON string character, but XML 1.0 forbids it in content with no valid character reference, so the resulting report was not well-formed XML and could fail to parse in CI systems that render JUnit output (GitHub Actions test-reporter, GitLab, Jenkins). `xmlEscape()` now also replaces every XML 1.0-illegal code point with a visible `\uXXXX` text escape, in addition to the existing `& < > " '` entity escaping. See `ERROR_LOG.md` 2026-08-02.
- Fixed the server runtime (`ail-aadp/server`, `AADP-ACCESS-001`): a resource whose `security` explicitly referenced a `security_schemes.<id>.type: "none"` scheme (explicit no-auth, spec v1.0 §3.1.7) got `Cache-Control: private, no-store` — the same as a resource protected by a real `api_key`/`oauth2` scheme — instead of the `public, max-age=...` a resource that omits `security` entirely gets, even though both mean "no credential required". `cacheControlFor()` now resolves the referenced scheme's `type` before choosing a cache policy, so `none` and omitted `security` are cache-equivalent and only an actually protected scheme forces the private path. `ETag`/`Last-Modified`/conditional-GET behavior is unchanged (spec v1.0 §7 already applies unconditionally). See `ERROR_LOG.md` 2026-08-02.

## 1.0.9 - 2026-08-01

Compatibility and interoperability hardening (docs/vi/plans/implementation-plan-v1.0.9.md). Does not change AADP wire version `1.0`, the JSON Schemas, or any validation result.

### Added

- Locked the public export surface and machine contracts with tarball-only tests (`tests/package/exports.test.ts`, `tests/package/compatibility-contract.test.ts`): every documented `exports` subpath, the three CLI binaries, conformance check IDs, the JSON/JUnit report shape, `exitCodeFor`'s exit-code mapping, `AadpServerErrorCode` HTTP statuses, and the default server route convention.
- Added exit-code contract tests for `aadp-validate` and the `aadp` scaffold CLI (`tests/package/validate-cli.test.ts`, `tests/package/scaffold-cli.test.ts`), run from the packed tarball like the existing `aadp-conformance` CLI test.
- Added `examples/reference-server`, a neutral third-party AADP v1.0 deployment built only on `defineAADP()`/`defineResource()`/`handleRequest()` and plain `node:http`, plus an automated smoke test (`tests/package/reference-server.test.ts`) that installs it from a packed tarball and verifies `aadp-conformance` passes against it at both the default and a custom `routes` configuration.
- Added `scripts/check-release-consistency.mjs` (`npm run check:release-consistency`) to confirm `package.json`, `package-lock.json` and `CHANGELOG.md` agree on version before a release, and a `release-gate` CI job that runs it on `vX.Y.Z` tag pushes.
- CI now also runs `npm run docs:check` and runs the full job matrix against both the oldest Node this repo's devDependency toolchain (`vitest` -> `rolldown`) can run on (20.19.0 — not the package's own `engines` floor of 20.18.1, which is a promise about the published runtime dependencies only) and the primary CI Node version (22.12.0).
- Expanded the robustness regression corpus: double percent-encoding and encoded slash/backslash in server routes (`tests/server/routes.test.ts`), cursor tampering and cross-wire-version cursor replay (`tests/server/runtime.test.ts`), an end-to-end DNS-rebinding block (`tests/client/dns-pin.test.ts`), cross-origin 3xx redirect header stripping (`tests/client/v1.0.test.ts`), and deeply-nested-document handling (`tests/schema/checksum.test.ts`).

### Fixed

- Fixed `examples/reference-server`'s standalone entry-point guard (`import.meta.url === \`file://${process.argv[1]}\``), which never matched on Windows (`process.argv[1]` uses backslashes; `import.meta.url` is a `file:///`-prefixed URL), so the example server silently exited without starting when run directly. Now compares against `pathToFileURL(process.argv[1]).href`. Example-only; not part of the published package.
- Fixed the reference client (`src/client/http.ts`, shared by `ail-aadp/validator` and `ail-aadp/conformance`): a DNS-rebinding block from the pinned-DNS dispatcher (`pinnedLookup()` in `src/client/dns-pin.ts`) surfaced as a generic `TypeError: "fetch failed"` instead of `BlockedUrlError`, because `fetch()` wraps every connect-time failure in a `TypeError` with the real cause one level down in `.cause`. A caller catching `BlockedUrlError` specifically — the same way the string-level URL policy check throws it directly — silently missed this path. Patch fix: unwraps `err.cause` before rethrowing when it is a `BlockedUrlError`. See `ERROR_LOG.md` 2026-08-01.
- Fixed `canonicalize()`/`checksumOf()` (`ail-aadp/canonical-json`): a pathologically deep document (~5000+ nesting levels) crashed with a raw `RangeError: Maximum call stack size exceeded` instead of the `TypeError` this "validating canonicalizer" documents for every other out-of-domain input. Since checksums are verified against server-supplied fields the client does not otherwise bound (entity `data`, sitemap `items`/`sitemaps`), an adversarial or misbehaving server could trigger this. See `ERROR_LOG.md` 2026-08-01.
- Fixed the `aadp-conformance` CLI: an unparseable argv (missing `<base-url>`, an unknown flag, or a numeric option given `NaN`/`Infinity`/a negative or non-integer string) exited `1` — the same code documented as "one or more checks failed" — instead of `2` ("the run could not be performed"), so a CI job checking `$? === 1` for nonconformance could misread a typo'd flag as a real failure. See `ERROR_LOG.md` 2026-08-01.
- Fixed a regression introduced by the fix above: a malformed `--header` (or any other error thrown inside the CLI action rather than Commander's own argv parser) was silently swallowed by the catch-all added for `exitOverride()`'s rethrow, exiting `0` with no output instead of `2` with a clear message. See `ERROR_LOG.md` 2026-08-01.
- Fixed `examples/reference-server`: the publish origin used to build every manifest/sitemap/entity URL was taken from the first request's `Host` header and cached for the process's lifetime, so one request naming an attacker-controlled `Host` permanently repointed every published discovery URL for every subsequent request. Now resolved once at startup from `AADP_BASE_URL` or the address actually bound, never from a request header. See `ERROR_LOG.md` 2026-08-01.

### Changed

- Extracted the packed-tarball build/extract fixture shared by `tests/package/*` into `tests/package/tarball-helpers.ts`.

## 1.0.8 - 2026-07-30

### Added

- Added `renderJUnitReport` to `ail-aadp/conformance` and a `--junit <file>` flag to the `aadp-conformance` CLI: a JUnit XML report alongside the existing text/JSON report, for CI systems that render test results (GitHub Actions test-reporter, GitLab, Jenkins, ...) instead of parsing JSON. A `warning` check is a passing `<testcase>` with its message kept in `<system-out>` unless `failOnWarning` (the same option `runConformance` already takes) asks for `<failure>` instead; JUnit has no native warning status.
- Added `examples/ci/github-actions-conformance.yml`, a copy-paste GitHub Actions workflow that runs `aadp-conformance` against a deployment, publishes the `--junit` report as check-run annotations, and uploads the `--json` report as a build artifact (`AADP-CONFORMANCE-003`).

## 1.0.7 - 2026-07-29

### Added

- Added `routes` to `AadpServerConfig`: `sitemapIndex`/`sitemap`/`entity` pathname templates let an application publish and serve AADP discovery documents at custom routes instead of the SDK's `/ai/v1.0/...` default convention. `sitemap` requires exactly one `{type}` placeholder, `entity` requires exactly one `{type}` and one `{id}`; templates are compiled once at `defineAADP()` time into both the URL builder and `handleRequest()`'s matcher, so the two can never drift apart. Malformed templates or routes that could match the same inbound pathname (including a collision with the fixed `/.well-known/ai-manifest.json`) throw immediately at definition time. Omitted fields keep the existing default, so this is fully backward compatible.
- A literal route segment is now percent-encoded the same way `new URL()`/`Request` normalizes a pathname (the WHATWG path percent-encode set), so a custom `routes` literal containing a space or non-ASCII character can no longer publish a URL that `handleRequest()` itself fails to recognize (404). A malformed `%XX` escape in a literal segment now also throws at `defineAADP()` time even when that literal shares a segment with a `{type}`/`{id}` placeholder, not only in a fully-literal segment.

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

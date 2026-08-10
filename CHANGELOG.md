# Changelog

All notable changes to `ail-aadp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Protocol compatibility follows [ADR-0004](docs/adr/0004-backward-compatibility.md); released schemas are immutable and wire-breaking changes require a new protocol version.

## Unreleased

## 1.4.0

Evidence & Provenance Module `1.0` (`docs/adr/0010-evidence-citation-provenance-and-security.md`, `spec/modules/evidence/v1.0/specification.md`, `docs/vi/plans/implementation-plan-v1.4.0.md`), plus the generic server module support and reference resources carried over from `1.3.0`. Additive only: AADP wire version stays `1.0`, and no released core, Relations `1.0` or Answer `1.0` schema changes. No public API changes for any consumer that does not opt into the `ail-aadp/modules/evidence/v1.0` subpath.

> **Release gate.** ADR-0010 was Accepted on 2026-08-09, allocating `aadp:evidence@1.0`. The external interoperability run (a packed-tarball conformance run against a real HTTPS deployment, for both Answer and Evidence) is still open — see `docs/records/implementation-record-v1.4.0.md`.

### Added

- Added the Evidence & Provenance Module v1.0 wire contract (`ail-aadp/modules/evidence/v1.0`, `src/modules/evidence/v1.0/`): schemas (`schemas/modules/evidence/v1.0/*.schema.json`), types, pure wrapper semantic validators (`validateEvidenceV1`) and an entity-context validator (`validateEvidenceEntityV1`/`parseEvidenceEntityV1`). Two document kinds, `claim` (what is asserted) and `evidence` (what is cited), each carried on an entity's `x_evidence`; `source` (where the evidence came from) is nested inside an evidence document rather than being a third kind, because nothing at `1.0` resolves a source independently.
- Added the single edge `claim.evidence_refs[]`, whose `target_type` is the **constant** `evidence`. A claim can therefore point neither at another claim nor at itself, and an evidence document has no field pointing back — so the `1.0` wire model cannot express a cycle, and the module has no cycle policy, cycle guard, self-reference rule or cycle fixture. Several claims citing one evidence document is fan-in, handled by deduplication.
- Added `stance` (`support`/`contradict`/`neutral`) and an optional `confidence` in `[0, 1]` with at most 2 decimal places. Both are **producer assertions**, never conclusions: `neutral` means "relevant, but no direction asserted", which is different from the absence of a reference, and an absent `confidence` means "not declared" — not `0`, not `1`. Clients in this package never recompute or aggregate them into a score, and no validator infers stance from free text or language-detects.
- Added a three-timestamp `provenance` contract (`published_at`, `retrieved_at`, optional `modified_at`) with the invariant `published_at <= modified_at <= retrieved_at`. "The date of the evidence" is `modified_at` when present, otherwise `published_at`; `retrieved_at` records when the producer fetched the source and is never the date of the content. For an entity of `type: "evidence"` the relationship to the core envelope is `provenance.retrieved_at <= entity.updated_at` — **ordering, not equality**, deliberately unlike Answer `1.0`, so a correction published without re-retrieving the source stays valid instead of forcing producers to misstate provenance.
- Added `x_evidence.content_checksum`, reusing the released ADR-0001 digest and `ail-aadp/canonical-json` `checksumOf()` unchanged — no new canonicalization rule, only a different input scope. Its scope covers every normative wrapper field including a Relations `target.x_*` nested inside `evidence_refs`; the core entity `checksum` still covers `data` only, and a valid Evidence entity passes both.
- Added `source.access` (`public`/`authenticated`/`restricted`) as **presentation metadata about the source outside AADP** — it grants nothing, and takes part in no traversal, authorization or conformance decision. Authorization of an evidence resource is decided by core/Relations authorization and the manifest `security` declaration; every 401/403 is `forbidden` independent of `access`, which is not even readable at the moment classification needs it (a 401/403 has no body).
- Added an Evidence graph client (`src/modules/evidence/v1.0/client/`): `fetchEvidenceEntityV1`, the injected-clock `classifyEvidenceFreshness` (freshness is client-computed — Evidence `1.0` has no `expires_at` and no `freshness` field), and the two resolvers `resolveClaimEvidenceV1` (one hop) and `resolveAnswerEvidenceV1` (two hops: `related_entities` → claim → `evidence_refs`), both returning an `EvidenceGraph` of `nodes`/`references`/`edges`/`partial`. A node carries only the canonical fetch/schema/checksum outcome; the `target_type` verdict is recomputed per occurrence, so a reference declaring the wrong type cannot poison another reference naming the same target — in either order. Each canonical target is fetched at most once per walk (fan-in), the walk uses the caller-owned `RelationsTraversalBudgetState` with no child budget, no raised default and no new dimension, and a budget stop or abort yields a partial result in which every remaining reference is still reported as `budget-exhausted` rather than dropped.
- Added Answer integration that does **not** touch `aadp:answer@1.0`: an Answer cites claims/evidence through the existing `related_entities` with a `target_type` of `claim` or `evidence`. `resolveAnswerEvidenceV1` deliberately does not call `resolveAnswerTargets`, which would also collect `authorship.source_targets` — out of scope for Evidence and a way to spend shared budget on generated-summary provenance before the citation walk starts. `AnswerValidationResult`, `AnswerEntityValidationResult` and the set of valid Answer `1.0` payloads are unchanged.
- Added an Evidence conformance profile (`src/modules/evidence/v1.0/conformance/`, check IDs `evidence.discovery`/`evidence.resource`/`evidence.schema`/`evidence.semantic`/`evidence.context`/`evidence.graph`/`evidence.stance`/`evidence.provenance`/`evidence.answer_link`/`evidence.security`) and fixture catalog (`tests/fixtures/evidence/v1.0/`) per `spec/modules/evidence/v1.0/conformance.md`. A run records every URL it attempts together with the phase that initiated it, and every **logical** canonical-target resolution the traversal decided to make. That is what lets `evidence.graph`/`evidence.answer_link` prove fan-in dedup per resolution rather than per HTTP attempt — a retry that recovered a transient `429`/`503` is not a dedup defect — and `evidence.security` prove `source.url`/`publisher.url` were never traversed from request provenance rather than from URL equality, so a metadata URL that is also the supplied sample URL is not a failure and an equivalent URL spelling is not an escape hatch. `runEvidenceConformance` validates every numeric/`retry`/`now` option before making any request and throws `InvalidEvidenceConformanceOptionsError`, so a caller's misconfiguration is never recorded as a `failed` check against the deployment. A `forbidden` entry never fails the dangling-reference gate.
- Added package export paths `./modules/evidence/v1.0` and `./schemas/modules/evidence/v1.0/*`, and recorded the canonical-JSON digest of each of the six released Evidence `1.0` schema artifacts in `docs/records/implementation-record-v1.4.0.md`, enforced by a test that also fails if a schema is added to the released directory without being recorded.
- Added `AadpServerConfig.modules` (`ail-aadp/server`), which publishes module declarations in the manifest's `modules[]`, validated against the core manifest schema and semantic rules at `defineAADP()` time, on the same path as every other manifest field.
- Added `SerializedEntity.extensions` (`ail-aadp/server`), which emits root-level `x_*` extension fields on entity documents. Keys must match the released core entity grammar `^x_[a-zA-Z0-9_]*$`; a non-matching key, a key colliding with a core entity field, or a non-JSON-safe value fails loudly instead of being silently dropped. The caller's object is never mutated, frozen or adopted.
- Added `isExtensionKey()` and `EXTENSION_KEY_GRAMMAR` (`ail-aadp/validator`), exposing that grammar as a single shared predicate so no layer can drift into a stricter copy of it.
- `examples/reference-server` now publishes `answer`, `claim` and `evidence` resources alongside `note`, all through `SerializedEntity.extensions` and declared in the manifest's `modules[]`. Its citation graph exercises the contract rather than one happy path: an answer cites a claim, that claim cites two evidence documents with opposing stances, a second claim shares one of them (fan-in), one evidence document was retrieved *before* it was last updated (the ordering invariant, not equality), and one is served only to an authorized caller so a walk yields `forbidden` rather than a dangling reference. Because Evidence `1.0` is not published on `aadp.dev` yet, the example serves the released schema artifacts from its own origin and points `modules[].schema` there — a manifest must never advertise a schema an agent cannot fetch. The example still imports nothing but public subpaths.

### Changed

- Extracted the per-budget canonical resolution state out of `resolveAnswerTargets` into a shared internal layer (`src/modules/shared/canonical-resolution.ts`) that Answer and Evidence both use, carrying the `1.3.1` resolution-context binding with it unchanged. This is a pure refactor of Answer: public API, wire contract and normative semantic results are identical, and the entire existing Answer test suite passes without a single line changed. The layer is **not** exported from any public subpath — its preconditions cannot be checked from outside, the same reason Relations keeps `releaseNode` internal.
  The reason it has to be shared: that state is keyed by the caller-owned budget, and a canonical key the layer has never itself resolved is reported `invalid`. Two modules walking one budget through two separate caches would therefore manufacture false `invalid` results for each other. One cache per budget makes a mixed Answer/Evidence walk correct, and it also means `resolution_context_mismatch` now fails closed across module boundaries: an Evidence call cannot reuse a budget first bound to a different request context, in either direction, sequentially or concurrently.
- Evidence classifies a target blocked by URL/DNS policy as `forbidden` ("access control, not a broken graph", specification.md §10.2), where Answer `1.0` released the same case as `invalid`. The shared layer reports the underlying issue code so each module keeps its own released contract; **Answer's classification is unchanged**.

### Scope notes

- Schema validity of an Evidence document MUST NOT be read as factual truth, authenticity or legal validity. This module does no fact-checking, no ranking, no trust scoring and no publisher reputation, and `content_checksum` is not a signature: it detects tampering within its hash scope, does not prove a producer honest, and does not replace TLS.
- `source.url`, `publisher.url` and `entity.canonical_url` are metadata and are never fetched by a validator or client. Only targets inside `evidence_refs`/`related_entities` are fetched, and only through the Relations URL/DNS policy when the caller opts in.
- Adding a reverse evidence → claim edge would be a model change requiring its own ADR, not a minor bump.

### Carried over from 1.3.0

- Both new server fields are generic: the runtime never inspects, imports or branches on a specific module id, and the entity `checksum` stays scoped to `data` so adding an extension to an already-published entity does not change it. A configuration omitting `modules` and `extensions` produces manifest and entity documents byte-identical to `1.3.0`. Boundary keys `x_Foo`, `x_1` and bare `x_` are accepted because the released core entity schema accepts them.
- The reference Answer resource closes the reference-resource gate deferred from `1.3.0`. Its interop test asserts the served entity passes `validateAnswerEntityV1` end to end and that every related target actually resolves. Answer `1.0` requires an absolute HTTPS `canonical_url`, so answers validate when the example runs under an HTTPS `AADP_BASE_URL`; the server also prints the local address it bound when that differs from the origin it publishes.
- The external interoperability gate deferred from `1.3.0` — a packed-tarball conformance run against a real HTTPS deployment, for both Answer and Evidence — is **still open**; see `docs/records/implementation-record-v1.4.0.md`.

## 1.3.1 - 2026-08-08

Security patch for the Answer client's per-budget canonical resolution cache (`docs/vi/plans/implementation-plan-v1.3.1.md`). Does not change AADP wire version `1.0`, any released schema, the Answer Module `1.0` wire contract, or the package's public export surface — no export was added, changed or removed.

### Security

- Fixed `resolveAnswerTargets` (`ail-aadp/modules/answer/v1.0`) sharing a canonical target's cached result, and joining its in-flight request, across calls made with **different request options** on the same caller-owned `budget`. `resolveAnswerTargets` keys that per-budget state by canonical target alone, while `headers`, `urlPolicy`, `maxResponseBytes` and the other request options are per call, so on a budget deliberately shared between calls (the documented usage — that state is designed to outlive one call and to be race-safe across concurrent calls) a later call could:
  - receive an entity fetched with **another call's credentials**, without ever making the request that would have produced its own `401`/`403`; and
  - replay a **larger cached response** than its own `maxResponseBytes` cap allows, bypassing that limit.

  Both were order-dependent, which also made concurrent calls on one budget nondeterministic: whichever call created the in-flight entry first supplied the options for the single shared request.

  A budget's resolution state is now bound, on first use, to the full set of request-affecting options (`headers`, `crossOriginSafeHeaders`, `urlPolicy`, `rootOrigin`, `timeoutMs`, `maxRedirects`, `maxResponseBytes`, `retry`, `onBeforeAttempt`). A later call with a different set throws `AadpClientError` with `code: "resolution_context_mismatch"` **before** any cache replay, in-flight join, budget charge or request — so a rejected call leaves the budget untouched. Only a per-process-keyed HMAC digest of those options is stored; raw header values are never retained, and the error message names no option, header or digest.

  Affected: `1.3.0` (the only release with this cache). Not affected: any consumer that does not call `resolveAnswerTargets`, or that uses a separate budget per set of request options.

  Workaround without upgrading: use a separate `RelationsTraversalBudgetState` for each distinct set of request options.

### Changed

- `resolveAnswerTargets` now throws `AadpClientError` (`code: "resolution_context_mismatch"`) when one budget is reused with different request options. Unchanged for the intended usage — one budget, one immutable request configuration — which keeps identical results, request counts and budget accounting. Note this is wider than credentials alone: varying `timeoutMs`, `maxRedirects`, `maxResponseBytes` or `retry` across calls on the same budget now throws as well, because sharing one request and one cached outcome between different configurations is order-dependent and, for `maxResponseBytes`, a safety-limit bypass. Callers needing different options must use different budgets.

## 1.3.0 - 2026-08-06

Answer Module `1.0` (`docs/adr/0009-answer-module-terminology-and-security.md`, `spec/modules/answer/v1.0/specification.md`, `docs/vi/plans/implementation-plan-v1.3.0.md`). Does not change AADP wire version `1.0`, the core entity schemas, or the Relations Module `1.0` schemas. Does not change the package public API for any consumer that does not opt into the `ail-aadp/modules/answer/v1.0` subpath.

### Added

- Added the Answer Module v1.0 wire contract (`ail-aadp/modules/answer/v1.0`, `src/modules/answer/v1.0/`): schema (`schemas/modules/answer/v1.0/*.schema.json`), types, a pure wrapper semantic validator (`validateAnswerV1`), and an entity-context validator (`validateAnswerEntityV1`/`parseAnswerEntityV1`) for describing a question, concise answer, optional full answer, applicability, freshness, and related entities on an entity of `type: "answer"` via `entity.x_answer`.
- Added `authorship` as a tagged union of `source-authored` and `generated-summary`, distinguishing source-authored content from an automatically generated summary purely by data — never inferred from free text (ADR-0009).
- Added `x_answer.content_checksum`, an integrity digest over `x_answer` (minus itself) computed with the already-released `ail-aadp/canonical-json` `checksumOf()` — separate from, and in addition to, the core entity `checksum` (which only covers `data`). See ADR-0009.
- Added a deterministic, restricted BCP 47 locale profile for Answer `1.0` (`isValidAnswerLocale`, `ANSWER_LOCALE_PATTERN`), enforced identically by schema and by the pure semantic validator.
- Added an Answer client (`src/modules/answer/v1.0/client/`): `fetchAnswerEntityV1` (core `fetchEntity` + Answer parse/validation), `classifyAnswerFreshness` (injected-clock `fresh`/`stale` classifier), and `resolveAnswerTargets` (resolves both `related_entities` and, for a generated summary, the mandatory `authorship.source_targets` — each result entry tagged `{group, index}` — via the Relations `1.0` resolver, reusing its URL/DNS policy, authorization behavior, scheduler, and the caller-owned `RelationsTraversalBudgetState` of the parent traversal — no child budget, no type inference from `target.id`). Per-reference status (`resolved`/`forbidden`/`not-found`/`invalid`/`budget-exhausted`) is classified from the underlying error, not just its coarse Relations issue code, so an HTTP 404 is distinguished from a schema-invalid/checksum-mismatched/blocked response. A target shared by both groups is fetched at most once (Relations' shared-budget dedup); `resolveAnswerTargets` keeps its own outcome/in-flight state keyed by the caller-owned `budget` object's identity — living for as long as that budget does, not just one call — and replays the known outcome, or joins the same in-flight fetch, for a later duplicate occurrence instead of guessing `resolved`. This covers a duplicate arriving from an earlier or later `resolveAnswerTargets` call sharing the same budget, and from a concurrent call racing on the same budget — a canonical target's underlying fetch is never tied to any one caller's `options.signal` (it uses an internal, resolver-owned `AbortController` instead), so each concurrent caller instead races only its own wait for the (possibly shared) result against its own signal: one caller aborting stops only that caller's own call (`partial: true` for its remaining references) and never fails, silently completes, or in any way affects a different concurrent caller waiting on the same fetch. Cancellation still genuinely happens, just never at one caller's unilateral say: a reference whose `options.signal` is already aborted never starts a new fetch (no charge, no request, on behalf of a call that already gave up), and a canonical target's real in-flight HTTP request — still consuming shared `maxRequests`/`maxTotalBytes` budget — is actually cancelled the moment its last remaining waiter stops waiting, rather than left running to completion in the background against nobody; abandoning it this way also immediately, synchronously releases the Relations `chargeNode` charge that canonical target's fetch made (`ail-aadp/modules/relations/v1.0`'s new `releaseNode`, module-internal), so a later call for that exact target — even one issued right after the aborted call returns, before the abandoned fetch's own cancellation has finished settling — can start a genuinely new resolution instead of being stuck seeing Relations' bare `duplicate` and reporting `invalid` forever. A canonical target that caused a genuine shared-budget exhaustion (`AadpDiscoveryBudgetExceededError`) while in flight is replayed as `budget-exhausted` on every later occurrence of that exact target across the whole budget, not silently downgraded to `invalid` — an `AbortedError`, being caller-scoped rather than budget-shared, is deliberately never recorded this way, so one caller's cancellation can never poison a later, unrelated call's result for the same target. Each occurrence is still checked against its OWN declared `target_type`, so two references naming the same canonical target with different `target_type` never share a `resolved` verdict — including the case where only the later, not the triggering, occurrence declared the correct type. A duplicate this resolver has no recorded outcome for at all (visited by some other path entirely over the same budget) is reported `invalid`, never guessed `resolved`.
- Added `RelationsTraversalIssue.cause` and `RelationsTraversalIssue.entity` (`ail-aadp/modules/relations/v1.0`), both additive and optional. `cause` is the original caught error behind a resolution issue — lets a caller (e.g. Answer's `resolveAnswerTargets`) distinguish causes the existing `code`/`message` fields collapse (e.g. `target_unresolvable` covers a 404, a 5xx, a timeout, a schema-invalid response, and a checksum mismatch alike) without depending on `message` text, which was never a stable API. `entity` is the fetched, schema/checksum-valid entity behind a `target_unresolvable` issue caused specifically by the entity's `type` disagreeing with the caller's `expectedType` (never set for an `id` mismatch, which means the resource isn't the declared target at all) — lets a caller with its own, differently-scoped expected type for the same canonical target reuse the already-fetched entity instead of re-fetching or discarding it. Neither changes any existing `code` value or Relations conformance behavior.
- Added an Answer conformance profile (`src/modules/answer/v1.0/conformance/`, check IDs `answer.discovery`/`answer.resource`/`answer.schema`/`answer.semantic`/`answer.context`/`answer.authorship`/`answer.references`/`answer.freshness`/`answer.security`) and fixture suite (`tests/fixtures/answer/v1.0/`) per `spec/modules/answer/v1.0/conformance.md`. `runAnswerConformance` validates every numeric/`retry`/`now` option up front — mirroring the core conformance runner's own `NUMERIC_OPTION_MINIMUMS` preflight — and throws `InvalidAnswerConformanceOptionsError` for an unusable value (`NaN`, non-integer, negative, or below each option's minimum) before making any request, so a caller's misconfiguration is never recorded as a `failed` check against the deployment under test.
- Added ADR-0009 (Answer Module terminology and security boundary), formalizing `concise_answer` as the sole term for the short answer (no `short_answer` alias), the `content_checksum` contract, reuse of `entity.canonical_url` as the sole human-facing URL (no separate `x_answer.canonical_url`), and the Answer/Evidence Module boundary.
- Added package export paths `./modules/answer/v1.0` and `./schemas/modules/answer/v1.0/*`.
- Recorded the canonical-JSON digest of each of the six released Answer `1.0` schema artifacts in `docs/records/implementation-record-v1.3.0.md`, enforced by a test that also fails if a schema is added to the released directory without being recorded. Consumers pinning `./schemas/modules/answer/v1.0/*` can verify against these; per ADR-0004 they will not change for Answer `1.0`. That record also lists the release gates still open for 1.3.0.

### Scope notes

- No content generation, ranking/search score, AEO/GEO score, or factual-truth evaluation in this release.
- No `evidence`, `claims`, or `citations` field on Answer `1.0`; deferred to the Evidence & Provenance Module `1.4.0`.
- No change to the core entity/manifest schema v1.0 or the Relations Module `1.0` schemas.
- No cross-module graph composition; deferred to `1.5.0`.

## 1.2.0 - 2026-08-06

Module infrastructure and Relations Module pilot (`docs/adr/0007-module-versioning-and-discovery.md`, `docs/adr/0008-module-traversal-and-authorization.md`, `spec/modules/relations/v1.0/specification.md`, `docs/vi/plans/implementation-plan-v1.2.0.md`). Does not change AADP wire version `1.0`, the core entity schemas, or the package public API for any consumer that does not opt into a module subpath.

### Added

- Added a generic module registry engine (`ail-aadp/module-registry`, `src/module-registry/`): `registerModule`/`getModuleEntry`/`isModuleRegistered`/`validateModuleDocument`/`assertValidModuleDocument` let a concrete module (schema, types, semantic validator) register itself under a versioned module ID and be looked up/validated generically, without the core package knowing about any specific module. `MODULE_ID_PATTERN`/`isValidModuleId` enforce the module ID grammar from ADR-0007. This export is infrastructure only — no concrete module is re-exported from the package root; each module ships under its own versioned subpath.
- Added the Relations Module v1.0 pilot (`ail-aadp/modules/relations/v1.0`, `src/modules/relations/v1.0/`): schema (`schemas/modules/relations/v1.0/*.schema.json`), types, semantic validator, and a client (`resolve`/`graph`/`fetch`/`budget`) for reading a resource's relation sets and paginated relation collections. Authorization, shared traversal budget, cursor and cycle semantics follow ADR-0008. `followers`/`follows` are intentionally not published in this pilot pending a separate privacy-policy decision (see the module's spec `spec/modules/relations/v1.0/specification.md` §8 "Standard registry").
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

- Node.js 20.18.1 or newer is now required, for compatibility with the security-hardened HTTP transport.

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

# AADP `ail-aadp` 1.3.0 Implementation Record — Answer Module 1.0

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | **Implementation complete; two release gates formally deferred to `1.4.0`** — see [Open release gates](#open-release-gates) |
| Audience | Package maintainers and release reviewers |
| Scope | Answer Module `1.0` (`aadp:answer`), delivered in package version `1.3.0` |
| Wire impact | New module only. No change to AADP core `1.0` schemas or Relations Module `1.0` schemas |
| Vietnamese internal edition | [`../vi/plans/implementation-plan-v1.3.0.md`](../vi/plans/implementation-plan-v1.3.0.md) |

## Abstract

This memo records what was actually built for the Answer Module `1.0`, the
released schema digests that fix its wire contract, the verification commands
run and their results, and — explicitly — which release gates from the
implementation plan are **not** yet satisfied. It is informational and does not
override the Answer specification or schemas.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Status of This Memo

The schema, validator, client and conformance work for Answer `1.0` is
complete and covered by the test suite. Two release gates defined in the
implementation plan are **not** satisfied, both concerning end-to-end evidence
against a live reference deployment; both have been formally deferred to
`1.4.0`, where the generic server capability they depend on is scheduled.

**This record does not close the 1.3.0 release checklist.** Signing it off means
accepting 1.3.0 without end-to-end interoperability evidence. See
[Open release gates](#open-release-gates).

## Delivered scope

| Area | Delivered | Location |
|---|---|---|
| Wire schemas | Six closed JSON Schemas, `$ref`-composed | `schemas/modules/answer/v1.0/` |
| Types | `AnswerDocumentV1`, authorship union, freshness, applicability, reference | `src/modules/answer/v1.0/types.ts` |
| Semantic validation | Locale profile, timestamp ordering, target uniqueness, `content_checksum` | `src/modules/answer/v1.0/semantic.ts` |
| Registry | Exact key `{aadp:answer, 1.0, answer}`, no fallback | `src/modules/answer/v1.0/register.ts` |
| Entity-context validation | `validateAnswerEntityV1` / `parseAnswerEntityV1` | `src/modules/answer/v1.0/entity.ts` |
| Client | `fetchAnswerEntityV1`, `classifyAnswerFreshness`, `resolveAnswerTargets` | `src/modules/answer/v1.0/client/` |
| Conformance | Nine checks, report renderers, option preflight | `src/modules/answer/v1.0/conformance/` |
| Package exports | `./modules/answer/v1.0`, `./schemas/modules/answer/v1.0/*` | `package.json` |

### Additive changes outside the Answer module

Both are optional and additive; neither changes an existing value or behaviour.

- `RelationsTraversalIssue.cause` — the original caught error behind a
  resolution issue, so a caller can distinguish causes that the coarse `code`
  collapses (a 404 vs. a 5xx vs. a checksum mismatch) without parsing message
  text.
- `RelationsTraversalIssue.entity` — the fetched, schema/checksum-valid entity
  behind a `target_unresolvable` issue caused *specifically* by a declared-type
  mismatch (never for an id mismatch). Lets a caller holding a different
  expected type for the same canonical target re-check the already-fetched
  entity instead of re-fetching or discarding it.

`releaseNode` was added to `src/modules/relations/v1.0/client/budget.ts` but is
deliberately **not** re-exported from the Relations public subpath: its
preconditions (only for a target the caller itself charged and that produced no
observable outcome) are not checkable at the boundary, and an external caller
misusing it would break `chargeNode`'s "charged at most once per walk"
guarantee.

## Immutable wire artifacts

Released Answer `1.0` schemas are immutable under
[ADR-0004](../adr/0004-backward-compatibility.md). Digests are over the
**canonical JSON** form (`checksumOf()`, the package's own published digest
primitive), so reformatting is not a contract change but any content change is.

| Schema artifact | Canonical digest |
|---|---|
| `answer-reference.schema.json` | `sha256:b3fcd6e9f96becc3b01798f15c7738b134ea15dbe132b82e1c8c184984d532d1` |
| `answer.schema.json` | `sha256:8d9dd023588723889a04cc0de257aeb4298ee720439164a266fb4527e60644d5` |
| `applicability.schema.json` | `sha256:9df8da62d9e52d11080fce9c41a020f18f0ed000589ba3f746c2f29172eae0fe` |
| `authorship.schema.json` | `sha256:f4780ef6b1a82b16ed04c102150f0526f229d83fdf1d881077f4a6a623283897` |
| `freshness.schema.json` | `sha256:76fc7555a5db1aff5551e48a69a1e8775577530be6fb3be1d75695679d7724b5` |
| `module.schema.json` | `sha256:57cc71f491cc92c053aceda89db90e04ed749ce60872a9e2550287599de0e839` |

Enforced by `tests/modules/answer/v1.0/schema-immutability.test.ts`, which also
fails if a new schema file is added to the released directory without being
recorded here. A failure there is **not** a test to update: it means either the
change belongs in a future Answer version, or the record needs a deliberate,
reviewed re-baseline.

## Compatibility contract

Verified at the packaged export boundary — not against `src/` — by
`tests/package/module-compatibility-contract.test.ts`:

- A **core-only** consumer validates an entity carrying `x_answer` exactly as it
  validates the same entity without it, including when `x_answer` is
  structurally nonsense. Asserted in a **separate Node process** that imports
  only the core subpaths, which is the only way to observe that the Answer
  module is never registered as a side effect (registration is global, so any
  in-process test importing the module subpath would contaminate the result).
- An **opt-in** consumer meeting an unsupported version gets
  `unsupported_module_version` with no fallback to `1.0`; an unknown module
  gets `unsupported_module`; an unknown kind gets `unsupported_module_kind`.

## Verification

Run on Node v20.20.2 (win32) at the state this record describes:

| Command | Result |
|---|---|
| `npm run build` | pass |
| `npm test` | pass — 46 test files, 820 tests |
| `npm run docs:check` | pass — 54 Markdown files, all relative links resolve |
| `npm run check:release-consistency` | pass — `package.json`, `package-lock.json`, `CHANGELOG.md` agree on `1.3.0` |
| `git diff --check` | pass |

## Open release gates

The following are defined in the implementation plan and are **not** satisfied.
The 1.3.0 release checklist MUST NOT be signed off until they are closed or
formally waived.

### 1. Reference server Answer resource — Phase 3 item 4

`examples/reference-server/` publishes no Answer entity and declares no
`aadp:answer` module in its manifest, so there is no neutral third-party
deployment to run Answer conformance against.

This is **blocked on server-layer API that does not exist yet**, not merely
unwritten example code. `ail-aadp/server` currently cannot express either half
of what the gate needs:

- `SerializedEntity` (`src/server/types.ts`) exposes only
  `id`/`updatedAt`/`canonicalUrl`/`locale`/`data` — there is no way for a
  resource to emit an `x_answer` (or any `x_*`) extension field.
- The manifest builder (`src/server/runtime.ts`) has no `modules` field, so a
  deployment cannot declare `aadp:answer` for `answer.discovery` to find.

Closing this gate therefore requires **new public API on `ail-aadp/server`**,
which the 1.3.0 plan's own file map does not list (it names
`examples/reference-server/*`, not `src/server/*`). Note that Relations `1.0`
shipped in 1.2.0 under the same limitation — its plan did not require a
reference-server module resource — so Answer would be the first module to have
one.

**Decision: deferred to `1.4.0`.** Recorded in
[the release roadmap §10](../vi/plans/release-roadmap.md) and added to `1.4.0`'s
scope and release gate. Rationale:

- The missing capability is a **generic** server feature (manifest `modules`
  declaration, `x_*` extension serialization), not an Answer-specific one.
  Evidence Module `1.4.0` needs exactly the same thing to publish `x_evidence`,
  so building it once in `1.4.0` serves both modules.
- It is additive public API, which under the roadmap's own versioning rules is a
  minor bump — so it cannot land in `1.3.x`, which is restricted to conditional
  patches.
- The alternative — hardcoding an Answer payload into the example server's route
  layer to satisfy the gate — would put module-specific logic in the example
  rather than the server layer, which is the wrong boundary and would have to be
  unwound when the generic capability arrives.

### 2. External conformance from a packed tarball — Phase 5 item 3

`tests/package/*` proves the Answer API is importable and self-contained from a
clean install, and `tests/package/module-compatibility-contract.test.ts` proves
the compatibility contract holds at that boundary. Neither runs
`runAnswerConformance` with a real `baseUrl` + `sampleEntityUrl` and asserts an
overall `passed` verdict, because gate 1 leaves no deployment to point it at.

Consequence: 1.3.0 currently has **no end-to-end interoperability evidence**.
The runner is covered by unit and mock-server tests only.

**Decision: deferred to `1.4.0`** alongside gate 1, which blocks it. Anyone
signing off the 1.3.0 release checklist MUST record that they are accepting the
release without this evidence.

## Decisions worth recording

- **Answer target resolution reuses the caller-owned Relations traversal
  budget** rather than creating a child budget, and caches per-canonical-target
  outcomes keyed by that budget's identity. This made cross-call and concurrent
  reuse observable behaviour, which in turn required explicit rules for
  cancellation scope, abandonment and stale settlement — all recorded in the
  Answer specification's typed-API section. If this proves to carry more
  complexity than it earns, the alternative is to scope the cache to a single
  `resolveAnswerTargets` call and document "reuse the budget, not the results".
- **`resolveAnswerTargets` separates a canonical target's fetch outcome from
  each reference's own `target_type` check**, because two references may
  legally declare different `target_type` for the same `{id, url}`. Inheriting
  one reference's verdict for another is a false result in both directions.
- **Answer conformance validates every numeric/`retry`/`now` option before the
  first request**, so a caller's misconfiguration surfaces as
  `InvalidAnswerConformanceOptionsError` rather than as a `failed` check blamed
  on the deployment under test. `maxRequests` requires `>= 1` (it is charged for
  every HTTP attempt in the run, including discovery), while `maxDepth`,
  `maxNodes` and `maxCrossOriginRequests` accept `0` as a meaningful boundary.

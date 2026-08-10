# AADP `ail-aadp` 1.4.0 Implementation Record — in progress

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | **In progress — not a release record.** Phases 0-6 complete and ADR-0010 Accepted; the external interoperability run remains the one open gate |
| Audience | Package maintainers and release reviewers |
| Scope | Evidence & Provenance Module `1.0` plus the generic server module support and reference resources carried over from `1.3.0` |
| Wire impact | AADP wire version stays `1.0`. No released core, Relations `1.0` or Answer `1.0` schema, module version or wire contract changed. Evidence `1.0` is a new module contract |
| Vietnamese internal edition | [`../vi/plans/implementation-plan-v1.4.0.md`](../vi/plans/implementation-plan-v1.4.0.md) |

## Abstract

This memo records what `1.4.0` has delivered, which decisions are worth
remembering, and which gates remain open. It exists before the release
deliberately: one of the open items is a **maintainer decision, not unwritten
code**, and a reviewer needs to be able to tell those apart.

It is informational and does not override any specification or schema.
Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Delivered

### Phase 1 — generic server module support (debt from `1.3.0`)

Additive public API on `ail-aadp/server`, generic by construction: the runtime
never inspects, imports or branches on a specific module id.

- `AadpServerConfig.modules` publishes module declarations in the manifest's
  `modules[]`, validated against the core manifest schema and semantic rules at
  `defineAADP()` time.
- `SerializedEntity.extensions` emits root-level `x_*` extension fields. A key
  failing the released core grammar, a key colliding with a core entity field, a
  non-JSON-safe value, or a non-plain-object `extensions` all fail loudly as
  `upstream_unavailable` rather than being silently dropped. The caller's object
  is never mutated, frozen or adopted.
- `isExtensionKey()` / `EXTENSION_KEY_GRAMMAR` (`ail-aadp/validator`) expose the
  grammar `^x_[a-zA-Z0-9_]*$` as one shared predicate, so no layer can drift into
  a stricter copy of it. Boundary cases `x_Foo`, `x_1` and bare `x_` are accepted
  because the released core entity schema accepts them.
- Core entity `checksum` stays scoped to `data`: adding an extension to an
  already-published entity does not change it.
- Omitting both new fields produces manifest and entity documents byte-identical
  to `1.3.0`, asserted literally rather than against another builder call.

### Phase 2 — Evidence schemas, types and fixtures

Six schema artifacts under `schemas/modules/evidence/v1.0/`, TypeScript types
matching them, and a fixture catalog at `tests/fixtures/evidence/v1.0/`
(7 valid, 31 invalid; every `content_checksum` produced by `checksumOf()`, never
copied by hand). Each invalid fixture has exactly one primary failure, and the
catalog test fails if a fixture is added or removed without updating the
expected-issue table.

### Phase 3 — registry and semantic validation

Exact registration at `{aadp:evidence, 1.0, claim}` and
`{aadp:evidence, 1.0, evidence}`, with no fallback across module, version or
kind. The pure wrapper validators cover what JSON Schema cannot express:
code-point bounds after trim, the locale profile, provenance ordering,
`confidence` decimal precision, duplicate canonical targets, the source URL
policy, and `content_checksum`. `validateEvidenceEntityV1` adds the entity-context
invariants, including `provenance.retrieved_at <= entity.updated_at`.

### Phase 4 — client, traversal and Answer integration

`fetchEvidenceEntityV1`, `classifyEvidenceFreshness`, `resolveClaimEvidenceV1`
and `resolveAnswerEvidenceV1`, all running on the shared canonical resolution
layer extracted from the Answer client. Covered by tests: two-hop expansion,
fan-in (one fetch per canonical target per walk), mixed-order equivalence,
mixed-type per-occurrence verdicts in both directions, dangling classification
including 401/403 and URL-policy blocks, partial results for budget stops and
aborts, and the assertion that `authorship.source_targets` is never fetched.

### Phase 5 — reference resources (debt from `1.3.0`)

`examples/reference-server` publishes `note`, `answer`, `claim` and `evidence`
through the one generic extension mechanism, using only public subpaths. The
citation graph is deliberately non-trivial — see "Decisions worth recording".

### Phase 6 — conformance and package surface

Ten stable check IDs, the `EvidenceConformanceReport` shape shared with the
Answer and Relations reports, export paths `./modules/evidence/v1.0` and
`./schemas/modules/evidence/v1.0/*`, and clean-install tarball tests that
exercise both from a packed tarball.

## Released schema digests

Canonical-JSON digests (`checksumOf`, ADR-0001) of the six Evidence `1.0`
artifacts as released in `1.4.0`. Consumers pinning
`./schemas/modules/evidence/v1.0/*` can verify against these; per ADR-0004 they
will not change for Evidence `1.0`. `tests/modules/evidence/v1.0/schema-immutability.test.ts`
enforces them, and also fails if a schema is added to the released directory
without being recorded here.

| Artifact | Canonical digest |
|---|---|
| `claim.schema.json` | `sha256:6073b68cc5ab1fd14419b345ad899c6568475ce924be953a3a28a2883fcc7e6b` |
| `evidence-reference.schema.json` | `sha256:f97969afa8344ba3fcb47a575718bff0de67f0168337ed9312dd6886764be9ca` |
| `evidence.schema.json` | `sha256:bb9bf9db1d19386b9482afb15f07c79dec640eaebf3cd511a8109e3e57772a07` |
| `module.schema.json` | `sha256:b660d50a024dc82d235916660278a7b56cff488f6393a6f56c71430f913683e2` |
| `provenance.schema.json` | `sha256:88251a395c57823db174dd046394a7d15fe5e0dd14808699e0e30034f8ee85ed` |
| `source.schema.json` | `sha256:7b760649dc076d81554d5cbc43762f458884a6926bd50360b1b7cd20c64d08af` |

## Closed gates

### ADR-0010 Accepted (2026-08-09)

[ADR-0010](../adr/0010-evidence-citation-provenance-and-security.md) is
**Accepted**, allocating the module ID `aadp:evidence` and version `1.0`.

Worth recording how this one went, because the ordering was unusual: the
implementation was built **before** acceptance, at explicit maintainer
direction, so the "decide before freezing" protection of ADR-0004 and ADR-0007
was spent in advance. Acceptance ratified every decision unchanged, so no
artifact needed editing — but that was the outcome, not a guarantee the process
provided. From the `ail-aadp@1.4.0` tag onward the schemas above are immutable
in the ordinary way.

## Open gates

### 1. External interoperability evidence has no owner or environment

Carried over from **open gate 2 of the [1.3.0 record](implementation-record-v1.3.0.md)**
and still open. This is now the only thing standing between `1.4.0` and a tag. The plan forbids closing it with a mock server or unit tests; it
needs a real deployment and a named person.

| Required | Status |
|---|---|
| Named maintainer owning the run | **Not assigned** |
| Reference server deployed at a real HTTPS origin, reachable from CI | **Not provisioned** |
| `ail-aadp` clean-installed from a packed tarball, public exports only | Mechanism exists in `tests/package/*` and passes against a local process; not yet pointed at a real origin |
| Real HTTP — no in-process handler, no fetch mock | Not run |
| `runAnswerConformance` report JSON, overall `passed` | Not run |
| `runEvidenceConformance` report JSON, overall `passed` | Not run |
| Run on the Node engine floor declared in `package.json` | Not run |

Neither half is blocked by missing code any more: the reference server publishes
conformant Answer, claim and evidence entities, and both runners execute from a
packed tarball. What is missing is a deployment and an owner, both of which are
coordination outside this repository.

## Verification run

```bash
npm run build
npm test                        # 59 files, 1038 tests, pass
npm run docs:check              # all relative links resolve
npm run check:release-consistency
```

The whole Answer test suite (12 files, 174 tests) passes **without a single line
changed**, which is the regression proof required for the shared-layer refactor.

`npm pack --dry-run` alone is not evidence that public exports work; the packed
tarball suite in `tests/package/*` is what exercises them, and the external run
in open gate 2 is what would prove interoperability.

## Decisions worth recording

- **The shared canonical resolution layer had to be shared, not copied.** Its
  per-budget state reports a canonical key it has never itself resolved as
  `invalid`. Two modules walking one budget through two separate caches would
  therefore manufacture false `invalid` results for each other, and the failure
  would depend on which module happened to touch a target first. One cache per
  budget is what makes a mixed Answer/Evidence walk correct.
- **A blocked URL is `forbidden` for Evidence and `invalid` for Answer.** The two
  released contracts genuinely disagree (Evidence specification.md §10.2 calls it
  access control, not a broken graph; Answer `1.0` shipped `invalid`). Rather
  than change a released classification, the shared layer reports the underlying
  Relations issue code and each module classifies under its own contract. Answer's
  behaviour is untouched.
- **`confidence` precision is a semantic rule, not a schema `multipleOf`.**
  `0.07 / 0.01` is `6.999999999999999` in binary floating point, so
  `multipleOf: 0.01` would reject values the specification allows. The schema
  bounds the range; the pure validator checks the decimals.
- **The reference server serves its own copy of the Evidence schemas.** A
  manifest must not advertise a `modules[].schema` an agent cannot fetch, and
  Evidence `1.0` is not published on `aadp.dev` yet — pointing the declaration
  there made the deployment fail the core `links.no_dead_urls` check, correctly.
  The example serves the released artifacts from the installed package's public
  `./schemas/modules/evidence/v1.0/*` export path, so the bytes cannot drift from
  the released ones.
- **The reference deployment's protected evidence record is not listed in its
  sitemap.** A sitemap advertises what an anonymous agent can fetch. The record
  stays reachable by direct URL, which is how a claim citing it produces a
  `forbidden` entry rather than a dangling one, without making the deployment
  fail its own core conformance run.
- **`resolveClaimEvidenceV1` uses an empty-string root key.** A bare claim
  document has no canonical `{id, url}` identity to key a node by, so every edge
  from it carries `from: ""`. Callers that need the claim's own key should reach
  it through `resolveAnswerEvidenceV1`, where the claim was resolved as an
  entity. The specification does not cover this case; it is an implementation
  decision, recorded here rather than silently made.
- **Resolution context binding shipped in `1.3.1`, not here.** The released
  contract is wider than the 1.4.0 plan originally scheduled —
  `maxResponseBytes`, `timeoutMs`, `maxRedirects`, `retry` and `onBeforeAttempt`
  are all part of the context — and it is the released one that governs. Phase 4
  carried it into the shared layer unchanged rather than redesigning it, and
  extended its tests across the Answer↔Evidence boundary in both directions,
  sequentially and concurrently.
- **The Evidence conformance runner installs one run-wide request log.** It must
  be a single `ClientOptions` object for the whole run, because the shared
  per-budget state binds to the request options on first use — a per-check hook
  would fail closed with `resolution_context_mismatch`.
- **Two verdicts read a second, coarser log than that one.** An HTTP-attempt log
  cannot carry either of them. `evidence.graph`/`evidence.answer_link` must
  count LOGICAL resolutions of a canonical target: `client/http.ts` restarts a
  retry from the original URL, so counting attempts would report a conforming
  deployment whose target transiently returned `429`/`503` as a fan-in dedup
  defect. And `evidence.security` must decide metadata traversal from
  PROVENANCE — which decision point asked for a URL — since a `source.url` that
  equals the supplied `sampleEvidenceUrl` is requested legitimately, while URL
  equality alone would both reject that conforming run and miss a real
  traversal spelled differently. Both read
  `observeCanonicalResolutions` (the shared resolution layer's own cache
  boundary, instrumentation-only and keyed by the caller-owned budget, so no
  module's public resolve options grow a hook and the resolution-context digest
  is untouched) plus a `purpose` recorded around each phase the runner opens.
  Every URL comparison canonicalizes both sides with `normalizeTargetUrl`, the
  canonicalizer behind `canonicalTargetKey`.

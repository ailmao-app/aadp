# AADP `ail-aadp` 1.4.0 Implementation Record — in progress

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | **In progress — not a release record.** Phase 1 and Phase 5 item 1 delivered; Phase 0 drafted and awaiting maintainer acceptance; Phases 2–4, 6 not started |
| Audience | Package maintainers and release reviewers |
| Scope | Evidence & Provenance Module `1.0` plus the generic server module support and reference resources carried over from `1.3.0` |
| Wire impact so far | None. AADP wire version stays `1.0`; no released schema, module version or wire contract changed |
| Vietnamese internal edition | [`../vi/plans/implementation-plan-v1.4.0.md`](../vi/plans/implementation-plan-v1.4.0.md) |

## Abstract

This memo records what `1.4.0` has actually delivered so far, what is drafted but
not yet decided, and which gates remain open. It exists mid-release deliberately:
two of the open items are **maintainer decisions, not unwritten code**, and a
reviewer needs to be able to tell those apart from work in progress.

It is informational and does not override any specification or schema.
Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Delivered

### Phase 1 — generic server module support

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

### Phase 5 item 1 — reference Answer resource

`examples/reference-server` publishes an `answer` resource alongside `note`,
using only public subpaths (`ail-aadp/server`, `ail-aadp/canonical-json`). This
closes **open gate 1 of the [1.3.0 record](implementation-record-v1.3.0.md)**,
which was blocked on the server API that Phase 1 above added.

- `x_answer` carries `authorship`, `freshness`, `related_entities` pointing at
  the deployment's own note entities, and a `content_checksum` computed with
  `checksumOf()`.
- References are built from the route configuration actually in effect, so the
  custom-routes run does not advertise default-route URLs.
- Answer `1.0` requires an absolute HTTPS `canonical_url`, so answers validate
  when the example runs under an HTTPS `AADP_BASE_URL`. The server now also
  prints the local address it bound when that differs from the origin it
  publishes, which is what lets a test talk to it over the socket while it
  publishes HTTPS URLs.
- `tests/package/reference-server.test.ts` asserts the served entity passes
  `validateAnswerEntityV1` end to end — core envelope, wrapper schema, every pure
  semantic invariant including `content_checksum`, the canonical-URL policy and
  `freshness.updated_at === entity.updated_at` — and that every related target
  actually resolves to the declared id.

## Drafted, awaiting a decision

Phase 0 artifacts exist and cover the decisions the plan requires, but the ADR is
**Proposed**, not Accepted:

- [`docs/adr/0010-evidence-citation-provenance-and-security.md`](../adr/0010-evidence-citation-provenance-and-security.md)
- [`spec/modules/evidence/v1.0/specification.md`](../../spec/modules/evidence/v1.0/specification.md)
- [`spec/modules/evidence/v1.0/conformance.md`](../../spec/modules/evidence/v1.0/conformance.md)

Everything in them is proposal, not normative. No module ID or version in them is
allocated by their existence.

## Open gates

### 1. ADR-0010 acceptance blocks Phases 2–6

No file under `schemas/modules/evidence/v1.0/`, no Evidence type, and no registry
key may be created before ADR-0010 is Accepted. Released schemas are immutable
([ADR-0004](../adr/0004-backward-compatibility.md),
[ADR-0007](../adr/0007-module-versioning-and-discovery.md)), so a decision
reversed after the artifact exists costs a major version before the module's
first release.

Acceptance is a maintainer decision. A developer or reviewer MUST NOT flip that
status, and a green test suite is not evidence for it.

### 2. External interoperability evidence has no owner or environment

Carried over from **open gate 2 of the [1.3.0 record](implementation-record-v1.3.0.md)**
and still open. The plan forbids closing it with a mock server or unit tests; it
needs a real deployment and a named person.

| Required | Status |
|---|---|
| Named maintainer owning the run | **Not assigned** |
| Reference server deployed at a real HTTPS origin, reachable from CI | **Not provisioned** |
| `ail-aadp` clean-installed from a packed tarball, public exports only | Mechanism exists in `tests/package/*`; not yet pointed at a real origin |
| Real HTTP — no in-process handler, no fetch mock | Not run |
| `runAnswerConformance` report JSON, overall `passed` | Not run |
| `runEvidenceConformance` report JSON, overall `passed` | Blocked on gate 1 |
| Run on the Node engine floor declared in `package.json` | Not run |

Note the Answer half of this gate is **no longer blocked by missing code** — the
reference server now publishes a conformant Answer entity. What it lacks is a
deployment and an owner, both of which are coordination outside this repository.

## Verification run so far

```bash
npm run build
npm test                        # 48 files, 883 tests, pass
npm run docs:check              # all relative links resolve
npm run check:release-consistency
```

`npm pack --dry-run` alone is not evidence that public exports work; the packed
tarball suite in `tests/package/*` is what exercises them, and the external run
in open gate 2 is what would prove interoperability.

## Decisions worth recording

- **The reference server's Answer references are injected, not derived inside
  the serializer.** `serialize()` receives only the record, so an entity URL —
  which depends on `baseUrl` and the route configuration — is built in the
  composition layer and passed in. Deriving it inside the serializer would have
  hardcoded the default route convention into a resource that must work under
  both route configurations.
- **`extensions` guards run before the value's prototype is read.**
  `Object.getPrototypeOf(null)` throws a raw `TypeError`, which would escape the
  server's fail-closed contract as a generic 500 instead of a resource-scoped
  `upstream_unavailable`. TypeScript forbids `null` there; a JavaScript resource
  adapter can still produce it.
- **Resolution context binding shipped in `1.3.1`, not here.** The 1.4.0 plan
  originally scheduled it as Phase 4 work with a narrower option set. The
  released contract is wider — `maxResponseBytes`, `timeoutMs`, `maxRedirects`,
  `retry` and `onBeforeAttempt` are all part of the context — and it is the
  released one that governs. Phase 4's remaining job is to carry it into the
  shared canonical resolution layer unchanged, not to redesign it.

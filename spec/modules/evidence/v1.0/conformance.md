# AADP Evidence & Provenance Module v1.0 Conformance

## Document metadata

| Field | Value |
|---|---|
| Status | **Draft — non-normative** |
| Gate | [ADR-0010](../../../../docs/adr/0010-evidence-citation-provenance-and-security.md) must be Accepted |
| Module ID | `aadp:evidence` (proposed, not allocated) |
| Module version | `1.0` (proposed) |
| Runner | `runEvidenceConformance` (`ail-aadp/modules/evidence/v1.0`) — does not exist yet |
| Specification | [`specification.md`](specification.md) |

> **Draft.** The check IDs below are proposals and are not yet stable. Do not
> implement the runner before ADR-0010 is Accepted.

## 1. Purpose

Defines the stable check IDs, issue taxonomy and normative/advisory boundary for
Evidence `1.0` conformance. This document does NOT change the core `CHECKS`, the
Relations `RELATIONS_CHECKS` or the Answer check IDs
([ADR-0007](../../../../docs/adr/0007-module-versioning-and-discovery.md),
"Conformance boundary").

## 2. Check catalog

| Check ID | Group | Content | Required/Optional |
|---|---|---|---|
| `evidence.discovery` | discovery | The manifest advertises the correct `{id, version, schema}` for `aadp:evidence@1.0` | Required |
| `evidence.resource` | resource | A sample claim and evidence entity fetch successfully through the core discovery/entity flow | Required |
| `evidence.schema` | schema | The `x_evidence` wrapper passes the Evidence `1.0` schema | Required |
| `evidence.semantic` | semantic | Pure wrapper semantic invariants (including `content_checksum`) are green | Required |
| `evidence.context` | context | Entity type, `x_evidence` presence, canonical URL policy, and the **ordering** `provenance.retrieved_at <= entity.updated_at` (NOT equality) | Required |
| `evidence.graph` | graph | Claim → evidence resolves; no `not-found`/`invalid`; fan-in deduplication is correct (one evidence fetched once per walk) | Required when a sample claim exists |
| `evidence.stance` | stance | Stance/confidence semantics; a missing `confidence` is not inferred as `0`/`1` | Required |
| `evidence.provenance` | provenance | Timestamp ordering, precedence and freshness classification | Required |
| `evidence.answer_link` | integration | Answer `related_entities` to claim/evidence resolve, a claim expands to evidence (two hops), `x_answer` is unchanged | Required when a sample answer exists |
| `evidence.security` | security | Free text is inert; URL/DNS/redirect policy holds; `access` grants nothing | Required |

Each check is a pure async function over the runner's context, with no baked-in
fixture. A check that depends on a sample document is `skipped`/`inconclusive`
and **NEVER `failed`** when no sample is available — the same reasoning as the
core `ConformanceOptions.negativeTargets` and Answer.

## 3. Prerequisite chain

`evidence.resource` is a prerequisite of every check except
`evidence.discovery`. `evidence.schema` is a prerequisite of
`evidence.semantic`, `evidence.stance`, `evidence.provenance`,
`evidence.graph` and `evidence.answer_link`. A `failed`/`skipped` prerequisite
makes the dependent check `skipped` with an explanatory message rather than
letting it run.

## 4. Status taxonomy

`passed`/`failed`/`warning`/`skipped`, as in core (`CheckStatus`). `skipped`
with `inconclusive: true` means the runner reached no verdict (missing sample
URL, or the traversal budget cut the run short) — it is not evidence of
conformance. Overall status is `failed` when any check failed (or warned, under
`failOnWarning`); `inconclusive` when a check is inconclusive but none failed;
otherwise `passed`.

## 5. Dangling and `forbidden`

The "no dangling reference" gate means: a run against the reference deployment
produces no `not-found` and no `invalid` entry.

A `forbidden` entry — 401/403, or blocked by URL/DNS policy — **is always a
valid outcome and does NOT fail the gate**. This classification MUST NOT read
`source.access` ([specification.md §12](specification.md)): when a target
returns 401/403 there is no body from which to read that field.

## 6. Options boundary

The runner supports authenticated servers under the same option boundary as
Relations and Answer, and uses the same caller-owned
`RelationsTraversalBudgetState`. The report distinguishes three different
things: a **failed check**, an **unsupported module**, and a **traversal/budget
failure** — collapsing them would make an exhausted budget look like a
non-conformant deployment.

The runner MUST validate every numeric/`retry`/`now` option before issuing a
request, mirroring the preflight in the core and Answer runners, so that a
caller's misconfiguration is never recorded as a `failed` check against the
deployment.

An unsupported Evidence version is NOT a remote deployment check — a runner
cannot require a conforming server to advertise a fake version. That behaviour
is tested with a synthetic manifest/entity in the package compatibility suite: a
core-only consumer ignores `x_evidence`; an opt-in consumer reports
`unsupported_module_version` and does not fall back.

## 7. Security check scope

`evidence.security` scans free text (`statement`, `summary`, `excerpt`, `notes`,
`source.title`, `publisher.name`) for prompt-injection-shaped substrings but
does **NOT** treat their presence as a failure — such text is still valid, inert
data. The real pass condition is the absence of a crash or behaviour change,
which a static scan alone cannot prove; any substring found is reported as a
`warning`.

The check must also assert that:

- `source.url`/`publisher.url` are NOT fetched in any run;
- an evidence document with `access: authenticated` is NOT treated differently
  from a `public` one in any traversal decision or verdict;
- a run using a non-default URL policy (`allowPrivateNetwork`/custom
  `urlPolicy`) is warned about, since SSRF protection was deliberately relaxed
  for that run.

## 8. Fixture catalog (proposed)

Minimum valid fixtures: a minimal claim with one `support` ref; a claim with
`contradict` and `neutral` refs, with and without `confidence`; evidence with
`access: public` and all three timestamps; evidence with
`access: authenticated` (proving `access` changes no outcome); evidence behind a
resource `security` declaration (401/403 → `forbidden`, not dangling); evidence
whose `retrieved_at` is **earlier** than `entity.updated_at`; evidence with an
`excerpt` and a cross-plane Unicode key in the Relations `target.x_*`; an answer
referencing a claim through `related_entities`; fan-in of two claims to one
evidence; a full two-hop answer → claim → evidence; an answer pointing at both E
and C1 (C1 → E) in **both orderings**; an answer declaring the wrong
`target_type` for a target that a claim declares correctly, also in both
orderings; and a generated-summary answer with a non-empty `source_targets`.

Minimum invalid fixtures: wrong module/version/kind or an unknown field; a
missing required field; a `content_checksum` broken by mutating each normative
field group; a checksum computed with code-point ordering instead of UTF-16 code
unit ordering; `confidence` out of `[0,1]`, with more than 2 decimal places, or
as a string; `stance`/`access` outside the enum; a timestamp with the wrong
format or the wrong order, and `retrieved_at` later than the core `updated_at`;
a `target_type` other than the constant `evidence`; a duplicate canonical
target; `evidence_refs` empty or above 50; `source.url`/`publisher.url` using
HTTP, userinfo, a fragment, or malformed; a source URL pointing at a
private/link-local/reserved address; and a redirect chain into a private
address.

Fixtures use the `example.com` domain, neutral names and deterministic
timestamps. Each invalid fixture should have exactly one primary failure. The
prompt-injection fixture is **valid**, not invalid.

## 9. Report shape

`EvidenceConformanceReport`: `report_version`, `aadp_version`, `module`,
`package_version`, `base_url?`, `runner`, `started_at`/`finished_at`/
`duration_ms`, `status`, `summary`, `effective_limits`, `checks[]` — the same
shape as the Answer and Relations reports. Exit codes: `0` conformant, `1` a
check failed, `4` inconclusive.

The report MUST NOT log full private payloads or auth headers by default.

## 10. External execution

The interoperability gate MUST NOT be closed with a mock server or unit tests.
Minimum conditions (see
[implementation plan 1.4.0](../../../../docs/vi/plans/implementation-plan-v1.4.0.md),
"External conformance environment"): the reference server deployed at a real
HTTPS origin reachable from CI; `ail-aadp` installed from a packed tarball into
a clean install, public exports only; real HTTP, with no in-process handler and
no fetch mock; report JSON for **both** Answer and Evidence with overall
`passed`, stored in the implementation record; and a run on the Node engine
floor declared in `package.json`.

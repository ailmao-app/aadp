# ADR-0010: Evidence Module — citation, provenance and security boundary

## Status

**Accepted** (2026-08-09) — for Evidence & Provenance Module `1.0` and package
`ail-aadp@1.4.0`. The module ID `aadp:evidence` and version `1.0` are hereby
allocated.

The wire artifacts under `schemas/modules/evidence/v1.0/` were implemented
before this acceptance, at explicit maintainer direction, so the "decide before
freezing" protection of [ADR-0004](0004-backward-compatibility.md) and
[ADR-0007](0007-module-versioning-and-discovery.md) was spent in advance. That
window is now closed: acceptance ratified the decisions below unchanged, and
the released artifacts match them. From the `ail-aadp@1.4.0` tag onward those
schemas are immutable — any change to them requires a new module version.

The implementation and its recorded schema digests are in
[implementation record 1.4.0](../records/implementation-record-v1.4.0.md).

## Context

Answer Module `1.0` ([ADR-0009](0009-answer-module-terminology-and-security.md))
deliberately has **no** `evidence`, `claims` or `citations` field: it describes
the answer, not the grounds for the answer. That gap is the target of `1.4.0`.

Describing grounds requires three new concepts — claim (what is asserted),
evidence (what is cited), source (where the evidence came from) — and each one
brings a contract decision a schema cannot answer by itself:

- whether those three are document kinds, resource types, or nested objects;
- who owns the edge between them, what its cardinality is, and what happens when
  an edge does not resolve;
- which identity is used for deduplication when several claims cite the same
  evidence;
- which timestamp describes "the date of the evidence" when there are three;
- what `confidence` and `stance` mean, and who is allowed to recompute them;
- how private, authenticated and cross-origin sources are handled — the easiest
  place for a metadata field to accidentally become an authorization mechanism;
- how an Answer links to evidence **without** modifying the released
  `aadp:answer@1.0` artifact;
- which layer owns the canonical resolution cache when two modules walk one
  traversal budget.

The proposals below come from
[implementation plan 1.4.0](../vi/plans/implementation-plan-v1.4.0.md) after
five review rounds.

## Decision

### 1. Document kinds: `claim` and `evidence` are document kinds, `source` is nested

| Concept | Form | Reason |
|---|---|---|
| `claim` | Document kind `claim` on an entity of `type: "claim"`, carried in `x_evidence` | Referenced by many answers/claims → needs its own identity and URL |
| `evidence` | Document kind `evidence` on an entity of `type: "evidence"` | Cited by many claims → fetched independently so the payload is not duplicated |
| `source` | Object nested inside evidence | No consumer needs to resolve a source independently at `1.0`; splitting it out only adds a traversal hop |

Registry dispatch uses the exact keys `{aadp:evidence, 1.0, claim}` and
`{aadp:evidence, 1.0, evidence}`, exactly the mechanism ADR-0007 released. There
is no standalone collection kind or registry kind at `1.0`; listing continues to
use the core sitemap/resource flow.

### 2. Edges, cardinality and integrity

- The only edge is `claim.evidence_refs[]` — **the claim owns the edge**;
  evidence does not know which claims cite it.
- 1-50 references per claim. An empty array is not allowed: a claim with no
  grounds at all is not a claim in this module.
- `evidence_refs[].target_type` is the **constant `evidence`**, not a free
  token.
- A reference that fails to resolve does NOT make the claim invalid. It produces
  an entry with a status, using the released `AnswerTargetResolutionStatus`
  vocabulary (`resolved` | `forbidden` | `not-found` | `invalid` |
  `budget-exhausted`) — no new enum.
- Only `not-found` and `invalid` count as **dangling**. `forbidden` (401/403, or
  blocked by URL/DNS policy) is a valid outcome of a healthy graph, not a broken
  one.

### 3. No reverse edge — acyclic by construction

Evidence `1.0` does NOT define an evidence → claim edge. Consequently the wire
model **cannot express any cycle**, so this module has no cycle policy, no cycle
guard, no self-reference rule and no cycle fixture — not because cycles are
permitted, but because they do not exist.

Several claims pointing at one evidence is **fan-in**, not a cycle.

If a later version adds a reverse edge, that version must define the new edge's
ownership together with its cycle policy, in its own ADR.

### 4. Canonical identity and deduplication

A target's canonical identity reuses the Relations semantic identity
`{id, normalizedUrl}` exactly as released. Evidence defines no new identity
rule.

Deduplication happens at two distinct layers, and both are necessary:

- `RelationsTraversalBudgetState.visitedTargets` for **budget accounting**;
- the shared canonical outcome cache (keyed by budget) for **reusing an
  already-fetched entity**.

Within one `evidence_refs`, two elements MUST NOT share a canonical identity,
even with different `stance` values — two stances for the same evidence must be
split into two claims.

### 5. Provenance: three timestamps, one precedence rule

`published_at` and `retrieved_at` are required, `modified_at` optional; RFC 3339
UTC with a `Z` suffix, millisecond precision at most, the same profile as Answer
`1.0`.

Invariant: `published_at <= retrieved_at`, and when `modified_at` is present,
`published_at <= modified_at <= retrieved_at`.

"The date of the evidence" is `modified_at` when present, otherwise
`published_at`. `retrieved_at` describes when the producer fetched the source
and MUST NOT be used as the date of the content.

For an entity of `type: "evidence"`, the relationship to the core `updated_at`
is **ordering, not equality**: `provenance.retrieved_at <= entity.updated_at`.
This is a deliberate difference from Answer `1.0` (where
`freshness.updated_at === entity.updated_at` is right because both describe the
same event). In Evidence the two timestamps describe two independent events;
forcing them to be equal would make every correction without re-retrieval
(fixing `summary`, `locale`, `excerpt`, `publisher.name`) produce an invalid
entity, pushing producers to misstate provenance.

`publisher` is a producer assertion about where the source was published — NOT a
verified identity, NOT a signature, and not an input to any authorization
decision.

### 6. Freshness is client-computed, not publisher metadata

Evidence `1.0` has no `expires_at` field and no `freshness` field. The
`fresh`/`stale` classification is a pure client-side function with an injected
clock (`classifyEvidenceFreshness`), based on the precedence in §5. A pure
validator MUST NOT read the wall clock.

### 7. `stance` and `confidence` are assertions, not conclusions

- `stance` is the closed enum `support` | `contradict` | `neutral`, describing
  **the relationship the producer asserts between evidence and claim**, not the
  truth value of the claim.
- `neutral` means "relevant, but the producer asserts no direction" — DIFFERENT
  from the absence of a reference.
- `confidence` is a number in `[0, 1]` with at most 2 decimal places, declared by
  the producer. It has no statistical unit, is not comparable across publishers,
  and clients in this package MUST NOT recompute or aggregate it into a score.
- A missing `confidence` means "not declared" — not `0`, not `1`.
- A validator MUST NOT infer stance from free text and MUST NOT language-detect.

Schema validity of an Evidence document MUST NOT be interpreted as factual
truth, authenticity or legal validity. This module does no fact-checking, no
ranking, no trust scoring and no publisher reputation.

### 8. `source.access` is presentation metadata, NOT authorization

`source.access` (`public` | `authenticated` | `restricted`) is a producer
assertion about the **source outside AADP** — something `1.0` never fetches. It
MUST NOT take part in any traversal, authorization or conformance decision. Its
only valid role is presentation: telling a reader whether the source is behind a
paywall or a login.

Two reasons it cannot be an authorization input:

1. it describes a source URL nested inside the evidence, not the security of the
   AADP evidence resource itself;
2. when a target returns 401/403 the client has **no body** from which to read
   `source.access` — the value does not exist at the moment classification needs
   it.

Authorization of the evidence resource is decided by core/Relations
authorization and the manifest `security` declaration. Every 401/403 is
`forbidden`, independent of `source.access`.

### 9. Answer integration does not modify `aadp:answer@1.0`

Answer `1.0` is a released immutable contract whose wrapper has no extension
point. Therefore:

- an Answer links to claims/evidence **only through the existing
  `related_entities`**, with `target_type` of `claim` or `evidence`;
- `authorship.source_targets` MUST NOT be used: that field narrowly means the
  input sources of a generated summary, and forcing citation meaning onto it
  would misstate provenance;
- integration adds helpers and conformance checks **at the Evidence layer only**;
  `AnswerValidationResult`, `AnswerEntityValidationResult` and the set of valid
  Answer `1.0` payloads do not change;
- adding a citation field to Answer would require releasing `aadp:answer@1.1` or
  `2.0` — NOT editing the `1.0` artifact.

### 10. Composition: a shared canonical resolution layer, internal

`resolveAnswerTargets` keeps per-budget resolution state
(`WeakMap<budget, BudgetResolutionState>`) with canonical outcomes, in-flight
joins and budget-stop replay. That state is **shared infrastructure, not an
Answer-private detail**: a canonical key the Answer resolver has never touched —
charged, say, by a raw Relations step on the same budget — is reported as
`invalid`. If Evidence resolved through the Relations resolver on a shared
budget, it would itself manufacture false `invalid` results for Answer.

Decision: **extract that layer into a shared internal layer keyed by budget**
(`src/modules/shared/canonical-resolution.ts`), refactor Answer to consume it,
and have Evidence use exactly that layer for every fetch.

- This layer MUST NOT be exported from any public subpath — the same reason
  Relations keeps `releaseNode` module-internal: its precondition cannot be
  checked from outside.
- For Answer this is a **pure refactor**, patch-level under ADR-0007: public
  API, wire contract and normative semantic results are unchanged. The
  regression proof is that every existing Answer test passes without a single
  line changed.
- The cache stores the **canonical outcome** (the fetch/schema/checksum result
  for a target), NOT a per-reference verdict. The `target_type` verdict is
  recomputed per occurrence, so a reference declaring the wrong type cannot
  poison another reference pointing at the same target.

Three alternatives are rejected: adding a selector to `resolveAnswerTargets`
changes Answer's public API; building a synthetic Answer document to bypass its
collection step would produce a document with an invalid schema/checksum; and
reimplementing the orchestration duplicates the network stack.

### 11. Resolution context: inherit the contract released in `1.3.1`

The rule "one budget = one immutable request context, mismatch fails closed with
`AadpClientError` and `code: "resolution_context_mismatch"`" **was released in
`1.3.1`** as a security fix to the Answer client. This ADR does NOT redefine it;
it only settles that the shared canonical resolution layer inherits that
contract intact, and that Evidence has no entry point which bypasses the check.

## Consequences

- Evidence can ship without touching the `aadp:answer@1.0` or
  `aadp:relations@1.0` artifacts; existing Answer consumers see no difference.
- There is no cycle machinery to write, test or audit — because the model cannot
  express a cycle. In exchange, adding a reverse edge later is a large decision
  requiring its own ADR, not a minor bump.
- Producers compute one extra digest (`content_checksum`) for `x_evidence`, but
  it reuses the released `checksumOf()` in full — no new algorithm to audit.
- The Answer client is refactored to consume the shared layer. The blast radius
  is large even though the public API does not change, so the existing Answer
  test suite becomes a mandatory regression gate that MUST NOT be edited to make
  the refactor pass.
- `source.access` will look like a security field to a skimming reader. That
  risk is acknowledged and paid for in documentation: the specification, the
  schema description and the `evidence.security` conformance check all state
  explicitly that it grants nothing.
- If a later version adds a retrieval API for sources, `access` gains a further
  role — and that role must be defined by a new ADR.

## References

- [ADR-0001](0001-checksum-algorithm.md) (checksum and canonical JSON),
  [ADR-0004](0004-backward-compatibility.md) (immutability),
  [ADR-0007](0007-module-versioning-and-discovery.md) (module versioning),
  [ADR-0008](0008-module-traversal-and-authorization.md) (traversal budget and
  authorization),
  [ADR-0009](0009-answer-module-terminology-and-security.md) (Answer/Evidence
  boundary).
- [`docs/vi/plans/implementation-plan-v1.4.0.md`](../vi/plans/implementation-plan-v1.4.0.md)
  — the implementation plan and the source of every decision above.
- [`docs/vi/plans/implementation-plan-v1.3.1.md`](../vi/plans/implementation-plan-v1.3.1.md)
  — the released resolution context binding.
- `spec/modules/evidence/v1.0/specification.md`,
  `spec/modules/evidence/v1.0/conformance.md` (drafts, pending acceptance of
  this ADR).

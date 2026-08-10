# AADP Evidence & Provenance Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | **Normative** |
| Gate | [ADR-0010](../../../../docs/adr/0010-evidence-citation-provenance-and-security.md) Accepted 2026-08-09 |
| Module ID | `aadp:evidence` (allocated) |
| Module version | `1.0` |
| Core compatibility | AADP `1.0` |
| Relations compatibility | `aadp:relations@1.0` |
| Answer compatibility | `aadp:answer@1.0`, unmodified |
| Package target | `ail-aadp@1.4.0` |

> **Normative.** ADR-0010 was Accepted on 2026-08-09, ratifying every decision
> below unchanged, so this document is normative and the module ID and version
> are allocated. Uppercase BCP 14 keywords carry their normative meaning.
>
> The implementation — `schemas/modules/evidence/v1.0/*`,
> `src/modules/evidence/v1.0/**` and the conformance runner — was built before
> that acceptance at explicit maintainer direction, and matches this document.
> Its schema digests are recorded in
> [implementation record 1.4.0](../../../../docs/records/implementation-record-v1.4.0.md).
> From the `ail-aadp@1.4.0` tag onward those artifacts are immutable under
> [ADR-0004](../../../../docs/adr/0004-backward-compatibility.md) and
> [ADR-0007](../../../../docs/adr/0007-module-versioning-and-discovery.md).

## Abstract

This document defines the wire contract for Evidence & Provenance Module v1.0.
The module describes a **claim** (what is asserted), **evidence** (what is
cited) and a **source** (where the evidence came from), together with the
reference relationship between claim and evidence, provenance timestamps, and
the stance and confidence declared by the producer. Uppercase BCP 14 keywords
carry their normative meaning.

## 1. Scope

The module defines discovery, `x_evidence`, the claim and evidence document
kinds, the source object, provenance, stance/confidence, `content_checksum`,
graph traversal, validation and conformance.

The module does NOT define, and MUST NOT be interpreted as defining: factual
truth, authenticity, legal validity, fact-checking, ranking, trust scores,
publisher reputation, digital signatures or identity verification. **Schema
validity MUST NOT be interpreted as any of those.**

The module does not fetch URLs found in free text or in source metadata, does
not add fields to the core v1.0 schemas, Relations `1.0` or Answer `1.0`, and
does not define general cross-module graph composition (that belongs to
`1.5.0`).

## 2. Discovery and compatibility

```json
{
  "id": "aadp:evidence",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/evidence/v1.0/module.schema.json"
}
```

A server MUST advertise the module only once its resources and schema artifacts
are actually deployed. A core-only client MUST ignore the declaration and
`x_evidence`. An Evidence client MUST exact-match the ID and version, and MUST
NOT fall back to another version.

Public API and schema paths:

```text
ail-aadp/modules/evidence/v1.0
ail-aadp/schemas/modules/evidence/v1.0/*
```

The package does not re-export the Evidence API from its root.

## 3. Document kinds

Evidence `1.0` has exactly two top-level module document kinds:

| Kind | Entity type | Location |
|---|---|---|
| `claim` | `claim` | `entity.x_evidence` |
| `evidence` | `evidence` | `entity.x_evidence` |

`source` is NOT a document kind — it is an object nested inside an evidence
document. There is no standalone collection kind or registry kind at `1.0`;
listing and pagination use the core sitemap/resource flow.

Registry dispatch uses the exact keys `{aadp:evidence, 1.0, claim}` and
`{aadp:evidence, 1.0, evidence}` (ADR-0007).

## 4. Wire boundary

Claim entity (**non-normative** example; the digest MUST be produced by
`checksumOf()`, never copied by hand):

```json
{
  "aadp_version": "1.0",
  "id": "claim:orbit-uptime-2026",
  "type": "claim",
  "checksum": "sha256:<generated>",
  "updated_at": "2026-08-06T09:00:00Z",
  "canonical_url": "https://example.com/claims/orbit-uptime-2026",
  "data": {},
  "x_evidence": {
    "module": "aadp:evidence",
    "version": "1.0",
    "kind": "claim",
    "statement": "Orbit reported 99.9% uptime in 2026.",
    "locale": "en",
    "evidence_refs": [
      {
        "target_type": "evidence",
        "target": {
          "id": "evidence:orbit-status-report-2026",
          "url": "https://example.com/ai/v1.0/entities/evidence/orbit-status-report-2026.json"
        },
        "stance": "support",
        "confidence": 0.8
      }
    ],
    "content_checksum": "sha256:<generated>"
  }
}
```

Evidence wrapper:

```json
{
  "module": "aadp:evidence",
  "version": "1.0",
  "kind": "evidence",
  "summary": "Annual status report published by Example Orbit.",
  "locale": "en",
  "source": {
    "title": "Orbit 2026 Status Report",
    "url": "https://example.com/reports/2026-status",
    "publisher": { "name": "Example Orbit" },
    "access": "public"
  },
  "provenance": {
    "published_at": "2026-01-15T00:00:00Z",
    "retrieved_at": "2026-08-01T09:00:00Z"
  },
  "content_checksum": "sha256:<generated>"
}
```

## 5. Field contract

Every object Evidence defines is closed with `additionalProperties: false`; the
wrapper has NO `x_*` extension point at `1.0`. The `target` object is `$ref`'d
from Relations `1.0` and keeps the Relations `x_*` extension point.

### 5.1 Claim document

| Field | Required | Contract |
|---|---:|---|
| `module` | Yes | Constant `aadp:evidence` |
| `version` | Yes | Constant `1.0` |
| `kind` | Yes | Constant `claim` |
| `statement` | Yes | Trimmed string, 1-1,000 Unicode code points |
| `locale` | Yes | The same deterministic BCP 47 profile as Answer `1.0` (§6) |
| `evidence_refs` | Yes | 1-50 evidence references (§7), no duplicate canonical target |
| `content_checksum` | Yes | `sha256:<64 hex>` per §9 |
| `notes` | No | Untrusted text, 1-1,000 code points, no normative effect |

### 5.2 Evidence document

| Field | Required | Contract |
|---|---:|---|
| `module` / `version` | Yes | Constant `aadp:evidence` / `1.0` |
| `kind` | Yes | Constant `evidence` |
| `summary` | Yes | Trimmed string, 1-1,000 Unicode code points |
| `locale` | Yes | The same profile as Answer `1.0` |
| `source` | Yes | Source object (§5.3) |
| `provenance` | Yes | Timestamp provenance (§8) |
| `content_checksum` | Yes | `sha256:<64 hex>` per §9 |
| `excerpt` | No | Verbatim quotation, 1-2,000 code points |

### 5.3 Source object

| Field | Required | Contract |
|---|---:|---|
| `title` | Yes | 1-500 code points |
| `url` | Yes | Absolute HTTPS, no userinfo, no fragment |
| `publisher.name` | Yes | 1-200 code points |
| `publisher.url` | No | Absolute HTTPS, no userinfo, no fragment |
| `access` | Yes | Enum `public` \| `authenticated` \| `restricted` (§12) |

`statement`, `summary`, `excerpt`, `notes`, `source.title` and `publisher.name`
are all untrusted text (§13).

## 6. Locale contract

Evidence `1.0` uses **the same** deterministic BCP 47 profile as Answer `1.0`,
enforced identically by the schema and the pure semantic validator. This module
defines no new profile and does not language-detect content.

## 7. Evidence reference contract

The component `evidence-reference.schema.json` has exactly four fields:

| Field | Required | Contract |
|---|---:|---|
| `target_type` | Yes | **Constant `evidence`** |
| `target` | Yes | `$ref` to the Relations `1.0` target |
| `stance` | Yes | Enum `support` \| `contradict` \| `neutral` |
| `confidence` | No | Number in `[0, 1]`, at most 2 decimal places |

Rules:

- A target's canonical identity reuses the Relations semantic identity
  `{id, normalizedUrl}` exactly as released; this module defines no new identity
  rule.
- Within one `evidence_refs`, two elements MUST NOT share a canonical identity,
  even with different `stance` values. Two stances for the same evidence must be
  split into two claims.
- `stance` is a producer assertion about the relationship between evidence and
  claim, NOT a conclusion about truth value. `neutral` means "relevant, but the
  producer asserts no direction", which is DIFFERENT from the absence of a
  reference.
- `confidence` is declared by the producer, has no statistical unit and is not
  comparable across publishers. Clients in this package MUST NOT recompute or
  aggregate it into a score. A missing `confidence` means "not declared" — not
  `0`, not `1`.

### 7.1 Acyclic by construction

`target_type` is a constant, so a claim cannot point at another claim or at
itself; an evidence document has no field pointing back at a claim; and
`source.url` is metadata that is never traversed.

The `1.0` wire model therefore **cannot express any cycle**. This module has no
cycle policy, no cycle guard, no self-reference rule and no cycle conformance
check. Several claims pointing at one evidence is **fan-in**, handled by
deduplication (§10).

## 8. Provenance contract

```json
{
  "published_at": "2026-01-15T00:00:00Z",
  "retrieved_at": "2026-08-01T09:00:00Z",
  "modified_at": "2026-03-02T00:00:00Z"
}
```

- RFC 3339 UTC with a `Z` suffix, millisecond precision at most — the same rule
  as Answer `1.0`.
- `published_at` and `retrieved_at` are required; `modified_at` is optional.
- Invariant: `published_at <= retrieved_at`; when `modified_at` is present,
  `published_at <= modified_at <= retrieved_at`.
- **Precedence**: "the date of the evidence" is `modified_at` when present,
  otherwise `published_at`. `retrieved_at` MUST NOT be used as the date of the
  content.
- For an entity of `type: "evidence"`:
  `provenance.retrieved_at <= entity.updated_at` — **ordering, NOT equality**
  (§11 and ADR-0010 §5).
- `publisher` is a producer assertion, not a verified identity.

## 9. Content checksum contract

`content_checksum` reuses
[ADR-0001](../../../../docs/adr/0001-checksum-algorithm.md) and the public
`ail-aadp/canonical-json` exactly as released:
`checksumOf(wrapper_minus_content_checksum)`, RFC 8785 JCS, keys sorted by
UTF-16 code unit value. Evidence defines no new canonicalization rule; only the
input scope differs (`x_evidence`).

The hash scope covers every normative field of the wrapper, including the
Relations `target.x_*` nested inside `evidence_refs`. The core `checksum` still
covers `data` only; a valid Evidence entity MUST pass both.

`content_checksum` only detects tampering within the hash scope. It is NOT a
signature, does NOT prove the producer is honest, and does NOT replace TLS.

## 10. Graph and traversal contract

### 10.1 Reference resolution requirement

| Reference | Must resolve? | Note |
|---|---|---|
| `claim.evidence_refs[]` | Yes, when the caller opts into traversal | Unresolved → an entry with a status, never a throw |
| `answer.related_entities[]` with `target_type` claim/evidence | Only when the caller invokes the Evidence helper | Answer `1.0` behaviour is unchanged otherwise |
| `evidence.source.url` | NO | Metadata; a validator/client MUST NOT fetch it |
| `evidence.source.publisher.url` | NO | Metadata |

### 10.2 Status vocabulary and dangling

The vocabulary reuses `AnswerTargetResolutionStatus` as released; no new enum.

| Outcome | Status | Dangling? |
|---|---|---|
| 200 + valid entity | `resolved` | No |
| 404/410 | `not-found` | **Yes** |
| 200 but schema/semantically invalid, or the wrong `target_type` | `invalid` | **Yes** |
| 401/403 | `forbidden` | No — access control, not a broken graph |
| Blocked by URL/DNS policy | `forbidden` | No |
| Budget exhausted or aborted | `budget-exhausted` | No — partial result |

`source.access` MUST NOT take part in this classification (§12).

### 10.3 Budget

Traversal uses the caller-owned `RelationsTraversalBudgetState` as is, with the
six dimensions released in
[ADR-0008](../../../../docs/adr/0008-module-traversal-and-authorization.md).
Evidence MUST NOT create a child budget, MUST NOT raise the defaults and MUST
NOT add a new dimension. Depth is charged along the edges answer → claim →
evidence (evidence is a leaf, at most two edges from an answer). Nodes are
charged through `chargeNode` so deduplication shares `visitedTargets`.

### 10.4 Two-layer deduplication

- `visitedTargets` for **budget accounting**;
- the shared canonical outcome cache, keyed by budget, for **reusing an
  already-fetched entity**.

Both use the canonical key `{id, normalizedUrl}`, and both are necessary. The
cache stores the **canonical outcome**, NOT a per-reference verdict: the
`target_type` verdict is recomputed per occurrence, so a reference declaring the
wrong type cannot poison another reference pointing at the same target.

### 10.5 Traversal result

The result is an `EvidenceGraph` with:

- `nodes[]` — exactly one node per canonical target; `status` describes only the
  fetch/schema/checksum outcome for that target. Discovery order, never
  re-sorted.
- `references[]` — one entry per occurrence in `answer.related_entities`, each
  with its own verdict and its original index.
- `edges[]` — one entry per occurrence in `claim.evidence_refs`, each with its
  own verdict, ordered by (claim discovery index, ref index).
- `partial` — true when the walk stopped before every reference was attempted.

A node that could not be resolved still appears in `nodes`; an edge or reference
entry always exists when the wire has a ref, so a consumer can distinguish "no
ref" from "a ref whose fetch failed". Every reference after the stopping point
appears with status `budget-exhausted`, never silently dropped.

The `AbortSignal` is supplied by the caller; an abort produces a partial result.
The module adds no retry layer beyond the existing HTTP policy.

## 11. Validation boundary

**JSON Schema** is responsible for: required fields, constants, closed objects,
the `stance`/`access` enums, string and array bounds, URL and timestamp shape,
the confidence range, and the evidence reference shape (target via the Relations
`$ref`).

The schema does NOT check: timestamp ordering, duplicate semantic targets,
`content_checksum`, or the ordering relationship with the core `updated_at`.

**The pure wrapper semantic validator** (registry keys
`{aadp:evidence, 1.0, claim}` and `{aadp:evidence, 1.0, evidence}`) receives the
wrapper only; it MUST NOT receive entity context, MUST NOT fetch over the
network, MUST NOT read the system clock and MUST NOT mutate its input. It
checks: module/version/kind consistency; Unicode code-point bounds after
trimming; the locale profile; timestamp ordering and precedence; confidence
range and precision; duplicate targets by Relations semantic identity; and
`content_checksum` against a recomputed digest.

The validator has no self-reference rule: the constant `target_type` already
rules out claim → claim at the schema layer, and a pure validator has no entity
context with which to know the document's own id.

**The entity-context validator** `validateEvidenceEntityV1(entity)`:

1. Validate the core entity v1.0.
2. Require `entity.type` to match the kind (`claim` or `evidence`), an
   `x_evidence` object, and `entity.canonical_url`.
3. Validate `entity.canonical_url` with the URL-policy helper shared with
   `source.url` (absolute HTTPS, no userinfo, no fragment).
4. Dispatch `x_evidence` through the exact registry key.
5. For kind `evidence`: require
   `provenance.retrieved_at <= entity.updated_at`.
6. Return a typed validated entity or a structured validation result.

`parseEvidenceEntityV1` is a throwing convenience wrapper and duplicates no
rules.

Advisory (never a semantic error): whether the claim is true; whether the
evidence genuinely supports or contradicts the claim; whether the publisher is
trustworthy; whether the source still exists.

Issue codes are stable with the prefix `evidence.semantic.*`; message text is
not a stable API.

## 12. `source.access` is not authorization

`access` is a producer assertion about the **source outside AADP** — something
`1.0` never fetches. It MUST NOT take part in any traversal, authorization or
conformance decision; its only valid role is presentation.

Authorization of the evidence entity itself is decided by core/Relations
authorization and the manifest `security` declaration. Every 401/403 on a target
is `forbidden`, independent of `access` — and when a target returns 401/403 the
client has no body from which to read `access` at all.

## 13. Security and privacy contract

- All free text is untrusted data; the package MUST NOT interpolate it into a
  system prompt, shell, HTML or executable template, and MUST NOT parse
  instructions out of it.
- `source.url`, `publisher.url` and `entity.canonical_url` are metadata and MUST
  NOT be fetched by a validator or client. Only targets inside `evidence_refs`
  and `related_entities` are fetched, and only through the Relations URL/DNS
  policy when the caller opts in.
- Redirect, DNS rebinding, private/link-local/reserved address and credential
  leak behaviour are inherited from the existing policy; Evidence has NO
  networking bypass.
- Authorization is checked before a claim, evidence document or target is
  returned.
- One budget = one immutable resolution context; the canonical outcome cache and
  in-flight requests MUST NOT be shared between calls with different contexts.
  A mismatch fails closed with `AadpClientError`
  (`code: "resolution_context_mismatch"`), per the contract released in `1.3.1`.
- Conformance output MUST NOT log full private payloads or auth headers by
  default.
- Stance, confidence and publisher are producer assertions; schema validity does
  not prove them truthful.

## 14. Freshness

Freshness is a **client-computed classification**, not publisher metadata.
Evidence `1.0` has no `expires_at` field and no `freshness` field.
`classifyEvidenceFreshness(evidence, now, maxAgeMs)` is a pure helper with an
injected clock, classifying `fresh` | `stale` by the precedence in §8.

## 15. Answer integration

Answer `1.0` is a released immutable contract. Therefore:

- An Answer links to claims/evidence **only through `related_entities`**, with
  `target_type` of `claim` or `evidence`. It MUST NOT use
  `authorship.source_targets`.
- The helper `resolveAnswerEvidenceV1(answer, options)` filters
  `related_entities`, resolves them through the shared canonical resolution
  layer, validates each entity, **and then expands the `evidence_refs` of every
  resolved claim** on the same budget.
- The helper MUST NOT call `resolveAnswerTargets` — that function always
  collects `authorship.source_targets` as well, which is out of scope for
  Evidence. Verifiable consequence: a generated-summary Answer passed through
  `resolveAnswerEvidenceV1` MUST NOT produce any request to
  `authorship.source_targets`.
- Integration MUST NOT change `AnswerValidationResult`,
  `AnswerEntityValidationResult` or the set of valid Answer `1.0` payloads.

## 16. Layer boundary

```text
core discovery/entity validation
        ↓
module registry ──► Evidence schema + pure semantic validator
        ↓
Evidence entity validator/client ──► shared canonical resolution (internal)
                                     ──► Relations resolver + shared budget
        ↓
application citation/editorial policy (outside the package)
```

The shared canonical resolution layer is **internal**: it MUST NOT appear in any
public subpath of Answer, Relations or Evidence. Networking, URL/DNS,
authorization, scheduling and budget remain owned by core/Relations.

## 17. Typed API

```ts
export type EvidenceClaimDocumentV1;
export type EvidenceDocumentV1;
export type EvidenceSourceV1;
export type EvidenceProvenanceV1;
export type EvidenceReferenceV1;
export type EvidenceStanceV1 = "support" | "contradict" | "neutral";
export type EvidenceAccessV1 = "public" | "authenticated" | "restricted";
export type ValidatedEvidenceEntityV1;
export type EvidenceValidationIssue;
export type EvidenceValidationResult;
export type EvidenceEntityValidationResult;
export type EvidenceClientOptions;
export type EvidenceResolveOptions;
export type EvidenceNodeKindV1 = "claim" | "evidence";
export type EvidenceGraphNode;
export type EvidenceGraphReference;
export type EvidenceGraphEdge;
export type EvidenceGraph;
export type EvidenceFreshnessState = "fresh" | "stale";
export type EvidenceConformanceOptions;
export type EvidenceConformanceReport;

export function registerEvidenceModule(): void;
export function validateEvidenceV1(document: unknown): EvidenceValidationResult;
export function validateEvidenceEntityV1(entity: unknown): EvidenceEntityValidationResult;
export function parseEvidenceEntityV1(entity: unknown): ValidatedEvidenceEntityV1;
export function fetchEvidenceEntityV1(
  url: string,
  options: EvidenceClientOptions,
  budget: RelationsTraversalBudgetState,
): Promise<ValidatedEvidenceEntityV1>;
export function resolveClaimEvidenceV1(
  claim: EvidenceClaimDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function resolveAnswerEvidenceV1(
  answer: AnswerDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function classifyEvidenceFreshness(
  evidence: EvidenceDocumentV1,
  now: Date,
  maxAgeMs: number,
): EvidenceFreshnessState;
export function runEvidenceConformance(
  options: EvidenceConformanceOptions,
): Promise<EvidenceConformanceReport>;
```

Both resolvers take `options.budget` exactly like Answer `1.0` — there is no
separate state parameter. The canonical outcome cache is keyed by that budget in
the internal layer, so there is nothing for a caller to forget to pass and no
ownership question for nested or concurrent calls.

## 18. Schema and artifact inventory

```text
schemas/modules/evidence/v1.0/
├── module.schema.json
├── claim.schema.json
├── evidence.schema.json
├── evidence-reference.schema.json
├── source.schema.json
└── provenance.schema.json

spec/modules/evidence/v1.0/
├── specification.md
└── conformance.md

src/modules/evidence/v1.0/
├── types.ts, schemas.ts, semantic.ts, register.ts, entity.ts, index.ts
├── client/ (types, errors, fetch, freshness, resolve, index)
└── conformance/ (types, checks, report, runner, index)
```

Every file above exists as of `1.4.0`, with `entity.ts` carrying the
entity-context validator.

## 19. Compatibility

- Evidence `1.0` is the first normative wire version; there is no `0.1`.
- A patch only fixes documentation or implementation bugs without changing the
  payload schema or normative semantic results. A minor only adds
  backward-compatible optional contract. A major covers incompatible changes to
  fields, references or provenance semantics.
- A client MUST NOT fall back to another Evidence version when the exact version
  is unsupported; an opt-in consumer reports `unsupported_module_version`.
- A core-only consumer safely ignores `x_evidence` and the module discovery
  entry.
- Adding a reverse evidence → claim edge is a model change requiring its own ADR
  — not a minor bump.

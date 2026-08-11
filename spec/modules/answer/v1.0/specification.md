# AADP Answer Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:answer` |
| Module version | `1.0` |
| Core compatibility | AADP `1.0` |
| Relations compatibility | `aadp:relations@1.0` |
| Package target | `ail-aadp@1.3.0` |

## Abstract

This document defines the normative wire contract for Answer Module v1.0. The
module describes an answer entity's question, concise answer, extended content,
applicability, locale, freshness and related entities, distinguishing — by data,
never by inference — between content written by a source (`source-authored`) and
an automatically generated summary (`generated-summary`). Uppercase BCP 14
keywords carry their normative meaning.

## 1. Scope

The module defines discovery, `x_answer`, authorship, freshness, applicability,
answer entity references, `content_checksum`, validation and conformance. The
module does NOT define content generation, ranking/search scores, AEO/GEO
scores, factual-truth evaluation, or an evidence/claim/citation graph — those
concerns belong to the Evidence & Provenance Module `1.4.0` or to the
application layer.

## 2. Discovery and compatibility

```json
{
  "id": "aadp:answer",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json"
}
```

A server MUST advertise the module only once its payloads, endpoints/resources
and conformance artifacts are deployed. A core-only client MUST ignore the
declaration and `x_answer`. An Answer client MUST exact-match the ID and
version, and MUST NOT fall back to another version. The `schema` field points at
the dispatch schema for the `answer` document; the discovery entry itself is
validated by the core manifest schema v1.0, not by that schema.

Public API and schema paths:

```text
ail-aadp/modules/answer/v1.0
ail-aadp/schemas/modules/answer/v1.0/*
```

The package does NOT re-export the Answer API from its root; a tarball or
clean-install consumer does NOT import `src/**`.

## 3. Document kind

Answer `1.0` has exactly one top-level module document kind: `answer` — the
value of `entity.x_answer` on an entity of `type: "answer"`. There is no
standalone collection kind, registry kind or alternate-question document;
listing and pagination of answer resources use the core sitemap/resource flow.

## 4. Wire boundary

The Answer payload lives at the `x_answer` extension on the root of a core
entity of `type: "answer"`. The application's `data` contains NO protocol
fields, and the core entity schema v1.0 is NOT modified.

```json
{
  "aadp_version": "1.0",
  "id": "answer:what-is-orbit",
  "type": "answer",
  "checksum": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "updated_at": "2026-08-06T09:00:00Z",
  "canonical_url": "https://example.com/answers/what-is-orbit",
  "data": {},
  "x_answer": {
    "module": "aadp:answer",
    "version": "1.0",
    "kind": "answer",
    "question": "What is Orbit?",
    "concise_answer": "Orbit is a neutral example service.",
    "locale": "en",
    "authorship": {
      "kind": "source-authored",
      "author": { "name": "Example Editorial Team", "url": "https://example.com/editorial" }
    },
    "freshness": {
      "published_at": "2026-08-01T09:00:00Z",
      "updated_at": "2026-08-06T09:00:00Z",
      "reviewed_at": "2026-08-06T09:00:00Z"
    },
    "content_checksum": "sha256:690084f26171fcc883f2ac0b9987b2511b5b9a3d21faab90ca0bdebe660bc622",
    "applicability": { "audiences": ["general"], "jurisdictions": ["001"] },
    "related_entities": [
      { "target_type": "service", "target": { "id": "service:orbit", "url": "https://example.com/ai/v1.0/entities/service/orbit.json" } }
    ]
  }
}
```

The example above is a valid vector: both `checksum` (core, over `data = {}`)
and `x_answer.content_checksum` are computed with the public `checksumOf()`
(`ail-aadp/canonical-json`) over exactly the payload shown. The fixture
`tests/fixtures/answer/v1.0/valid/answer-valid-wire-example.json` is generated
by a script that reproduces this example; the digests are never copied by hand.

The core checksum covers `data` only; since every normative Answer field lives
in `x_answer`, the Answer Module adds `x_answer.content_checksum` as a dedicated
integrity digest for that scope (§8).

## 5. Field contract

Every object the Answer Module defines is closed with
`additionalProperties: false`; there is NO `x_*` extension point at the wrapper
level (unlike Relations `1.0`). The `target` object, `$ref`'d from Relations,
keeps the Relations `1.0` `x_*` extension point.

| Field | Required | Contract |
|---|---:|---|
| `module` | Yes | Constant `aadp:answer` |
| `version` | Yes | Constant `1.0` |
| `kind` | Yes | Constant `answer` |
| `question` | Yes | Trimmed string, 1-500 Unicode code points |
| `concise_answer` | Yes | Trimmed string, 1-500 Unicode code points |
| `answer` | No | Trimmed string, 1-20,000 Unicode code points |
| `locale` | Yes | Canonical BCP 47 profile (§6), at most 63 characters |
| `authorship` | Yes | Tagged union of `source-authored` or `generated-summary` (§7) |
| `freshness` | Yes | Timestamp provenance and optional expiry (§9) |
| `content_checksum` | Yes | `sha256:<64 hex>` digest per §8 |
| `applicability` | No | Audience/jurisdiction/time applicability (§10) |
| `related_entities` | No | 0-50 Answer entity references (§11), no duplicate canonical target |

`x_answer` has NO `canonical_url` field of its own — see §12. The alias
`short_answer` is NOT supported; the official term is `concise_answer`.

`question`, `concise_answer`, `answer`, author names and applicability notes are
all untrusted text. The package does NOT render, execute or interpolate them
into a prompt, parse HTML/Markdown instructions out of them, or dereference URLs
found in them (§14).

## 6. Locale contract

Answer `1.0` uses a restricted, deterministic BCP 47 profile:

```text
language = 2-3 lowercase ASCII letters
script   = optional, 4 ASCII letters in Title Case
region   = optional, 2 uppercase ASCII letters or 3 digits
variant  = zero or more subtags: 5-8 lowercase alphanumerics,
           or one digit followed by 3 lowercase alphanumerics
```

The normative regex (exported as `ANSWER_LOCALE_PATTERN`):

```text
^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|[0-9]{3}))?(-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*$
```

Valid examples: `vi`, `en`, `en-US`, `zh-Hant`, `zh-Hant-TW`. Underscores,
extension singletons, private-use and grandfathered tags, and casing outside the
profile are rejected, even where a general BCP 47 implementation would
understand them. The schema and the pure helper (`isValidAnswerLocale`) use the
same grammar; validity is never decided by `Intl`, the OS locale, an ICU version
or a network registry. Locale describes only the answer's primary language; the
validator does not language-detect free text.

## 7. Authorship contract

`authorship` uses the discriminator `kind`; the two branches are mutually
exclusive and each object is closed.

**`source-authored`**: `author.name` is required (1-200 code points);
`author.url` is optional, absolute HTTPS, no userinfo or fragment (§13 URL
policy). This branch has no `generator`, `generated_at` or `source_targets`.

**`generated-summary`**: `generator.name`, `generated_at` and 1-20
`source_targets` are required; `generator.version` and `reviewed_by` are
optional. Each `source_targets[]` is an Answer entity reference (§11); it
denotes an input source only, and proves nothing about factual truth, support or
citation validity. `reviewed_by` does NOT change `kind` — generated content that
has been reviewed by a human is still `generated-summary`, preserving
provenance. A client MUST NOT infer source-authored from missing metadata, and
MUST NOT change the kind after fetching a target.

## 8. Content checksum contract

`content_checksum` is a `sha256:<64 lowercase hex>` digest protecting every
normative field of `x_answer`, independent of the core checksum (which covers
`data` only).

- Hash scope: `x_answer` with the `content_checksum` field itself removed. Every
  remaining field is in scope, including the Relations `target.x_*` extensions
  nested inside `related_entities`/`source_targets`.
- Canonicalization and algorithm reuse ADR-0001 and `ail-aadp/canonical-json`
  (`canonicalize()`/`checksumOf()`) exactly as released: RFC 8785 JCS, keys
  sorted by UTF-16 code unit value (not by Unicode code point), input outside the
  JSON/I-JSON domain rejected.
- `content_checksum = checksumOf(x_answer minus content_checksum)`. The producer
  computes it once the other fields are final, before publishing; the client
  recomputes it during validation.
- The pure wrapper semantic validator
  (`validateAnswerV1`/`checkAnswerSemantics`) recomputes the digest and rejects a
  mismatch with the code `answer.semantic.content_checksum_mismatch`.
- This is in addition to, not a replacement for, the core checksum. A valid
  Answer entity must pass both. `content_checksum` is not a signature against a
  dishonest producer and does not replace transport integrity (TLS).

## 9. Freshness contract

- `published_at` and `updated_at` are required; `reviewed_at` and `expires_at`
  are optional. Timestamps use RFC 3339 UTC with a `Z` suffix, millisecond
  precision at most.
- Invariants: `published_at <= updated_at`; when `reviewed_at` is present,
  `published_at <= reviewed_at`; when `expires_at` is present, every other
  timestamp must be `<= expires_at`.
- `x_answer.freshness.updated_at` MUST equal the core entity's `updated_at` —
  this invariant belongs to the entity-context validator (§15), not to the
  wrapper semantic validator.
- An expired answer is still schema-valid. The client helper
  (`classifyAnswerFreshness`) classifies `fresh`/`stale` using an injected clock;
  the pure validator never uses the wall clock. A missing `expires_at` means no
  expiry was declared — it does not mean "true forever".

## 10. Applicability contract

`applicability` has at least one of these fields:

- `audiences`: 1-20 unique tokens. The token `general` is the unnamespaced
  standard; the `aadp:*` namespace is reserved. Vendor tokens follow
  `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]{0,63}$`. Answer `1.0` registers only
  `general`.
- `jurisdictions`: 1-50 unique codes; ISO 3166-1 alpha-2 uppercase, or UN M49
  three digits. `001` means global.
- `valid_from`/`valid_until`: RFC 3339 UTC; when both are present,
  `valid_from < valid_until` (strict).
- `notes`: optional untrusted text, 1-1,000 code points, with no normative
  effect.

An unknown unnamespaced audience token is rejected. Applicability does NOT
replace authorization; the server still applies core/Relations authorization
policy before returning a resource or target.

## 11. Related entities and the Evidence boundary

`related_entities` and the generated `source_targets` use the component
`answer-reference.schema.json` (`{target_type, target}`); `target` `$ref`s the
Relations `schemas/modules/relations/v1.0/target.schema.json` directly, never a
copy. `target_type` follows the core entity type grammar
`^[a-z][a-z0-9_-]*$`. Within one list, two elements MUST NOT share a canonical
target under the Relations semantic identity `{id, normalizedUrl}`.

The Answer client resolves targets only when the caller opts in, through
`resolveRelationTarget(reference.target, reference.target_type, ...)` with the
same URL/DNS policy, authorization behaviour, scheduler, abort signal and
caller-owned `RelationsTraversalBudgetState` as the parent traversal — it never
guesses the expected type from the prefix of `target.id`, never creates a child
budget, and never retries outside the existing policy.

Answer `1.0` has no `evidence`, `claims` or `citations` field — the Evidence
Module `1.4.0` will link through its own module and the Relations contract.

## 12. Canonical URL contract

Answer `1.0` does NOT define `x_answer.canonical_url`. An Answer entity reuses
the core `entity.canonical_url` as its single human-facing URL.

- `entity.canonical_url` is required for entities of `type: "answer"`; the
  entity-context validator rejects its absence with the code
  `answer.semantic.missing_canonical_url`.
- There is no copy or alias inside `x_answer`; `additionalProperties: false`
  makes the schema reject an older implementation sending
  `x_answer.canonical_url` as an unknown field.
- Core v1.0 validates `entity.canonical_url` only with `format: uri`.
  `validateAnswerEntityV1()` enforces a stricter URL policy itself (§13), using
  the same helper as `author.url`. Violations use the code
  `answer.semantic.canonical_url_policy_violation`.

## 13. Shared URL policy (canonical_url / author.url)

Absolute HTTPS, no userinfo, no fragment. Pure parsing, no network. Exported as
`checkUrlPolicy(url): string | undefined` (the Relations URL/DNS SSRF policy is
a separate layer, applied when a target is actually fetched — not this policy).

## 14. Security and privacy contract

- All free text is untrusted data; the package never interpolates text into a
  system prompt, shell, HTML or executable template.
- `entity.canonical_url` and `author.url` are metadata and are never fetched by
  the validator or client. Target URLs are fetched only through the Relations
  URL/DNS policy.
- `content_checksum` detects tampering only within the hash scope; it is not a
  signature against a dishonest producer and does not replace TLS.
- Redirect, DNS rebinding, private/link-local/reserved address and credential
  leak behaviour are inherited from the existing core/Relations client policy.
- Authorization is checked before an answer or target is returned.
  `applicability.audiences` grants no access.
- Authorship metadata is not a signature, identity verification or endorsement.
  The generated/source-authored label is a producer's provenance assertion;
  schema validity does not prove the assertion is truthful.

## 15. Validation boundary

**JSON Schema** is responsible for: required fields, constants, the tagged
union, closed objects, string and array bounds, URL and timestamp shape, the
locale profile shape, token grammar, the Answer reference shape, and the
`contains`/`minProperties` rules for applicability.

**The pure wrapper semantic validator** (`validateAnswerV1`, registry key
`{aadp:answer, 1.0, answer}`) receives `x_answer`; it receives no core entity
context, makes no network calls, does not read the system clock and does not
mutate its input. It checks: module/version/kind consistency; Unicode code-point
bounds after trimming; the locale profile; timestamp ordering; duplicate targets
by Relations semantic identity; the source-authored/generated-summary branch
invariants; the `author.url` HTTPS policy; and `content_checksum` against a
recomputed digest.

**The entity-context validator** (`validateAnswerEntityV1(entity)`):

1. Validate the core entity v1.0.
2. Require `entity.type === "answer"`, an `x_answer` object, and
   `entity.canonical_url`.
3. Validate `entity.canonical_url` with the URL-policy helper (§13).
4. Dispatch `x_answer` through the exact registry key
   `{aadp:answer, 1.0, answer}`.
5. Require `x_answer.freshness.updated_at === entity.updated_at`.
6. Return a typed validated entity/wrapper, or a structured validation result.

`parseAnswerEntityV1(entity)` is a throwing convenience wrapper over
`validateAnswerEntityV1` and duplicates no validation rules.

Advisory (never a semantic error): whether the question is a natural-language
question; whether the concise answer stands on its own; whether the concise and
full answers contradict each other; whether the content is correct, current or
sufficiently evidenced; whether the author or generator is real or trustworthy.

Validation results use stable machine-readable codes with the prefix
`answer.semantic.*`; message text is not a stable API.

## 16. Layer boundary

```text
core discovery/entity validation
        ↓
module registry ──► Answer schema + pure semantic validator
        ↓
Answer entity validator/client ──► Relations resolver + shared traversal budget
        ↓
application content authoring/generation policy (outside the package core)
```

Core handles discovery only, validates the core envelope and ignores unsupported
extensions. Entity-context validation lives in the Answer module, not in the
generic registry or the core validator. Networking, URL/DNS, authorization,
scheduling and budget remain owned by the shared core/Relations infrastructure.

## 17. Typed API

See `ail-aadp/modules/answer/v1.0` (`src/modules/answer/v1.0/index.ts`) for the
full export list: types (`AnswerDocumentV1`, `AnswerAuthorshipV1`,
`AnswerFreshnessV1`, `AnswerApplicabilityV1`, `AnswerEntityReferenceV1`,
`ValidatedAnswerEntityV1`, ...), schema/registry (`registerAnswerModule`,
`validateAnswerV1`, `validateAnswerEntityV1`, `parseAnswerEntityV1`), client
(`fetchAnswerEntityV1`, `classifyAnswerFreshness`, `resolveAnswerTargets`) and
conformance (`runAnswerConformance` plus the report renderers). Type names carry
the `V1` suffix or live in a versioned subpath to avoid collisions. No public
function accepts an implementation-private registry or network type that is not
exported.

`fetchAnswerEntityV1` uses the core `fetchEntity` and then calls
`parseAnswerEntityV1`; it does not fetch or trust a target URL before the whole
core entity and `x_answer` are valid.

`resolveAnswerTargets` takes a caller-owned `RelationsTraversalBudgetState`
through its options and resolves BOTH lists of Answer entity references:
`related_entities` and — when `authorship.kind === "generated-summary"` — the
mandatory `authorship.source_targets`; both are "Answer targets" and neither may
be skipped merely because it sits inside `authorship`. Each result entry is
tagged `{group: "related_entities" | "source_targets", index}` to preserve
provenance; the result order is all of `related_entities` (in input order)
followed by all of `source_targets` (in input order). A target appearing in both
groups (the same canonical `{id, normalizedUrl}`) is fetched only once:
Relations charges deduplication (`chargeNode`) before the fetch/validate outcome
is known, so "duplicate" by itself does NOT imply the first occurrence resolved
successfully. `resolveAnswerTargets` keeps its own state keyed by the identity
of `options.budget` (living for that budget's whole lifetime, not just one call,
and safe when several `resolveAnswerTargets` calls sharing one budget run
CONCURRENTLY — the budget is caller-owned, nothing forbids `Promise.all` over
several calls on one budget, and the package's scheduler layer supports
concurrent requests). That state separates a canonical target's fetch/validate
outcome (transport/schema/checksum/id — identical for every reference) from the
`target_type` check of EACH individual reference: a canonical target is fetched
at most once for the budget's whole lifetime; a duplicate occurrence — including
one arriving from a concurrently running call while the first occurrence's fetch
is still pending — joins that same in-flight fetch instead of calling Relations a
second time (which would return a bare `duplicate` with nothing to replay). Once
the fetch completes, each occurrence is evaluated again against ITS OWN
`target_type`: a second occurrence of a target that was 404/forbidden/invalid the
first time MUST carry that same status and MUST NOT report `resolved`; if the
fetch succeeded but that occurrence's `target_type` does not match the fetched
entity, that occurrence is `invalid` (type mismatch) — and even when it was the
FIRST occurrence (the one that triggered the fetch) that declared the wrong type
while a later one declares the right type, the later occurrence MUST still be
reported `resolved` with the fetched entity, never inheriting the first
occurrence's wrong verdict. A duplicate for a canonical key this resolver never
produced an outcome or pending fetch for (visited by some other path — for
example a raw Relations traversal step on the same budget) has nothing
trustworthy to replay or join; that case MUST be reported `invalid`, never
`resolved`, because an unverified duplicate is not evidence of a successful
resolution.

If an `AadpDiscoveryBudgetExceededError` occurs exactly while canonical key T is
in flight, `chargeNode` already recorded T in `visitedTargets` BEFORE the error
was thrown, so T becomes a permanent "duplicate" to Relations despite having no
real outcome. `resolveAnswerTargets` MUST remember separately that key T stopped
because the budget was exceeded (attached to `options.budget`, not to one call)
and replay `status: "budget-exhausted"`/`partial: true` for every later
occurrence of that exact key — including in a later `resolveAnswerTargets` call
sharing the same budget — instead of letting it fall into the
duplicate-without-outcome branch and be misreported as `invalid`/`partial:
false`, as though the budget had stopped but this particular target were
data-broken.

`options.signal` (abort) MUST NOT be treated as a global stop shared across the
budget — it is scoped to exactly the ONE `resolveAnswerTargets` call that passed
it, even when the target being resolved is a canonical fetch shared with another
call (a later sequential call, or one running concurrently on the same budget).
A shared canonical fetch is NEVER attached directly to any one caller's
`options.signal` — it uses an internal `AbortController` owned by the resolver
itself, aborted only when NO occurrence is still waiting for the result (a
waiter count, decremented when an occurrence stops waiting — including when it
stops early because its own `options.signal` aborted — with the internal
controller aborted when the count reaches 0). Each occurrence races only its own
wait against exactly the `options.signal` it was given, never against the shared
fetch. Therefore: (a) a caller aborting its own signal stops only that call
(`partial: true`/`budget-exhausted` for the remaining references of THAT call)
and does not affect another call waiting on the same canonical fetch; (b) a
canonical fetch is NOT cancelled merely because ONE OF SEVERAL waiting callers
aborted — the others still receive the real outcome when it completes — but it is
NOT left running in the background indefinitely after the LAST remaining waiter
leaves either: the real HTTP request is cancelled as soon as nobody depends on
the result, so it stops consuming `maxRequests`/`maxTotalBytes` for a result
nobody will receive; (c) an occurrence whose `options.signal` was ALREADY
aborted MUST NEVER start a new fetch (no charge, no request) on behalf of a call
that had already given up; (d) an `AbortedError` is NEVER recorded into the
per-budget global-stop state — only an `AadpDiscoveryBudgetExceededError` (a
genuinely budget-shared conclusion) is remembered and replayed for later
occurrences; an abort must not "poison" the budget so that every other call —
including one with a fresh signal that never aborted — permanently receives
`budget-exhausted` for that target; (e) when the last waiter leaves and the
fetch is abandoned (the waiter count reaches 0 while the canonical fetch has not
settled through its own normal completion path), the resolver MUST release the
`chargeNode` charge recorded for that canonical key immediately and
SYNCHRONOUSLY within that same tick — not deferred until the cancelled fetch's
promise actually settles — through the Relations budget's `releaseNode`, so that
a later call (including one issued right after the aborted call returns, without
waiting for the cancelled fetch to settle) can start a genuinely new resolution
for that target instead of forever meeting Relations' `duplicate` and being
reported `invalid`; (f) an attempt that has ALREADY been abandoned MUST NEVER
commit any shared state when it settles late afterwards — no outcome, no global
stop. A cancelled attempt can still settle successfully (the abort arriving
after the transport's last cancellation check leaves only the synchronous tail),
and at that point it is no longer the current attempt for that canonical key:
committing it would cache a response its own caller abandoned, and could
overwrite a NEW attempt running for the same key with different options.
Discarding an abandoned attempt's budget error loses nothing either, because
every budget dimension is monotonic — the replacement attempt will trip the same
limit again.

Per-entry status: `resolved | forbidden | not-found | invalid |
budget-exhausted`; a partial result is never returned as though it were
complete. Classification is based on the actual cause of failure
(`RelationsTraversalIssue.cause`), not just the coarse error code: HTTP 401/403 →
`forbidden`; HTTP 404 → `not-found`; a blocked URL, a schema-invalid response, a
checksum mismatch, an id/type integrity mismatch, or an unsupported
`aadp_version` → `invalid` (the target exists but is unusable); every other
transport error (timeout, 5xx, too many redirects, oversized response) also
defaults to `invalid` — a deliberate simplification, because the Answer taxonomy
has no sixth bucket for transport errors, and reporting `not-found` for a
transient failure would misreport a target that does in fact exist.

## 18. Schema and artifact inventory

```text
schemas/modules/answer/v1.0/
├── module.schema.json
├── answer.schema.json
├── answer-reference.schema.json
├── authorship.schema.json
├── freshness.schema.json
└── applicability.schema.json

spec/modules/answer/v1.0/
├── specification.md
└── conformance.md

src/modules/answer/v1.0/
├── types.ts, schemas.ts, semantic.ts, register.ts, entity.ts, index.ts
├── client/ (types, errors, freshness, fetch, resolve, index)
└── conformance/ (types, checks, report, runner, index)
```

## 19. Compatibility

- Answer `1.0` is the first normative wire version; there is no `0.1`.
- A patch only fixes documentation or implementation bugs without changing the
  payload schema or normative semantic results. A minor only adds
  backward-compatible optional contract. A major covers incompatible changes to
  fields, the discriminator, references or freshness semantics.
- A client MUST NOT fall back to another Answer version when the exact version
  is unsupported.
- A core-only consumer safely ignores `x_answer` and the module discovery entry.

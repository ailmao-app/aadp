# ADR-0009: Answer Module terminology and security boundary

## Status

Accepted — applies from Answer Module `1.0` and package `ail-aadp@1.3.0`.

## Context

An earlier design draft for Answer used the term `short_answer` and a separate
`x_answer.canonical_url` field, and had not settled: (a) the official field name
for the short answer, (b) which integrity digest protects Answer content given
that the core checksum only covers `data`, (c) which field carries the
human-facing URL of an Answer entity, and (d) a clear boundary between Answer
`1.0` and the Evidence & Provenance Module `1.4.0` (claim/citation), so that
Answer `1.0` does not quietly take on evidence responsibilities.

Implementation was not allowed to start until these contract decisions were
Accepted, because they directly affect the wire schema's required fields,
discriminator and reference model.

## Decision

### The term `concise_answer`

The official field for the short answer is `concise_answer`, not
`short_answer`. Older design drafts and documents using `short_answer` MUST be
updated; the Answer `1.0` wire schema does NOT support the alias — a document
using it is rejected by `additionalProperties: false` (and by the missing
required `concise_answer`).

### `content_checksum` — a dedicated integrity digest for `x_answer`

The core checksum is computed over `data` only; since every normative Answer
field lives in `x_answer`, the core checksum cannot detect a change to Answer
content. Answer Module `1.0` therefore defines `x_answer.content_checksum` as an
additional digest:

- Hash scope: `x_answer` with the `content_checksum` field itself removed.
- Algorithm and canonicalization reuse ADR-0001 and `ail-aadp/canonical-json`
  (`canonicalize()`/`checksumOf()`) as released — no new canonicalization rule
  is defined.
- It is in addition to, not a replacement for, the core checksum; a valid Answer
  entity MUST pass both.
- `content_checksum` is not a signature against a dishonest producer and does
  not replace transport integrity (TLS) — it only detects tampering with fields
  inside the hash scope.

### Reuse `entity.canonical_url`; no separate field in `x_answer`

Answer `1.0` does NOT define `x_answer.canonical_url`. An Answer entity reuses
the core `entity.canonical_url` as the single human-facing URL for every
consumer, core-only and Answer-aware alike — removing any possibility of two
consumers citing two different URLs for the same entity. `entity.canonical_url`
becomes mandatory for entities of `type: "answer"` at the entity-context
validator (not in the core schema, which keeps the field optional for every
other entity type). Because core v1.0 only validates `format: uri`, the
entity-context validator enforces a stricter URL policy itself (see below),
shared with `author.url`.

### Shared URL policy: absolute HTTPS, no userinfo, no fragment

`entity.canonical_url` and `authorship.author.url` use one pure-parsing policy:
the scheme MUST be `https:`, with no userinfo and no fragment. This is an Answer
entity/wrapper-context rule, not a core v1.0 policy — the core schema and
validator stay permissive for other entity types. Violations use the codes
`answer.semantic.canonical_url_policy_violation` and
`answer.semantic.author_url_policy_violation`.

### Boundary with the Evidence & Provenance Module

Answer `1.0` has no `evidence`, `claims` or `citations` field. `source_targets`
inside `generated-summary` denotes only the input sources of the summary — it
does NOT prove factual truth, support, or citation validity. The rule "a
verifiable fact must carry evidence" is content-governance advice for the
Evidence Module `1.4.0` rollout, NOT an Answer `1.0` schema or semantic
invariant. Evidence Module `1.4.0` will link through its own module and the
Relations contract, and MUST NOT quietly add fields to the released Answer
`1.0`.

### Security: free text is always untrusted data

`question`, `concise_answer`, `answer`, author names and applicability `notes`
are untrusted text. The package does NOT render, execute or interpolate them
into a system prompt, shell, HTML or executable template; does not parse
instructions out of them; and does not dereference URLs that appear inside free
text. This behaviour is verified by the conformance check `answer.security` (an
advisory scan, not an absence proof — see
`spec/modules/answer/v1.0/conformance.md` §7) and by the test suite (the
`prompt-injection-shaped` fixture MUST remain schema- and semantically valid,
never treated as invalid because of its content).

### Authorship is a provenance assertion, not a signature

`authorship` (including `reviewed_by`) is an assertion by the producer, not a
signature, identity verification or endorsement. Schema and semantic validity do
not prove the assertion is truthful; a client MUST NOT infer `source-authored`
from missing metadata, and MUST NOT rewrite `kind` after fetching a target.

## Consequences

- Wire schema, types, semantic validator, client and conformance all use
  `concise_answer`, `content_checksum` and `entity.canonical_url` consistently —
  producers no longer face two competing options.
- An older implementation sending `x_answer.canonical_url` or `short_answer` is
  rejected explicitly (unknown field / missing required field) rather than
  silently accepted with ambiguous meaning.
- `content_checksum` adds one digest step for producers, but reuses the released
  `checksumOf()` in full — no new algorithm to audit separately.
- Evidence and citation stay out of scope for Answer `1.0`, so Answer `1.0` can
  ship independently of the Evidence Module `1.4.0` schedule.

## References

- ADR-0001 (checksum algorithm), ADR-0007 (module versioning and discovery),
  ADR-0008 (module traversal and authorization).
- `docs/vi/plans/implementation-plan-v1.3.0.md` — the original implementation
  plan; the decisions in this ADR are taken verbatim from its "locked contract
  decisions" section.
- `spec/modules/answer/v1.0/specification.md`, `conformance.md`.

# ADR-0011: Cross-module graph traversal — registry boundary, edge matrix, ordering and budget ownership

## Status

**Proposed** (2026-08-11) — for package `ail-aadp@1.5.0`. No wire artifact is
allocated by this ADR: cross-module traversal is a **client-side capability**,
not a wire contract. `aadp_version` stays `1.0`, and `aadp:relations@1.0`,
`aadp:answer@1.0` and `aadp:evidence@1.0` are untouched.

**Until and unless open question 3 decides otherwise, this ADR is the binding
source for cross-module traversal.** There is no
`spec/traversal/v1.0/specification.md`, and neither the plan nor any release gate
may cite one as authority while it does not exist.

Nothing under `src/traversal/**` or `spec/traversal/**` may be created before
this ADR is Accepted. [ADR-0010](0010-evidence-citation-provenance-and-security.md)
spent the "decide before freezing" protection of
[ADR-0004](0004-backward-compatibility.md) and
[ADR-0007](0007-module-versioning-and-discovery.md) once, at explicit maintainer
direction; `1.5.0` does not repeat that.

The proposals below come from
[implementation plan 1.5.0](../vi/plans/implementation-plan-v1.5.0.md), written
to close the findings of the 2026-08-11 review.

## Context

Three modules are released and stable, and each walks its own slice of the graph
with its own entry point: `traverseRelations`, `resolveAnswerTargets`,
`resolveAnswerEvidenceV1`. A consumer that wants "start at this entity and follow
everything you understand" has to orchestrate those three by hand, and gets the
hard parts wrong in ways this package already solved once — sharing one budget,
deduplicating by canonical identity, keeping one security context per walk.

Building one traversal service raises decisions that no single module's contract
can answer, because each of them is precisely about the seam *between* modules:

- **Which registry does dispatch belong to.** `src/module-registry` is released
  with a deliberately narrow contract: exact-match `{moduleId, moduleVersion,
  kind}`, and a `ModuleSemanticValidator` that its own docstring forbids from
  fetching anything. A traversal service needs capability lookup and expansion —
  network-adjacent concerns. Putting them into the validation registry would
  invert the dependency direction and put network orchestration inside the pure
  validation layer.
- **Which edges exist, and which ones stop.** Each module defines its own edges,
  but nothing defines the union: what may be a root, which edge may follow which,
  what happens at an unknown module, a type mismatch, or a re-entered node.
- **Whether a streamed graph is deterministic.** Concurrent branches complete in
  timing-dependent order. Without a stated ordering rule, a minor release would
  freeze an API whose output order is an accident of the network.
- **Who owns the budget and the cache.** `RelationsTraversalBudgetState` already
  carries six dimensions plus `visitedTargets`/`expandedTargets`, and ADR-0010 §10
  put the canonical outcome cache in a shared layer keyed by that budget. A second
  cache over the same budget would manufacture false `invalid` results — the exact
  hazard that layer exists to prevent.
- **What an unsupported module does.** If an unknown module or version were a hard
  failure, every deployment that adds a module would break consumers that do not
  know it — a regression for core-only consumers, which
  [ADR-0007](0007-module-versioning-and-discovery.md) forbids.

## Decision

### 1. A separate traversal adapter registry; the module registry does not change

`src/module-registry` keeps its released contract verbatim: exact-match
`ModuleRegistryKey`, entries of `{schema, validateSemantics?, schemaDependencies?}`,
and a pure `ModuleSemanticValidator` that MUST NOT fetch.

Traversal introduces a **second, independent registry** in
`ail-aadp/traversal/v1.0`, keyed by `{moduleId, moduleVersion, extensionField}`
and holding a `TraversalAdapter` with declared capabilities.

Dependency direction is one-way and MUST stay so:

```text
traversal service → module clients → module registry
```

The module registry MUST NOT know the traversal service exists. No traversal type
appears in `src/module-registry/**`.

### 2. Adapters validate before they plan, and both steps are pure

An adapter has exactly two traversal duties, in order:

1. `parseExtension(entity)` — validate the entity's extension payload using the
   **released validator of that module version** (`validateAnswerEntityV1`,
   `validateEvidenceEntityV1`, …) and return either a typed document or a list of
   issues. An adapter MUST NOT invent its own validation behavior; traversal and
   a standalone module client MUST accept exactly the same set of payloads.
2. `planEdges(document, entity, context)` — called **only** on a successful parse,
   receiving the validated document rather than `unknown`, and returning candidate
   edges in wire input order.

Both MUST NOT fetch, MUST NOT charge the budget, MUST NOT read the clock, MUST
NOT mutate their input.

The validation step is mandatory because the shared canonical resolution layer
guarantees only that an entity is **core**-valid: it does not know which `x_*`
field some adapter is about to read, so it cannot validate module payloads on the
adapter's behalf. Without step 1, a core-valid entity carrying a malformed
`x_answer`/`x_evidence` reaches an adapter as raw `unknown`, and the adapter
either throws outside the error taxonomy or builds edges out of unvalidated data.

A failed parse yields expansion outcome `invalid-extension`, plans no edges, and
leaves the node's resolution status at `resolved` — the core entity really is
valid; only the extension is not.

All fetching and charging stays with the scheduler. This is what keeps a
third-party adapter from becoming a way around URL/DNS policy or budget
accounting: an adapter that cannot make a request cannot bypass the rules
governing requests.

### 3. The edge matrix is normative for the traversal service only

| # | Source kind | Edge group | Wire source | Depth delta | Expandable | Condition |
|---:|---|---|---|---:|---|---|
| 1 | any entity with `x_relations` | `relations.item` | `x_relations.items[].target` / `targets[]` | +1 | yes | always |
| 2 | any entity with `x_relations` | `relations.collection` | `x_relations.items[].collection` | +1 per item | yes | `followCollections` |
| 3 | `answer` | `answer.related_entity` | `x_answer.related_entities[]` | +1 | yes | always |
| 4 | `answer` | `answer.source_target` | `x_answer.authorship.source_targets[]` | +1 | yes | `includeGeneratedSummarySources`, **default false** |
| 5 | `claim` | `evidence.evidence_ref` | `x_evidence.evidence_refs[]` | +1 | no (leaf) | always |
| 6 | `evidence` | — | none | — | — | `source.url`/`publisher.url` are **never** fetched |

The matrix describes what the traversal service does. It does **not** redefine any
module's wire contract, and it does not change what any released module client
does on its own.

Row 4 is the one deliberate widening. Evidence `1.0` never fetches
`authorship.source_targets`, and ADR-0010 §9 keeps it that way; the traversal
service is a *new consumer*, so it may follow that edge — but only on explicit
opt-in, defaulting to `false`. `resolveAnswerEvidenceV1` is unchanged, and its
"no request to `authorship.source_targets`" test stays as-is.

A traversal root is an entity URL or a validated entity, at depth 0. Standalone
module documents (`relation-collection`, `relation-registry`) appear only as
intermediates of row 2 and are never roots.

### 4. A new expansion outcome enum; the released status vocabulary is untouched

Node resolution keeps the released `AnswerTargetResolutionStatus`
(`resolved` | `forbidden` | `not-found` | `invalid` | `budget-exhausted`) — no
sixth value, no new resolution enum, consistent with ADR-0010 §2.

Whether a resolved node's own edges were followed is a **different question**, so
it gets its own traversal-layer enum: `expanded`, `leaf`, `unsupported-module`,
`invalid-extension`, `depth-limit`, `already-expanded`, `cycle`, `not-resolved`,
`budget-exhausted`.

Conflating the two would have forced a new value into a released vocabulary that
three module clients already return.

**Depth boundary.** `depth-limit` applies when an edge's **landing depth would
exceed** `maxDepth`, matching the released `chargeDepth`, which fails only on
`depth > maxDepth`. A node at exactly `depth == maxDepth` is still fetched and
emitted. Stating this the other way round would silently give the traversal
service one level less reach than Relations `1.0` at identical limits.

### 5. Negotiation reads the entity, and traversal never fetches a manifest

Adapter lookup is **exact match** on `{payload.module, payload.version,
extensionField}`, read from the payload present on the fetched entity. No range
matching, no fallback to another version — the same rule ADR-0007 released for
the module registry and Evidence `1.0` already enforces.

A miss yields expansion outcome `unsupported-module`. The node stays a valid node,
the walk continues, nothing throws, and no conformance check fails. Where a
deployment advertises several versions of one module id there is nothing to choose
between — each entity declares its own version — so this ADR defines no preference
order.

The traversal service **MUST NOT fetch `.well-known/ai-manifest.json`**. The
manifest decides nothing here, since the entity payload is the authority, so
fetching it would be pure cost carrying three unsolved problems: its requests and
bytes appear in no accounting row (a walk touching N origins would emit N
uncounted requests, exactly what the "no unbounded requests" gate forbids); a
manifest that 404s, is invalid, is blocked by URL policy, or exhausts the budget
has no defined outcome, being neither a node nor an edge; and an in-memory root
entity may have no `canonical_url`, so "the root's origin" is not always defined
and the same graph would behave differently depending on how the root was passed.

A consumer that wants manifest data for reporting fetches it themselves with the
existing core discovery API and passes it in. Traversal reads it for the summary
only, and it never changes a negotiation result.

A consumer MAY pass an explicit capability allowlist; adapters outside it are
treated as absent, producing the same `unsupported-module` outcome.

Cross-origin accounting still needs a definite root origin: it is taken from the
root URL, else the root entity's `canonical_url`, else a caller-supplied
`rootOrigin` — and when none of the three exists, traversal throws on invalid
options **before the first request** rather than guessing. Guessing here would
quietly disable `maxCrossOriginRequests`.

### 6. Expand-at-most-once and "this is a cycle" are two different claims

Containment reuses `markExpanded`/`expandedTargets` on the existing budget state,
unchanged, with no new state added to the budget: re-entering an already-expanded
canonical key stops that branch — no throw, no extra charge, no retry.

But `expandedTargets` proves only "already expanded", **not** "cycle". In the
diamond `A→B→D`, `A→C→D`, the `C→D` occurrence meets an expanded `D` with no path
back to an ancestor anywhere in sight. Reporting that as a cycle misdescribes the
topology of a perfectly ordinary DAG, and makes a `cycle_contained` conformance
check stop measuring cycles.

So the two get separate outcomes:

- `already-expanded` — the canonical key was expanded on some other branch
  (fan-in/diamond);
- `cycle` — the canonical key is **on the ancestor path of this very occurrence**,
  determined by walking that edge's parent-occurrence chain.

The chain is at most `maxDepth` long (reference default 3), so classification is
O(depth) per edge and needs no new global state — the parent-occurrence link is
already required for the schedule key's `parentDiscoveryIndex`.

Both outcomes behave identically (stop the branch, no throw, no charge); only the
reported label differs, and that label is what consumers read the topology from.

Unlike Evidence `1.0`, which is acyclic by construction (ADR-0010 §3), the
cross-module union **can** express real cycles: Relations edges carry a free
`target_type` token and any entity may carry `x_relations`. So the machinery
ADR-0010 was able to omit is required here.

A node is expanded at most once per walk, including under fan-in.

### 7. Verdicts are per-occurrence; canonical outcomes are shared

The two-tier model released with `EvidenceGraph` (ADR-0010 §10) is adopted
unchanged: a **node** carries the canonical fetch/schema/checksum outcome shared
by every reference to that target, while each **edge/reference** carries its own
verdict, including a `target_type` mismatch.

One reference declaring the wrong type MUST NOT poison another reference to the
same canonical target, and reversing input order MUST NOT change any result.

### 8. Ordering is a total order over the schedule, independent of timing

The scheduler is BFS over a queue sorted by:

```text
(depth, parentDiscoveryIndex, edgeGroupRank, edgeIndex)
```

`parentDiscoveryIndex` is the order a node was **discovered**, not the order its
fetch completed. `edgeGroupRank` is a fixed constant per edge group — not the
adapter registration order — with third-party groups ordered after all built-ins
by `(moduleId, edgeGroup)` code-point comparison, so two deployments with the same
adapter set always produce the same order.

Fetching MAY be concurrent; **emission MUST NOT be**. Results are buffered and
emitted in schedule order. The same input and options therefore produce the same
event sequence regardless of which branch returns first — and that is a required
conformance check, exercised with responses completing in reverse order.

### 9. The terminal event is mandatory, and partial results say so

`traverseGraphV1` emits exactly one `complete` event carrying `stopReason`
(`exhausted` | `budget` | `aborted` | `max-events`) and `partial`. It is emitted
on every path including budget exhaustion and abort, so a consumer never has to
infer completeness from the iterator merely ending.

If the consumer abandons the iterator early, no `complete` is emitted — the
consumer gave up, so there is no outcome to declare.

Resolution failures (401/403, 404, invalid schema, blocked URL, budget stop,
abort) are **results**, carried as statuses. Only programming and security errors
throw — invalid options, and the `1.3.1` `resolution_context_mismatch`.

### 10. The caller owns the budget; the shared layer owns the cache

- The caller creates the budget with `createRelationsTraversalBudget`. The
  traversal service **borrows** it: no child budgets, no relaxed defaults, no
  seventh dimension beyond ADR-0008's six.
- The canonical outcome cache stays in the internal shared layer keyed by budget
  (ADR-0010 §10), and the traversal service uses that same layer. Two caches over
  one budget would fabricate `invalid` results for each other.
- **One budget is one resolution context.** The binding released in `1.3.1` —
  fail-closed with `resolution_context_mismatch` before any replay, join, charge
  or request — applies unchanged, and the traversal service MUST NOT offer any
  path around it.
- Accounting is fixed: a cache hit and a join of an in-flight fetch charge
  nothing; expansion charges nothing beyond `markExpanded`; retries and redirect
  hops charge requests, bytes and cross-origin exactly as `http.ts` already does.
  `releaseNode` keeps its released precondition and stays module-internal — the
  traversal service never calls it.

### 11. Conformance is a profile with stable check IDs

Cross-module conformance ships as profile `aadp:graph-traversal@1.0`, reusing the
core `CheckResult`/`CheckStatus`/`ConformanceSummary` shapes — no fourth report
format. Check IDs are stable API under the prefixes `graph.capability.*`,
`graph.traversal.*`, `graph.ordering.*`, `graph.budget.*`, `graph.streaming.*`
and `graph.compat.*`; message text is not.

"Stable API" here means **package API, versioned by `ail-aadp`'s own SemVer** —
this profile puts nothing on the wire, so it is not a protocol surface and it
does not make this ADR a wire contract.

The "two neutral data sets" release gate is only closed when both data sets are
recorded by **name, URL and owner** in the `1.5.0` implementation record, with at
least one owner outside the AADP maintainers. An unnamed data set is neither
reproducible nor auditable.

## Consequences

- Consumers get one entry point for a multi-module walk, and the failure modes
  that used to require hand-rolled orchestration (double-charging a shared budget,
  two caches disagreeing, mixing security contexts) become unreachable by
  construction.
- The traversal service is a new public surface at `ail-aadp/traversal/v1.0` only.
  Core-only and single-module consumers import nothing new, and every existing
  Relations/Answer/Evidence test MUST pass unedited — that is the compatibility
  gate.
- Cycle machinery, absent from Evidence `1.0`, must now be written, tested and
  audited — including the ancestor-path walk that separates a real cycle from
  ordinary fan-in. That is the price of a union graph with free `target_type`
  tokens.
- Every adapter must call the released validator of its module version before
  planning. That is one more required hook per adapter, and it makes a third-party
  adapter's correctness depend on a public module validator existing — the
  intended constraint, since an adapter that validates differently would let
  traversal accept payloads a standalone client rejects.
- Dropping the manifest fetch means the traversal service publishes no discovery
  behavior of its own and can be reasoned about purely from the entities it
  fetches. The cost is that a consumer wanting manifest data in the summary has
  to fetch it and pass it in.
- Deterministic emission over concurrent fetching costs a buffer and some
  scheduling complexity. The alternative — documenting order as
  timing-dependent — would make the streaming API untestable across
  implementations and unfit to freeze in a minor release.
- Row 4 means a generated-summary Answer can, on explicit opt-in, cause requests
  that no released module client would make. The default is `false` precisely so
  that no release silently widens the fetch surface, but the option exists and
  its security implications belong to whoever enables it.
- A third-party adapter can still plan a very large number of edges; the only
  bound is the caller's budget. If a per-adapter bound is wanted, it belongs to a
  later ADR, not to implementation-time improvisation.
- `followCollections` opens a paging surface wider than any module client has
  today. Its default and `maxPages` value are open questions this ADR must settle
  before acceptance.

## Open questions to settle before acceptance

1. `followCollections` default (`true` as proposed, or `false`) and the default
   `maxPages` for row 2.
2. Whether `concurrency` is public at `1.0` or fixed internally — a public knob
   is an API promise about a scheduling detail.
3. Whether a normative `spec/traversal/v1.0/specification.md` is published in
   addition to this ADR. Until that is answered, the Status section's default
   holds: this ADR is the binding source and no document may cite a specification
   that does not exist. Answering "yes" adds drafting, review and acceptance of
   that spec to Phase 0 and keeps Phases 1-6 blocked until it is settled.

## References

- [ADR-0004](0004-backward-compatibility.md) (immutability),
  [ADR-0007](0007-module-versioning-and-discovery.md) (module versioning,
  registry lookup, conformance boundary),
  [ADR-0008](0008-module-traversal-and-authorization.md) (traversal budget and
  authorization),
  [ADR-0010](0010-evidence-citation-provenance-and-security.md) (shared canonical
  resolution layer, two-tier verdicts, Answer integration boundary).
- [`docs/vi/plans/implementation-plan-v1.5.0.md`](../vi/plans/implementation-plan-v1.5.0.md)
  — the implementation plan and the source of every decision above.
- [`docs/vi/plans/implementation-plan-v1.3.1.md`](../vi/plans/implementation-plan-v1.3.1.md)
  — the released resolution context binding.
- [`docs/records/implementation-record-v1.4.0.md`](../records/implementation-record-v1.4.0.md)
  — evidence that the Relations/Answer/Evidence dependency is stable and its
  gates closed on 2026-08-10.

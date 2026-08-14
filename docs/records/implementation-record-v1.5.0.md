# AADP `ail-aadp` 1.5.0 Implementation Record

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | **Implementation and release gates complete.** Phases 1-5 are green; Phase 6 passed against the AI Lmao production graph from a packed-tarball clean install on Node 20.18.1 |
| Audience | Package maintainers and release reviewers |
| Scope | Cross-module graph traversal `ail-aadp/traversal/v1.0` and the conformance profile `aadp:graph-traversal@1.0` |
| Wire impact | AADP wire version stays `1.0`. No released core, Relations `1.0`, Answer `1.0` or Evidence `1.0` schema, module version or wire contract changed. `1.5.0` publishes **no specification**: cross-module traversal is a client-side capability, and [ADR-0011](../adr/0011-cross-module-graph-traversal.md) is its binding source |
| Binding source | [ADR-0011](../adr/0011-cross-module-graph-traversal.md) (**Accepted** 2026-08-12, **amended** 2026-08-14: §9 `partial` independent of `stopReason`, §11 one production data set) |
| Vietnamese internal edition | [`../vi/plans/implementation-plan-v1.5.0.md`](../vi/plans/implementation-plan-v1.5.0.md) |

## Abstract

This memo records what `1.5.0` delivered, the decisions worth remembering and
the evidence that closed every release gate.

It is informational and does not override any specification or schema.
Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Delivered

### Phase 1 — adapter registry and capability negotiation

A **second**, independent registry under `ail-aadp/traversal/v1.0`, keyed by the
exact triple `{moduleId, moduleVersion, extensionField}`. `src/module-registry`
is untouched: it answers "is this document valid", this one answers "which
adapter may plan edges out of this extension field".

- Registering a different adapter under a taken key throws; re-registering the
  identical reference is a no-op. Silent overwrite would make a walk's result
  depend on module import order.
- `options.adapters` **replaces** the global registry for one call rather than
  merging, so a walk can run against exactly the adapter set it names.
- `options.capabilities` is an exact `{moduleId, version}` allowlist; an adapter
  outside it is treated as absent, producing the same `unsupported-module`
  outcome as a module nobody implements.
- The three built-in adapters validate with the RELEASED module validators
  (`validateRelationsDocument`, `validateAnswerEntityV1`,
  `validateEvidenceEntityV1`), never with logic of their own, so traversal and a
  standalone module client accept exactly the same payloads.
- Extensions are processed in extension-field **name** order (code point), not
  JSON property order — a field with no module envelope has no adapter key to
  rank by, and field names order every case totally.
- Outcomes are per extension: an unsupported or malformed `x_*` stops only its
  own adapter.

### Phase 2 — edge matrix and traversal state machine

- All five edge-matrix rows, with rows 2 and 4 behind their explicit opt-ins
  (`followCollections`, `includeGeneratedSummarySources`), both default `false`.
- Root identity by the documented precedence (root URL → `canonical_url` →
  `options.rootUrl`); no source at all, or a `rootOrigin` disagreeing with the
  root URL's origin, is invalid options thrown **before the first request**.
- `expandedKeys` and the ancestor chain are **walk-local**, never written to
  `budget.expandedTargets`: a budget outlives one call, and expansion state on it
  would make a second walk silently skip a node's outgoing edges.
- A true cycle (target on the occurrence's own ancestor path) is distinguished
  from a fan-in re-entry (`already-expanded`) by an O(depth) walk of the
  parent-occurrence chain.
- A node landing exactly on `maxDepth` is resolved and expanded; only an edge
  whose landing depth exceeds it is `depth-limit`.
- A blocked edge is emitted at its scheduled position, carries **no** resolution
  status, and counts in `summary.edges`.
- A wrong `target_type` is a verdict for that occurrence alone; the canonical
  node keeps the outcome every other reference to it sees.

### Phase 3 — streaming and deterministic ordering

- `traverseGraphV1()` is an `AsyncIterableIterator`; `collectGraphV1()` is a
  drain of it, not a second traversal algorithm.
- Fetch concurrency is the internal constant `4`, not public API. Several
  targets may be in flight, but an event is only yielded at its `scheduleKey`
  position, so completion timing never reorders the stream.
- Bounded buffer (`maxBufferedEvents`, default 256) with real backpressure: a
  slow consumer slows the walk instead of accumulating the graph. There is no
  total-event limit, so `stopReason` has no `max-events` value.
- Exactly one terminal `complete`, always — except after an early consumer
  `return`, which runs cleanup and declares nothing, because a walk nobody is
  reading has no outcome.

### Phase 4 — shared budget and accounting

- Resolution goes through `src/modules/shared/canonical-resolution.ts` alone.
  Traversal keeps no cache of its own and never calls `releaseNode`.
- The caller owns the budget; traversal borrows it. Fan-in charges one node and
  fetches once; a second walk on the same budget re-expands walk-locally from the
  canonical cache.
- One budget = one resolution context: the released `1.3.1` binding applies
  unchanged and fails closed before any replay, charge or request.
- Budget exhaustion is a result — `partial: true`, `stopReason: "budget"` — not
  an exception, and no request is made after a terminal abort.

### Phase 5 — conformance profile and package surface

- Profile `aadp:graph-traversal@1.0` with 26 stable check IDs, reusing the core
  `CheckResult`/`ConformanceSummary` shapes. The report is `profile`-scoped, not
  `module`-scoped: it composes three modules and certifies none of them alone.
- The profile certifies a traversal **implementation** against ADR-0011, so it
  runs entirely against the in-package fixture matrix and makes no request. That
  is what lets a consumer run it in their own CI, offline, from an install.
- One public export path: `ail-aadp/traversal/v1.0`. No re-export from the
  package root or any module subpath, and the shared canonical-resolution layer
  is exported nowhere — asserted against the packed tarball.

## Decisions worth remembering

1. **Collection paging is not adapter work.** A collection link carries a page
   URL and no target identity, and its edges are one per item of each fetched
   page. Adapters are pure, so the adapter reports *where* the collection is
   through an INTERNAL `planCollections` capability and the scheduler pages it
   with the released `iterateRelationCollection`. The public `TraversalAdapter`
   contract frozen by ADR-0011 was deliberately not widened for it.
2. **A URL root is replayed by the shared layer, not by traversal.** The
   canonical cache is keyed by `{id, normalizedUrl}` and a bare root URL has no
   id until it is fetched, so the shared layer gained a URL-keyed root index
   (`rootOutcomes`) with two internal entry points: `recordRootOutcome` and
   `replaySettledOutcomeForUrl`. **Both** success and failure are recorded — a
   stable `not-found`/`forbidden`/`invalid` root costs one request per budget,
   not one per walk, so a repeat walk can never turn a settled outcome into
   `budget-exhausted` through call history alone. On success the outcome is also
   filed under the canonical key, so an edge pointing back at the root meets an
   already-settled target. A budget stop is deliberately NOT recorded: it is a
   condition of that walk, not an outcome of the URL. The URL-keyed replay never
   joins an in-flight fetch — a URL alone cannot prove it is the same canonical
   target the pending fetch will produce.
3. **`already-expanded` outranks the type-mismatch verdict.** A blocked edge
   carries no status by contract, so an occurrence that declares the wrong
   `target_type` for a target already expanded elsewhere reports
   `already-expanded` rather than `invalid`.
4. **Two accounting units, decided 2026-08-14 and locked in ADR-0011 §9.**
   `summary.requests` counts the logical canonical-target resolutions **this walk
   started**; `budget.requestsMade` counts physical HTTP attempts across the
   whole shared budget. `summary.requests` does not increase for a cache hit, an
   in-flight join, a collection page, a retry or redirect hop, or work spent on
   the budget before this walk began.

   Implementing the decision exposed a real defect: the counter had been
   incremented for every key the WALK had not seen yet, so a second walk on a
   warm budget reported four requests while making none.

   The first fix asked the shared state a predicate before resolving and acted
   on the answer afterwards. That was replaced: `resolveCanonicalTarget` now
   REPORTS the decision it took, at the moment it took it — `started` is true
   only for the call that created the fetch, and false for a cache replay, a
   join, or a call that stopped before starting anything.

   **What the change is worth, stated precisely.** The predicate was not
   reachable-race-prone in the shape it shipped in: nothing awaited between the
   read and `pending.set`, which is synchronous, so no second walk could
   interleave — a mutation test restoring the predicate does NOT fail. The value
   of reporting the decision is that correctness no longer depends on that
   accident of statement order: inserting any await between the two would have
   silently reintroduced double counting. The accompanying tests therefore pin
   the CONTRACT (`tests/modules/shared/canonical-resolution.test.ts`: exactly one
   of two concurrent callers is `started`; a replay and a pre-start stop are
   not), and the traversal-level test pins the observable accounting (one fetch,
   one join, `requests` summing to the number of logical fetches).
5. **A collection is streamed, never materialized.** Its items are yielded one at
   a time and each is settled and emitted before the next is read, so the node
   and its early edges are observable while later pages are still arriving and no
   page is held beyond the item being settled. Collection items rank between
   `relations.item` and every later group, so the node's statically planned edges
   are split around them and the schedule-key order is unchanged.
6. **A node's `expansions` is a snapshot.** It states the result of pure planning
   at the moment the node was emitted. A runtime diagnostic discovered later — a
   collection that could not be paged — is amended onto the records the
   `expansion` EVENTS carry, never onto an object the consumer already holds.
7. **`partial` is independent of `stopReason` (ADR-0011 §9, amended).** A
   collection that cannot be paged (404, blocked URL, malformed page, cursor
   cycle) stops that one collection, is named on the expansion record that owns
   it, and leaves the walk `stopReason: "exhausted"` — the scheduler really did
   run out of work — with `partial: true`, because the graph is missing a branch.
   The rejected alternative was a fourth `stopReason` for truncation: the
   scheduler's ending is already described accurately, and a consumer asking "is
   this graph complete?" must not have to enumerate stop reasons. No released
   enum grew. Pinned by `graph.traversal.collection_failure_partial`.
8. **Work after a collection is never prefetched across it.** Prefetch is scoped
   to the segment being settled, so a page request and a later-group target can
   never compete for the last of the budget — which branch survives would
   otherwise depend on completion timing, the one thing the schedule key exists
   to remove from the result.
9. **Early consumer return cancels only this walk's waiting.** `traverseGraphV1`
   combines the caller's signal with a walk-local abort and hands the scheduler a
   cancel hook, because an async generator queues `return()` behind an in-flight
   `next()` — without it, breaking out of a `for await` would block for as long
   as the pending fetch. A fetch another walk on the same budget is still waiting
   on is never cancelled by it.

## Closed gate — Phase 6 production interoperability

The fields below come from a run that actually happened; none was filled in from
a proposed or reconstructed result.

By the ADR-0011 amendment of 2026-08-14, the release gate requires **one** real
production data set that:

- is identified by name, HTTPS URL and owner in this record;
- is exercised from a packed-tarball clean install importing only
  `ail-aadp/traversal/v1.0`;
- is run on **Node 20.18.1**, the `engines.node` floor — a newer version may be
  run in addition, but evidence at the floor is required;
- has its raw report stored under `docs/records/conformance/1.5.0/`, together
  with the Node version, tarball filename and digest, the command, the options
  and six budget limits, and **both** `summary.requests` and
  `budget.requestsMade` under the semantics decided above.

| Field | Production data set |
|---|---|
| Name | AI Lmao Public Knowledge Graph |
| URL | `https://ailmao.com/ai/v1.0/entities/answer/what-is-ai-lmao.json` |
| Owner | Trong Nhan / AI Lmao |
| Operated by AADP maintainers? | Yes |
| Node | `v20.18.1` — engines floor |
| Result | Passed; graph exhausted and non-partial, profile 26/26 |
| Report | [`conformance/1.5.0/ai-lmao-public-knowledge-graph-2026-08-14T13-16-53-572Z-4bbd7826302b.json`](conformance/1.5.0/ai-lmao-public-knowledge-graph-2026-08-14T13-16-53-572Z-4bbd7826302b.json) |

The original two-owner gate was stronger, but it made the release depend on an
external operator who was not available. The maintainer accepted the narrower,
explicit claim: this evidence proves end-to-end production interoperability,
not independent-owner or independent-implementation interoperability.

A second run against the same data set on Node `v20.20.2` is stored alongside it
([`conformance/1.5.0/ai-lmao-public-knowledge-graph-2026-08-14T13-14-02-646Z-4bbd7826302b.json`](conformance/1.5.0/ai-lmao-public-knowledge-graph-2026-08-14T13-14-02-646Z-4bbd7826302b.json)),
above the engines floor rather than at it. It is supporting evidence only: the
gate is closed by the floor run above.

### How the evidence was produced

`scripts/run-traversal-interop.mjs` (`npm run interop:traversal`) performs one
data set's run end to end and writes its raw evidence:

```bash
npm run interop:traversal -- \
  --name "Example Orbit" \
  --url "https://example.com/ai/v1.0/entities/answer/pricing.json" \
  --owner "Example Orbit Ltd" \
  --maintainer-operated false
```

It builds and packs the tarball, records the tarball's sha256, creates a clean
install from that tarball alone, and runs the walk from a probe that imports only
published subpaths (`ail-aadp/traversal/v1.0` plus `ail-aadp/modules/relations/v1.0`
for the budget factory the caller is required to own). Into
`docs/records/conformance/1.5.0/<slug>-<timestamp>-<tarball digest>.json` it
writes the data-set identity, the Node version and whether it is the
`engines.node` floor, the tarball name and digest, the exact command as invoked
(flags included), **all six** ADR-0008 budget limits read back from the budget
itself rather than from the CLI input, **both** `summary.requests` and
`budget.requestsMade`, the whole graph, and the `aadp:graph-traversal@1.0`
profile result. The file name carries a timestamp and digest because raw
evidence is append-only: a rerun on another Node or another tarball is a
different run and must not overwrite the first.

**A run is evidence only if it says so.** The traversal contract reports 404s,
forbidden targets, invalid documents, budget stops and truncated collections as
RESULTS rather than exceptions, so "nothing threw" proves nothing. Every
condition is checked by name (`scripts/interop-acceptance.mjs`, unit-tested in
`tests/package/interop-acceptance.test.ts`) and recorded in the report as
`acceptance_checks`, with a single `eligible_for_release_gate` verdict: the walk
did not throw, a graph exists, the root resolved, `stopReason` is `exhausted`,
`partial` is false, the profile passed with zero failures, all six budget limits
were recorded, the target was a real deployment, and the install was a real clean
install. Running above the `engines.node` floor is reported but does not
disqualify — the gate simply also needs one run at the floor.

Refusals are deliberate: a missing name/URL/owner, a non-HTTPS URL, or an
out-of-range budget value exits non-zero and writes nothing. `--allow-loopback`
and `--offline-node-modules` exist only to validate the script itself against a
local fixture; such a run is stamped in its own output, records
`result: "pipeline-validation"`, is never `eligible_for_release_gate`, and exits
non-zero. A failed run against a real deployment keeps its report — that is how
a deployment's problem gets diagnosed — but can never be mistaken for a closed
gate.

The pipeline was first exercised against a local fixture on 2026-08-14 — both a
linked and a real `npm install` clean install — and correctly refused to call
either one evidence. The production run above then passed on Node 20.18.1 and is
eligible for the release gate.

## Release gate status

| Gate | Status |
|---|---|
| ADR-0011 Accepted before any Phase 1-6 artifact | Closed — Accepted 2026-08-12 |
| No unbounded graph/memory/request | Closed — six budget dimensions plus `maxBufferedEvents` |
| Deterministic ordering | Closed — `graph.ordering.deterministic` and `graph.ordering.mixed_order_equivalence` green |
| `complete` always carries `stopReason`/`partial` | Closed |
| Core-only/single-module consumer unaffected | Closed — `graph.compat.core_only_unchanged` green, and every released Relations/Answer/Evidence test passes with no assertion relaxed |
| Partial result never reported as complete | Closed — ADR-0011 §9 amended so `partial` is independent of `stopReason`; a recoverable branch failure yields `exhausted`/`partial: true`, pinned by `graph.traversal.collection_failure_partial` |
| One production interoperability data set | Closed — AI Lmao public graph, Node 20.18.1, packed-tarball clean install; see raw report above |

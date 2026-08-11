# ADR-0006: Bounded traversal controls (cancellation, concurrency, retry, budget, profiles)

## Status

Accepted — package `ail-aadp` 1.1.0. Does not change the AADP wire version
(`aadp_version` stays `1.0`); this ADR governs the reference client and
conformance runner's own behavior, the "public API/CLI/report" compatibility
contract ADR-0004 calls out as separate from wire compatibility.

## Context

`docs/vi/plans/implementation-plan.md`, in its section on open
maintenance/production issues, explicitly deferred four related capabilities out
of the `1.0.x` line as
`AADP-ROBUSTNESS-001`: caller-driven cancellation, bounded traversal
concurrency, an opt-in retry/backoff policy, and a total request-byte budget
across a whole traversal (the existing `discovery-budget.ts` only bounds page
count, entity count, and wall-clock deadline — not bytes). None of the four
exist in `src/client/http.ts`, `src/client/v1.0/index.ts`, or
`src/conformance/runner.ts` today: traversal is unconditionally serial, there
is no way to pass an external `AbortSignal` in (only an internal per-hop
timeout controller), nothing retries a failed request, and nothing sums
response bytes across more than one request.

Because `FetchJsonOptions`/`ConformanceOptions` are part of the locked public
compatibility contract (`tests/package/compatibility-contract.test.ts`,
ADR-0004), every new field added here is a promise this project keeps under
SemVer from the moment `1.1.0` ships. This ADR fixes the default-compatibility
semantics before any of it is implemented, so no work package can quietly pick
a default that changes `1.0.x` behavior for a caller who upgrades and passes
no new options.

## Decision

### Cancellation

- `FetchJsonOptions` (`src/client/http.ts`) and `ConformanceOptions`
  (`src/conformance/types.ts`) both gain an optional `signal?: AbortSignal`.
- The caller's signal is combined with the existing internal per-hop timeout
  controller via `AbortSignal.any([callerSignal, hopController.signal])`
  (available since Node 20.3.0, inside this package's `engines` floor of
  `>=20.18.1`) — the caller's abort reason propagates through
  `requestWithPolicy()`'s existing `AbortError` handling path unchanged.
- Aborting MUST stop the in-flight request (headers and body), any pending
  retry backoff timer, and MUST cause `iterateSitemap`/`discoverAllEntities`
  and `runConformance` to stop issuing further requests and reject/return
  promptly instead of continuing to the next page/entity/check.
- Omitting `signal` is a no-op behavior change: internal timeout handling is
  unaffected, so every `1.0.x` caller keeps working identically.

### Concurrency

- New optional `concurrency?: number` on `DiscoverAllEntitiesOptions`
  (`src/client/v1.0/index.ts`) **only** — not on `ConformanceOptions`. The
  conformance runner's `CHECKS` (`src/conformance/checks.ts`) never crawl
  more than one entity: `traversal.entity` samples exactly the first entity
  of the first sitemap, and `pagination.contract` walks sitemap *pages*
  sequentially by necessity (each page's cursor is only known once the
  previous page is fetched). There is no parallelizable step in the
  conformance suite today, so a `concurrency` field on `ConformanceOptions`
  would be dead API surface with no code path — it is intentionally left
  off. Only the reference client's bulk `discoverAllEntities` walk has
  independent per-entity fetches to bound.
- `concurrency` bounds how many entity fetches (the only currently
  parallelizable step in `discoverAllEntities`) may be in flight at once.
- **Default is `1`** — fully serial, byte-for-byte the same request ordering
  and timing `1.0.x` produces. A caller who does not set `concurrency` sees
  zero behavior change; a publisher server sees no new traffic pattern from
  an upgraded client that didn't ask for one. Parallelism is opt-in only.
- The scheduler is a pure module (`src/client/scheduler.ts`) taking a bounded
  list of task thunks and a concurrency limit, with no knowledge of HTTP,
  budgets, or retry — those compose around it. It does not reorder
  completed-task delivery relative to input order where the caller depends on
  order (e.g. checksum/dedup bookkeeping keyed by input index, not arrival
  time).

### Retry

- New optional `retry?: RetryOptions` on `FetchJsonOptions` and
  `ConformanceOptions`: `{ maxAttempts?: number; baseDelayMs?: number;
  maxDelayMs?: number }` (all optional; omitting the whole `retry` object
  disables retry entirely).
- **Default is no retry** (`retry` omitted) — identical to every `1.0.x`
  release, which never retries anything. A caller must opt in and choose
  `maxAttempts` to get retry at all.
- When enabled, retry only fires for a fixed, defined set of transient
  outcomes: a network/connect-level error, a request that hit its own
  per-hop `timeoutMs`, and HTTP `429`/`503`. It MUST NOT retry any other 4xx
  (a real client error won't fix itself), MUST NOT retry a
  `BlockedUrlError`/DNS-rebinding block (retrying a security block is never
  correct), and MUST NOT retry past the shared traversal budget or deadline
  (a retry that would exceed the remaining budget/deadline fails immediately
  with the existing budget-exceeded error instead of attempting the request).
- Backoff is exponential with full jitter, seeded from `baseDelayMs`
  (default `500`) and capped at `maxDelayMs` (default `10_000`). A `Retry-After`
  response header (seconds or HTTP-date form) overrides the computed backoff
  for that attempt when present, itself capped at `maxDelayMs` so a
  publisher-supplied value cannot stall a run indefinitely.
- Retried requests re-run the same cross-origin credential/header stripping
  `requestWithPolicy()`'s redirect loop already applies on an origin change —
  a retry is never an avenue for a credential to reach an origin the
  first-hop policy wouldn't otherwise allow it to reach.

### Budget

- `DiscoveryBudgetState` (`src/client/discovery-budget.ts`) gains a byte
  counter alongside its existing page/entity counts and wall-clock deadline:
  new optional `maxTotalBytes` limit charged from the actual bytes
  `readBodyCapped()` streams for every request that goes through the shared
  budget — matching the precedent in `ERROR_LOG.md` 2026-07-27, every HTTP
  call site in `checks.ts`/`runner.ts` must charge the same shared object,
  not just the main traversal loop, or the same class of bug (budget bypass
  via cache-validator/negative-target requests) recurs for the new dimension.
- Omitting `maxTotalBytes` (the default) means unlimited total bytes — same
  as today, where only `maxResponseBytes` (per-request cap) exists.
- Exceeding the byte budget throws the same `AadpDiscoveryBudgetExceededError`
  family the page/entity/deadline budgets already use, so existing callers
  catching that error see no new error type to handle.

### Conformance profiles

- A `ConformanceProfile` union type — `"core" | "public-web" |
  "full-traversal" | "authenticated"` — is a **named preset of budget and
  retry defaults only** (no `concurrency`: see "Concurrency" above — the
  conformance runner has no parallelizable step for it to bound). It does
  not change which check IDs run or add new checks; the existing `CHECKS`
  array and every currently stable check `id` stay exactly as they are for
  every profile. This keeps the feature additive without inventing new
  authenticated-resource check semantics that no design doc has specified.
- `core`: today's implicit defaults, unchanged (no retry, today's
  `maxPages`/`maxEntities`/`maxSitemaps`/`deadlineMs` values) — an explicit
  name for "what `1.0.x` already does."
  `public-web`: same as `core`; an explicit name for the common case of
  crawling a public, non-authenticated deployment (may diverge from `core`'s
  numbers in a later release without either name changing meaning
  retroactively; identical at introduction).
  `full-traversal`: higher `maxPages`/`maxEntities`/`deadlineMs`, for
  deliberately exhaustive/slow crawls where a publisher has agreed to the
  traffic.
  `authenticated`: same numeric preset as `public-web`, plus documents the
  expectation that the caller supplies credentials via `headers`; carried in
  the JSON report's `profile` field so a CI job can tell which preset a run
  used without re-deriving it from the flags passed.
- `ConformanceOptions.profile?: ConformanceProfile` is applied first, then any
  explicit option the caller also set overrides that profile's value for that
  one field — a profile is a bundle of defaults, never a lock. Omitting
  `profile` entirely is exactly `core`.
- `report.profile` (optional field, only present when the caller passed one)
  records which preset a run used, for CI traceability across scheduled runs
  (`.github/workflows/scheduled-conformance.yml`).

### Testability (not part of the public contract)

- **Revised from the original draft of this ADR**, which proposed an
  internal `now?: () => number` clock-injection parameter threaded through
  the scheduler/retry/budget modules. That was never built. Every existing
  timing-sensitive test in this repo (`tests/client/v1.0.test.ts`'s
  `timeout`/`cancellation` blocks, predating this ADR) already used real
  short `setTimeout`s against a real local `node:http` mock server rather
  than a fake clock, so the retry/deadline tests written for this ADR's
  implementation follow that same established convention instead —
  `baseDelayMs`/`deadlineMs` set to single-digit milliseconds, asserting on
  real elapsed time and real request counts. This keeps the test style
  uniform across the file rather than introducing a second, DI-based
  pattern used nowhere else. `Date.now()`, `Math.random()`, `setTimeout`,
  and the global `fetch` are called directly with no injection point, in
  both `http.ts` and `discovery-budget.ts`.
- Consequence: a test that needs to assert an exact boundary (e.g. "a retry
  whose delay alone would exceed the remaining deadline throws instead of
  sleeping") uses a tiny real `deadlineMs` and a tiny real backoff, not a
  fake clock tick — see `tests/client/v1.0.test.ts`'s "retry
  (options.retry)" describe block. This is slower per-test (single-digit
  milliseconds, not zero) and was the proximate cause of one flaky-looking
  failure during implementation (a real request's round-trip time occasionally
  landed on the wrong side of a boundary that should have been decided by
  logic, not timing) — root-caused to a classification bug
  (`isRetryableError()` not excluding `AadpDiscoveryBudgetExceededError`),
  not the timing approach itself; see `ERROR_LOG.md` 2026-08-03. Revisit
  fake-clock injection only if a specific boundary proves impossible to pin
  reliably with real short timers — none has yet.

## Consequences

- A caller who upgrades to `1.1.0` and changes nothing keeps `1.0.x`'s exact
  request count, ordering, and timing: no signal, `concurrency: 1`, no retry,
  no total-byte cap, no profile. This is the release gate's "defaults keep
  `1.0.x` behavior" requirement made concrete per field.
- Every new field is optional and additive to a type already covered by
  `tests/package/compatibility-contract.test.ts`; that test suite must grow
  assertions for the new fields' presence/shape as part of implementing this
  ADR, not as an afterthought.
- `authenticated` and `public-web` are numerically identical at introduction
  by design — this ADR intentionally does not invent auth-specific
  conformance checks. A future ADR is needed before `authenticated` can mean
  anything behaviorally different from `public-web`.
- The scheduler/retry/budget modules are plain functions over
  `DiscoveryBudgetState`/options — no HTTP or CLI concern leaks into them —
  but, per the "Testability" revision above, they are **not**
  clock/fetch-injectable: `Date.now()`, `Math.random()`, `setTimeout`, and
  the global `fetch` are called directly. Their tests stay deterministic on
  *state transitions* (attempt counts, which error type, budget fields)
  using real short timers against a real local mock server, not a fake
  clock. `docs/vi/plans/implementation-plan-v1.1.0.md`'s architecture note
  predates this revision and has been updated to match.

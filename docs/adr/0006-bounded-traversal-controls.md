# ADR-0006: Bounded traversal controls (cancellation, concurrency, retry, budget, profiles)

## Status

Accepted — package `ail-aadp` 1.1.0. Does not change the AADP wire version
(`aadp_version` stays `1.0`); this ADR governs the reference client and
conformance runner's own behavior, the "public API/CLI/report" compatibility
contract ADR-0004 calls out as separate from wire compatibility.

## Context

`docs/vi/plans/implementation-plan.md` §"Issue bảo trì/production còn mở"
explicitly deferred four related capabilities out of the `1.0.x` line as
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
  (`src/client/v1.0/index.ts`) and `ConformanceOptions`, bounding how many
  entity fetches (traversal's only currently-parallelizable step; sitemap
  index → sitemap page fetching stays sequential since later pages are only
  discovered from earlier ones) may be in flight at once.
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
  "full-traversal" | "authenticated"` — is a **named preset of budget,
  concurrency and retry defaults only**. It does not change which check IDs
  run or add new checks; the existing `CHECKS` array and every currently
  stable check `id` stay exactly as they are for every profile. This keeps
  the feature additive without inventing new authenticated-resource check
  semantics that no design doc has specified.
- `core`: today's implicit defaults, unchanged (`concurrency: 1`, no retry,
  today's `maxPages`/`maxEntities`/`maxSitemaps`/`deadlineMs` values) — an
  explicit name for "what `1.0.x` already does."
  `public-web`: same as `core`; an explicit name for the common case of
  crawling a public, non-authenticated deployment (may diverge from `core`'s
  numbers in a later release without either name changing meaning
  retroactively; identical at introduction).
  `full-traversal`: higher `maxPages`/`maxEntities`/`deadlineMs` and
  `concurrency > 1`, for deliberately exhaustive/slow crawls where a
  publisher has agreed to the traffic.
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

- The scheduler, retry policy, and budget modules take their clock
  (`now?: () => number`) and, where relevant, their request function as plain
  constructor/call parameters with real defaults (`Date.now`, the module's
  own `fetchJson`), so unit tests can inject a fake clock/fetch for
  deterministic timing assertions (backoff delay, deadline expiry) without
  real `setTimeout`/network calls. These parameters are internal-only: they
  are not exposed on `FetchJsonOptions`/`ConformanceOptions`/`RetryOptions`,
  are not part of `ail-aadp`'s public exports, and are not covered by the
  tarball compatibility tests — adding or changing them is not a SemVer
  event. Only regular unit tests under `tests/client/`, `tests/conformance/`
  (which import from `src/`, not the tarball) use them.

## Consequences

- A caller who upgrades to `1.1.0` and changes nothing keeps `1.0.x`'s exact
  request count, ordering, and timing: no signal, `concurrency: 1`, no retry,
  no total-byte cap, no profile. This is the release gate's "default giữ
  behavior `1.0.x`" requirement made concrete per field.
- Every new field is optional and additive to a type already covered by
  `tests/package/compatibility-contract.test.ts`; that test suite must grow
  assertions for the new fields' presence/shape as part of implementing this
  ADR, not as an afterthought.
- `authenticated` and `public-web` are numerically identical at introduction
  by design — this ADR intentionally does not invent auth-specific
  conformance checks. A future ADR is needed before `authenticated` can mean
  anything behaviorally different from `public-web`.
- The scheduler/retry/budget modules being clock/fetch-injectable pure
  modules (internal-only parameters) is what makes their tests deterministic
  without real timers or network access, per
  `docs/vi/plans/implementation-plan-v1.1.0.md`'s own architecture note.

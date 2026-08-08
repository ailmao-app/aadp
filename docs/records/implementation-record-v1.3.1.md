# AADP `ail-aadp` 1.3.1 Implementation Record — Resolution context binding

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | **Implementation complete; publication and advisory pending maintainer action** — see [Open release actions](#open-release-actions) |
| Audience | Package maintainers and release reviewers |
| Scope | Security patch to the Answer `1.0` client's per-budget canonical resolution state, delivered in package version `1.3.1` |
| Wire impact | None. No schema, no module version, no public export changed |
| Vietnamese internal edition | [`../vi/plans/implementation-plan-v1.3.1.md`](../vi/plans/implementation-plan-v1.3.1.md) |

## Abstract

This memo records the security defect fixed in `1.3.1`, the contract chosen to
fix it, the invariants a future refactor MUST preserve, and the verification
actually run. It is informational and does not override the Answer
specification or schemas.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Defect

`resolveAnswerTargets` keeps per-budget resolution state — settled canonical
outcomes, in-flight fetches, and per-key budget stops — keyed by the caller-owned
`RelationsTraversalBudgetState` object identity. That state is deliberately
long-lived: it outlives one call and is race-safe across concurrent calls sharing
a budget, so a canonical target is fetched at most once per budget.

Its keys are `{budget, canonical target}` only. Every option that shapes the
actual request — `headers`, `crossOriginSafeHeaders`, `urlPolicy`, `rootOrigin`,
`timeoutMs`, `maxRedirects`, `maxResponseBytes`, `retry`, `onBeforeAttempt` — is
supplied **per call**. Sharing one budget between calls with different options
therefore shared results and requests across them:

| Path | Consequence |
|---|---|
| Authenticated call then anonymous call | The anonymous call replayed the entity fetched with the other call's credentials, never issuing the request that would have returned `401`/`403` |
| High `maxResponseBytes` then low | The stricter call replayed a response larger than its own cap, bypassing that limit |
| Concurrent calls, different options | Whichever call created the in-flight entry first supplied the options for the single shared request; both inherited that result |

Affected release: `1.3.0` only — the release that introduced this state. The
defect requires the consuming application to share one budget object across
calls with differing options. That is documented, intended usage, **not**
consumer misuse: the bug is that the cache did not distinguish contexts.

## Fix

A **resolution context** is bound to a budget's state on first use and enforced
on every later use.

| Decision | Value |
|---|---|
| Rule | One budget means one immutable request configuration — not merely one principal |
| In the context | `headers` (names and values), `crossOriginSafeHeaders`, `urlPolicy`, `rootOrigin`, `timeoutMs`, `maxRedirects`, `maxResponseBytes`, `retry`, `onBeforeAttempt` |
| Out of the context | `signal` only — caller-local waiting state, never forwarded to the shared fetch |
| On mismatch | Throw `AadpClientError` with `code: "resolution_context_mismatch"` |
| When | Before any cache replay, in-flight join, budget charge or request, so a rejected call is a no-op |
| Stored | An HMAC-SHA-256 digest under a per-process random key. Raw header values are never retained |
| Error message | Names no option, header or digest; safe to log |

`signal` is excluded because a canonical target's fetch is never tied to any one
caller's signal — each reference races only its own wait against its own signal —
so two calls differing only by `signal` legitimately share a context.

`urlPolicy` and `onBeforeAttempt` are compared by **reference identity** (a
`WeakMap` of opaque ids), mirroring how `dispatcherFor` already keys its
connection-pool `WeakMap` on `UrlPolicy` identity. Two structurally identical
policies from separate `createStrictUrlPolicy()` calls are deliberately not
interchangeable: neither this module nor `dispatcherFor` can prove they behave
identically.

### Invariants a future refactor MUST preserve

`1.4.0` lifts this state into a shared Answer/Evidence canonical-resolution
layer. That refactor MUST **extract**, not reimplement, the following. Each is
covered by a test named in [Verification](#verification).

1. Context binding happens **before** `collectReferences` and before anything can
   charge the budget or reach the network. A mismatched call must not mutate the
   budget or issue a request.
2. The context covers every request-affecting option, not just authorization
   ones. Dropping `maxResponseBytes` in particular reopens a safety-limit bypass.
3. Mismatch is an exception, never a per-reference resolution status. Expressing
   it as `forbidden`/`invalid` would hide a caller programming error inside an
   ordinary-looking result.
4. Normalization treats equivalent option sets as one context: header-name
   casing, `crossOriginSafeHeaders` order/duplicates/casing, and omitted values
   versus explicitly passed defaults.
5. Encoding is length-prefixed, so no header name or value can forge a field
   boundary and collide with a different option set.
6. Only a per-process-keyed digest is stored, and no header value or digest
   reaches an error message or log.

## Files

| File | Change |
|---|---|
| `src/modules/answer/v1.0/client/resolution-context.ts` | New, module-internal. Digest, normalization, reference identity |
| `src/modules/answer/v1.0/client/resolve.ts` | `BudgetResolutionState.contextDigest`; `stateFor` binds/enforces; called first in `resolveAnswerTargets` |
| `tests/modules/answer/v1.0/client/resolution-context.test.ts` | New. 21 tests |
| `CHANGELOG.md` | `1.3.1` entry with a `Security` heading |
| `SECURITY.md` | New. Private reporting channel, supported versions, scope |

No file under `schemas/` changed. No export was added, changed or removed:
`AadpClientError` and its `code` field were already public, which is why the fix
needs no new public type.

## Verification

| Command | Result |
|---|---|
| `npm run build` | Pass |
| `npm test` | Pass — 47 files, 841 tests |
| `npm run docs:check` | Pass — all relative links resolve |
| `npm run check:release-consistency` | Pass |
| `npm pack --dry-run` | Pass |

### Defect reproduction

The new tests were run against the **unfixed** tree first, by stashing only the
`src/` change: **16 of 21 failed**, including every authorization-boundary case
and both `maxResponseBytes` cases. With the fix restored, all 21 pass. The suite
therefore demonstrates the defect rather than merely describing the new code.

### Regression evidence

All 153 pre-existing Answer tests pass **unmodified**. No existing test asserted
the cross-context sharing behaviour, so the exception permitted by the plan — to
amend a test that documented the bug — was not needed.

## Compatibility

- Intended usage (one budget, one configuration) is unchanged: same results,
  same request counts, same budget accounting.
- Reusing one budget with different options now throws where it previously shared
  silently. This is wider than credentials alone and is called out in the
  CHANGELOG, because varying `timeoutMs`, `maxRedirects`, `maxResponseBytes` or
  `retry` across calls on one budget now throws too.
- No wire, schema or module-version change: `aadp:answer@1.0` and
  `aadp:relations@1.0` are untouched, so no module version is bumped.

## Open release actions

These are outward-facing maintainer decisions and are **not** performed by this
record.

| Action | Status |
|---|---|
| Publish `ail-aadp@1.3.1` to npm | Pending |
| Publish a GitHub Security Advisory (affected `= 1.3.0`, patched `1.3.1`) | Pending |
| Request a CVE through that advisory | Pending decision |
| `npm deprecate ail-aadp@1.3.0` | Pending decision |

Do not `npm unpublish` `1.3.0`: it breaks consumers pinning it and does not
remove mirrored copies. Deprecation plus an advisory is the correct path.

Proposed severity is **Moderate**: confidentiality only, no integrity or
availability impact, and not attacker-initiated — it requires the consuming
application to share a budget across contexts. The final CVSS vector is a
maintainer decision, since the score depends on assumptions about consumer
deployment shape.

## Downstream dependency

[`implementation-plan-v1.4.0.md`](../vi/plans/implementation-plan-v1.4.0.md)
Phase 4 must be revised to **inherit and extract** this contract rather than
implement context rules a second time. Two independent implementations of the
normalization/digest/mismatch behaviour would drift and could reintroduce this
defect during the shared-layer refactor.

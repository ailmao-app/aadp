# AADP Answer Module v1.0 Conformance

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:answer` |
| Module version | `1.0` |
| Runner | `runAnswerConformance` (`ail-aadp/modules/answer/v1.0`) |

## 1. Purpose

Defines the stable check IDs, issue taxonomy and normative/advisory boundary for
Answer `1.0` conformance. It does not change the core `CHECKS`/check IDs or the
Relations `RELATIONS_CHECKS` (ADR-0007, "Conformance boundary").

## 2. Check catalog

| Check ID | Group | Content | Required/Optional |
|---|---|---|---|
| `answer.discovery` | discovery | The manifest advertises the correct `{id, version, schema}` for `aadp:answer@1.0` | Required |
| `answer.resource` | resource | A sample Answer entity fetches successfully through the core discovery/entity flow | Required |
| `answer.schema` | schema | The `x_answer` wrapper passes the Answer `1.0` schema | Required |
| `answer.semantic` | semantic | Pure wrapper semantic invariants (including `content_checksum`) are green | Required |
| `answer.context` | context | Entity type, `x_answer` presence, `entity.canonical_url` presence and URL policy, and `updated_at` equality are green | Required |
| `answer.authorship` | authorship | The discriminator and provenance are unambiguous (`author.url` policy) | Required |
| `answer.references` | references | `related_entities` AND (for a generated summary) `authorship.source_targets` resolve through the Relations resolver on the shared budget | Required when a sample exists |
| `answer.freshness` | freshness | Timestamp semantics and injected-clock classification are correct | Required |
| `answer.security` | security | Free text is inert; URL/target resolution does not bypass policy | Required |

Each check is a pure async function over `AnswerCheckContext`, with no baked-in
fixture. A check depending on a sample document (`options.sampleEntityUrl`) is
`skipped`/`inconclusive` and NEVER `failed` when no sample is available — the
same reasoning as the core `ConformanceOptions.negativeTargets`.
`answer.references` is `inconclusive` only when the sample answer has neither
`related_entities` nor (for a generated summary) `authorship.source_targets` — a
generated summary that has only `source_targets` and no `related_entities` must
still be exercised, because `source_targets` is mandatory provenance for a
generated summary, not an incidental field.

## 3. Prerequisite chain

`answer.resource` is a prerequisite of every check except `answer.discovery`.
`answer.schema` is a prerequisite of `answer.semantic`, `answer.authorship`,
`answer.references` and `answer.freshness`. A `failed`/`skipped` prerequisite
makes the dependent check `skipped` with an explanatory message rather than
letting it run.

## 4. Status taxonomy

`passed`/`failed`/`warning`/`skipped`, as in core (`CheckStatus`). `skipped`
with `inconclusive: true` means the runner reached no verdict (a missing sample
URL, or the traversal budget cutting the run short) — it is not evidence of
conformance. The overall `report.status` is `failed` when a check failed (or
warned, under `failOnWarning`); `inconclusive` when a check is inconclusive but
none failed; otherwise `passed`.

## 5. Options boundary

The runner supports authenticated servers under the same option boundary as
Relations: `headers`, `crossOriginSafeHeaders`,
`urlPolicy`/`allowPrivateNetwork`,
`timeoutMs`/`maxRedirects`/`maxResponseBytes`/`retry`, traversal limits
(`maxPages`/`maxDepth`/`maxNodes`/`maxRequests`/`maxTotalBytes`/
`maxCrossOriginRequests`/`deadlineMs`), `now` (an injected clock for
`answer.freshness`), `signal` (`AbortSignal`), `failOnWarning` and `onCheck`.

The report distinguishes a failed check, an unsupported module (not declared in
the manifest → `answer.discovery` inconclusive), and a traversal/budget failure
(`skipped` + `inconclusive`, not `failed`). An external consumer using only the
public package exports from a clean install must pass every required check
without importing source internals — see `tests/package/*`.

`runAnswerConformance` validates every numeric option
(`timeoutMs`/`maxRedirects`/`maxResponseBytes`/`maxPages`/`maxDepth`/`maxNodes`/
`maxRequests`/`maxTotalBytes`/`maxCrossOriginRequests`/`deadlineMs`),
`retry.maxAttempts`/`retry.baseDelayMs`/`retry.maxDelayMs`, and `now` UP FRONT —
before the first request — and throws
`InvalidAnswerConformanceOptionsError` for an unusable value (`NaN`,
non-integer, negative, below that option's minimum, or a `now` that is not a
valid Date). A caller's misconfiguration MUST NEVER be recorded as
`status: "failed"` against the deployment under test. `maxRedirects`,
`maxDepth`, `maxNodes` and `maxCrossOriginRequests` accept `0` as a valid
boundary value, because their scope is narrow enough not to block the whole run:
`maxDepth`/`maxNodes` are charged only for the Relations resolution of each
Answer target (stopping traversal before even the first target, say), not for
the manifest or sample entity fetch; `maxCrossOriginRequests` only blocks
cross-origin requests, so a normal run's same-origin requests still go through.
`maxRequests`, by contrast, is charged for EVERY HTTP attempt in the run —
including manifest discovery and the sample entity fetch, not just Answer target
resolution — so it requires a minimum of 1, like the other transport/core
dimensions (`timeoutMs`, `maxResponseBytes`, `maxPages`, `deadlineMs`,
`maxTotalBytes`, `retry.maxAttempts`), because `0` in any of those makes the
run's very first request impossible.

## 6. Unsupported version

An unsupported Answer version is NOT a remote deployment conformance check — a
runner cannot require a conforming server to advertise a fake version. That
behaviour is tested in the package compatibility suite with a synthetic
manifest/entity: a core-only consumer must ignore `x_answer`, and an opt-in
Answer consumer must report `unsupported_module_version` without falling back to
`1.0`.

## 7. Security check scope

`answer.security` scans free text (`question`/`concise_answer`/`answer`) for
prompt-injection-shaped substrings, but does NOT treat the presence of such a
substring as a failure — free text containing one is still valid, inert data
(specification.md §14). The real pass condition is the absence of a crash or
behaviour change, which a static scan alone cannot prove; this check reports any
substring it finds as a `warning` (informational), not `failed`. The check also
warns when the run uses a non-default URL policy
(`allowPrivateNetwork`/custom `urlPolicy`) — SSRF protection was deliberately
relaxed for that run.

## 8. Normative fixture catalog

See `tests/fixtures/answer/v1.0/{valid,invalid}/*.json` and
`tests/modules/answer/v1.0/fixtures.test.ts` for the full list and the expected
issue-code mapping. The catalog covers: minimal and complete source-authored
answers, generated summaries with and without human review, a locale with a
region plus millisecond timestamps, an expired answer, a cross-plane Unicode key
in the Relations `target.x_*`; and, on the invalid side, missing required
fields, a `content_checksum` mismatch for each field group, the `short_answer`
alias, mixed/incomplete authorship, a generated summary with missing or
duplicate source targets, locale/timestamp/URL policy violations, empty,
duplicate or invalid applicability, related entities over the limit or
duplicated, and prompt-injection text (which must remain valid — it is not an
invalid fixture).

## 9. Report shape

`AnswerConformanceReport`: `report_version`, `aadp_version`, `module`,
`package_version`, `base_url?`, `runner`, `started_at`/`finished_at`/
`duration_ms`, `status`, `summary`, `effective_limits`, `checks[]`. The renderer
emits text, JSON or JUnit; `answerExitCodeFor` returns `0` for conformant, `1`
when a check failed, and `4` for inconclusive (nothing certifiable) — the same
contract as the core and Relations runners.

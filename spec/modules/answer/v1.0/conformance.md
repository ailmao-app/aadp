# AADP Answer Module v1.0 Conformance

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:answer` |
| Module version | `1.0` |
| Runner | `runAnswerConformance` (`ail-aadp/modules/answer/v1.0`) |

## 1. Purpose

Xác định check ID ổn định, taxonomy issue, và normative/advisory boundary cho
Answer `1.0` conformance. Không thay đổi core `CHECKS`/check ID hay Relations
`RELATIONS_CHECKS` (ADR-0007 "Conformance boundary").

## 2. Check catalog

| Check ID | Group | Nội dung | Required/Optional |
|---|---|---|---|
| `answer.discovery` | discovery | Manifest quảng bá đúng `{id, version, schema}` cho `aadp:answer@1.0` | Required |
| `answer.resource` | resource | Fetch sample Answer entity thành công qua core discovery/entity flow | Required |
| `answer.schema` | schema | Wrapper `x_answer` đúng Answer `1.0` schema | Required |
| `answer.semantic` | semantic | Pure wrapper semantic invariants (bao gồm `content_checksum`) xanh | Required |
| `answer.context` | context | Entity type, `x_answer` presence, `entity.canonical_url` presence/URL-policy, `updated_at` equality xanh | Required |
| `answer.authorship` | authorship | Discriminator/provenance không mơ hồ (`author.url` policy) | Required |
| `answer.references` | references | `related_entities` resolve bằng Relations resolver/shared budget | Required khi có sample |
| `answer.freshness` | freshness | Timestamp semantics và injected-clock classification đúng | Required |
| `answer.security` | security | Free text inert; URL/target resolution không bypass policy | Required |

Mỗi check là async function thuần trên `AnswerCheckContext`, không baked-in
fixture. Check phụ thuộc sample document (`options.sampleEntityUrl`) là
`skipped`/`inconclusive`, KHÔNG BAO GIỜ `failed`, khi không có sample — cùng lý
do với core `ConformanceOptions.negativeTargets`. `answer.references` là
`inconclusive` khi sample answer không có `related_entities`.

## 3. Prerequisite chain

`answer.resource` là prerequisite của mọi check trừ `answer.discovery`.
`answer.schema` là prerequisite của `answer.semantic`, `answer.authorship`,
`answer.references`, `answer.freshness`. Một prerequisite `failed`/`skipped`
khiến check phụ thuộc bị `skipped` với message giải thích, không tự chạy.

## 4. Status taxonomy

`passed`/`failed`/`warning`/`skipped`, giống core (`CheckStatus`). `skipped`
với `inconclusive: true` nghĩa là runner không đạt verdict (thiếu sample URL,
hoặc traversal budget cắt ngang) — không phải bằng chứng conformance. Overall
`report.status` là `failed` nếu có check `failed` (hoặc `warning` khi
`failOnWarning`); `inconclusive` nếu có check inconclusive nhưng không có
`failed`; ngược lại `passed`.

## 5. Options boundary

Runner hỗ trợ server có auth theo cùng option boundary với Relations:
`headers`, `crossOriginSafeHeaders`, `urlPolicy`/`allowPrivateNetwork`,
`timeoutMs`/`maxRedirects`/`maxResponseBytes`/`retry`, traversal limits
(`maxPages`/`maxDepth`/`maxNodes`/`maxRequests`/`maxTotalBytes`/
`maxCrossOriginRequests`/`deadlineMs`), `now` (injected clock cho
`answer.freshness`), `signal` (`AbortSignal`), `failOnWarning`, `onCheck`.

Report phân biệt failed check, unsupported module (không declare trong
manifest → `answer.discovery` inconclusive), và traversal/budget failure
(`skipped`+`inconclusive`, không phải `failed`). Một external consumer
clean-install chỉ dùng public package exports phải đạt toàn bộ required checks
mà không import source internals — xem `tests/package/*`.

## 6. Unsupported version

Unsupported Answer version KHÔNG phải remote deployment conformance check —
runner không thể yêu cầu một conforming server quảng bá version giả. Hành vi
này được kiểm tra trong package compatibility suite bằng synthetic
manifest/entity: core-only consumer phải bỏ qua `x_answer`, opt-in Answer
consumer phải trả `unsupported_module_version` và không fallback sang `1.0`.

## 7. Security check scope

`answer.security` scan free text (`question`/`concise_answer`/`answer`) cho
prompt-injection-shaped substring, nhưng KHÔNG coi sự hiện diện của một
substring như vậy là failure — free text chứa chuỗi đó vẫn là valid, inert
data (specification.md §14). Absence của một crash/behavior change là điều
kiện pass thật sự, thứ mà một static scan một mình không chứng minh được;
check này report substring tìm thấy như `warning` (thông tin), không `failed`.
Check cũng cảnh báo khi run dùng non-default URL policy
(`allowPrivateNetwork`/custom `urlPolicy`) — SSRF protection bị nới lỏng có
chủ đích cho run đó.

## 8. Normative fixture catalog

Xem `tests/fixtures/answer/v1.0/{valid,invalid}/*.json` và
`tests/modules/answer/v1.0/fixtures.test.ts` cho danh sách đầy đủ + mapping
issue code kỳ vọng. Danh mục bao phủ: source-authored tối thiểu/đầy đủ,
generated-summary có/không human review, locale với region + millisecond
timestamp, expired answer, Relations `target.x_*` cross-plane Unicode key;
thiếu required field, `content_checksum` mismatch cho từng nhóm field, alias
`short_answer`, authorship mixed/incomplete, generated summary thiếu/duplicate
source target, locale/timestamp/URL policy violation, applicability rỗng/
duplicate/invalid, related entity vượt limit/duplicate, prompt-injection text
(vẫn phải valid — không phải invalid fixture).

## 9. Report shape

`AnswerConformanceReport`: `report_version`, `aadp_version`, `module`,
`package_version`, `base_url?`, `runner`, `started_at`/`finished_at`/
`duration_ms`, `status`, `summary`, `effective_limits`, `checks[]`. Renderer
xuất text/JSON/JUnit; `answerExitCodeFor`: `0` conformant, `1` một check
failed, `4` inconclusive (nothing certifiable) — cùng contract với core/
Relations runner.

# AADP Evidence & Provenance Module v1.0 Conformance

## Document metadata

| Field | Value |
|---|---|
| Status | **Draft — non-normative** |
| Gate | [ADR-0010](../../../../docs/adr/0010-evidence-citation-provenance-and-security.md) phải Accepted |
| Module ID | `aadp:evidence` (đề xuất, chưa allocated) |
| Module version | `1.0` (đề xuất) |
| Runner | `runEvidenceConformance` (`ail-aadp/modules/evidence/v1.0`) — chưa tồn tại |
| Specification | [`specification.md`](specification.md) |

> **Draft.** Check ID dưới đây là đề xuất và chưa ổn định. Không implement runner
> trước khi ADR-0010 Accepted.

## 1. Purpose

Xác định check ID ổn định, taxonomy issue và ranh giới normative/advisory cho
Evidence `1.0` conformance. Tài liệu này KHÔNG thay đổi core `CHECKS`, Relations
`RELATIONS_CHECKS` hay Answer check ID
([ADR-0007](../../../../docs/adr/0007-module-versioning-and-discovery.md)
"Conformance boundary").

## 2. Check catalog

| Check ID | Group | Nội dung | Required/Optional |
|---|---|---|---|
| `evidence.discovery` | discovery | Manifest quảng bá đúng `{id, version, schema}` cho `aadp:evidence@1.0` | Required |
| `evidence.resource` | resource | Fetch sample claim và evidence entity qua core discovery/entity flow | Required |
| `evidence.schema` | schema | Wrapper `x_evidence` đúng Evidence `1.0` schema | Required |
| `evidence.semantic` | semantic | Pure wrapper semantic invariants (gồm `content_checksum`) xanh | Required |
| `evidence.context` | context | Entity type, `x_evidence` presence, canonical URL policy, và **ordering** `provenance.retrieved_at <= entity.updated_at` (KHÔNG phải equality) | Required |
| `evidence.graph` | graph | Claim → evidence resolve; không `not-found`/`invalid`; fan-in dedup đúng (một evidence chỉ fetch một lần trong một walk) | Required khi có sample claim |
| `evidence.stance` | stance | Stance/confidence semantics; vắng `confidence` không bị suy diễn thành `0`/`1` | Required |
| `evidence.provenance` | provenance | Timestamp ordering, precedence và freshness classification | Required |
| `evidence.answer_link` | integration | Answer `related_entities` tới claim/evidence resolve được, claim được expand tới evidence (hai hop), `x_answer` không đổi | Required khi có sample answer |
| `evidence.security` | security | Free text inert; URL/DNS/redirect policy; `access` không cấp quyền | Required |

Mỗi check là async function thuần trên context của runner, không baked-in
fixture. Check phụ thuộc sample document là `skipped`/`inconclusive`, **KHÔNG BAO
GIỜ `failed`**, khi không có sample — cùng lý do với core
`ConformanceOptions.negativeTargets` và Answer.

## 3. Prerequisite chain

`evidence.resource` là prerequisite của mọi check trừ `evidence.discovery`.
`evidence.schema` là prerequisite của `evidence.semantic`, `evidence.stance`,
`evidence.provenance`, `evidence.graph`, `evidence.answer_link`. Một prerequisite
`failed`/`skipped` khiến check phụ thuộc bị `skipped` với message giải thích,
không tự chạy.

## 4. Status taxonomy

`passed`/`failed`/`warning`/`skipped`, giống core (`CheckStatus`). `skipped` với
`inconclusive: true` nghĩa là runner không đạt verdict (thiếu sample URL, hoặc
traversal budget cắt ngang) — không phải bằng chứng conformance. Overall status
là `failed` nếu có check `failed` (hoặc `warning` khi `failOnWarning`);
`inconclusive` nếu có check inconclusive nhưng không `failed`; ngược lại
`passed`.

## 5. Dangling và `forbidden`

Gate "không dangling reference" nghĩa là: run trên reference deployment không có
entry `not-found` hoặc `invalid`.

Entry `forbidden` — 401/403, hoặc URL/DNS policy chặn — **luôn là kết quả hợp lệ
và KHÔNG fail gate**. Phân loại này MUST NOT đọc `source.access`
([specification.md §12](specification.md)): khi target trả 401/403 thì body
không tồn tại để đọc field đó.

## 6. Options boundary

Runner hỗ trợ server có auth theo cùng option boundary với Relations/Answer, và
dùng cùng caller-owned `RelationsTraversalBudgetState`. Report phân biệt ba thứ
khác nhau: **failed check**, **unsupported module** và **traversal/budget
failure** — gộp chúng lại sẽ khiến một budget cạn trông như một deployment không
conformant.

Runner MUST validate mọi numeric/`retry`/`now` option trước khi phát request,
giống preflight của core và Answer runner, để một misconfiguration của caller
không bị ghi thành `failed` check của deployment.

Unsupported Evidence version KHÔNG phải remote deployment check — runner không
thể yêu cầu một conforming server quảng bá version giả. Hành vi này kiểm bằng
synthetic manifest/entity trong package compatibility suite: core-only consumer
bỏ qua `x_evidence`; opt-in consumer trả `unsupported_module_version` và không
fallback.

## 7. Security check scope

`evidence.security` scan free text (`statement`, `summary`, `excerpt`, `notes`,
`source.title`, `publisher.name`) cho prompt-injection-shaped substring nhưng
**KHÔNG** coi sự hiện diện của chúng là failure — text đó vẫn là valid, inert
data. Absence của crash/behavior change mới là điều kiện pass thật, thứ một
static scan một mình không chứng minh được; substring tìm thấy report như
`warning`.

Check cũng phải khẳng định:

- `source.url`/`publisher.url` KHÔNG bị fetch trong bất kỳ run nào;
- một evidence có `access: authenticated` KHÔNG được đối xử khác một evidence
  `public` ở bất kỳ quyết định traversal hay verdict nào;
- run dùng non-default URL policy (`allowPrivateNetwork`/custom `urlPolicy`) được
  cảnh báo, vì SSRF protection bị nới lỏng có chủ đích cho run đó.

## 8. Fixture catalog (đề xuất)

Valid fixtures tối thiểu: claim tối thiểu một ref `support`; claim có
`contradict` và `neutral`, có/không `confidence`; evidence `access: public` đủ ba
timestamp; evidence `access: authenticated` (chứng minh `access` không đổi kết
quả); evidence sau resource `security` declaration (401/403 → `forbidden`, không
dangling); evidence có `retrieved_at` **sớm hơn** `entity.updated_at`; evidence
có `excerpt` và Relations `target.x_*` cross-plane Unicode key; answer tham chiếu
claim qua `related_entities`; fan-in hai claim → một evidence; answer → claim →
evidence hai hop; answer trỏ đồng thời tới E và tới C1 (C1 → E) với **hai bản đảo
thứ tự**; answer khai sai `target_type` cho một target mà claim khai đúng, cũng
hai bản đảo thứ tự; generated-summary answer có `source_targets` không rỗng.

Invalid fixtures tối thiểu: sai module/version/kind hoặc unknown field; thiếu
required field; `content_checksum` sai sau khi mutate từng nhóm field normative;
checksum tính theo code-point ordering thay vì UTF-16 code unit ordering;
`confidence` ngoài `[0,1]`/quá 2 chữ số thập phân/là string; `stance`/`access`
ngoài enum; timestamp sai format hoặc sai thứ tự, `retrieved_at` muộn hơn core
`updated_at`; `target_type` khác hằng `evidence`; duplicate canonical target;
`evidence_refs` rỗng hoặc vượt 50; `source.url`/`publisher.url` dùng HTTP,
userinfo, fragment hoặc malformed; source URL trỏ private/link-local/reserved
address; redirect chain sang private address.

Fixtures dùng domain `example.com`, tên trung tính, deterministic timestamp. Mỗi
invalid fixture chỉ nên có một primary failure. Prompt-injection fixture là
**valid**, không phải invalid.

## 9. Report shape

`EvidenceConformanceReport`: `report_version`, `aadp_version`, `module`,
`package_version`, `base_url?`, `runner`, `started_at`/`finished_at`/
`duration_ms`, `status`, `summary`, `effective_limits`, `checks[]` — cùng shape
với Answer/Relations report. Exit code: `0` conformant, `1` một check failed, `4`
inconclusive.

Report MUST NOT log toàn bộ private payload hoặc auth header mặc định.

## 10. External execution

Gate interoperability KHÔNG được đóng bằng mock server hoặc unit test. Điều kiện
tối thiểu (xem
[implementation plan 1.4.0](../../../../docs/vi/plans/implementation-plan-v1.4.0.md)
§"External conformance environment"): reference server deploy tại một origin
HTTPS thật reachable từ CI; `ail-aadp` cài từ packed tarball, clean install, chỉ
public exports; HTTP thật, không in-process handler, không fetch mock; report
JSON của **cả** Answer và Evidence với overall `passed` lưu trong implementation
record; chạy trên Node engine floor khai báo ở `package.json`.

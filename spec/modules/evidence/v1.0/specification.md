# AADP Evidence & Provenance Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | **Draft — non-normative** |
| Gate | [ADR-0010](../../../../docs/adr/0010-evidence-citation-provenance-and-security.md) phải Accepted trước khi tài liệu này trở thành normative |
| Module ID | `aadp:evidence` (đề xuất, chưa allocated) |
| Module version | `1.0` (đề xuất) |
| Core compatibility | AADP `1.0` |
| Relations compatibility | `aadp:relations@1.0` |
| Answer compatibility | `aadp:answer@1.0`, không sửa đổi |
| Package target | `ail-aadp@1.4.0` |

> **Draft.** Mọi field, constant và ví dụ trong tài liệu này là **đề xuất**, theo
> [document conventions §5](../../../../docs/document-conventions.md). Không được
> coi module ID/version ở đây là đã allocated, và KHÔNG được tạo schema artifact
> dưới `schemas/modules/evidence/v1.0/` trước khi ADR-0010 Accepted — released
> schema là immutable theo [ADR-0004](../../../../docs/adr/0004-backward-compatibility.md).

## Abstract

Tài liệu này định nghĩa wire contract cho Evidence & Provenance Module v1.0.
Module mô tả **claim** (điều được khẳng định), **evidence** (thứ được viện dẫn)
và **source** (nơi evidence đến từ), cùng quan hệ tham chiếu giữa claim và
evidence, provenance timestamp, stance và confidence do producer khai báo. Từ
khóa BCP 14 viết hoa có nghĩa chuẩn tắc.

## 1. Scope

Module định nghĩa discovery, `x_evidence`, claim/evidence document kind, source
object, provenance, stance/confidence, `content_checksum`, graph traversal,
validation và conformance.

Module KHÔNG định nghĩa và MUST NOT được diễn giải là định nghĩa: factual truth,
authenticity, legal validity, fact-checking, ranking, trust score, reputation
của publisher, chữ ký số hay verification identity. **Schema validity MUST NOT
được diễn giải thành bất kỳ nghĩa nào trong số đó.**

Module KHÔNG tự fetch URL nằm trong free text hoặc trong source metadata, KHÔNG
thêm field vào core schema v1.0 / Relations `1.0` / Answer `1.0`, và KHÔNG định
nghĩa cross-module graph composition tổng quát (thuộc `1.5.0`).

## 2. Discovery và compatibility

```json
{
  "id": "aadp:evidence",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/evidence/v1.0/module.schema.json"
}
```

Server MUST chỉ quảng bá module khi resource và schema artifacts đã deploy thật.
Core-only client MUST bỏ qua declaration và `x_evidence`. Evidence client MUST
exact-match ID/version và MUST NOT fallback sang version khác.

Public API và schema paths:

```text
ail-aadp/modules/evidence/v1.0
ail-aadp/schemas/modules/evidence/v1.0/*
```

Package KHÔNG re-export Evidence API từ root.

## 3. Document kind

Evidence `1.0` có đúng hai top-level module document kind:

| Kind | Entity type | Vị trí |
|---|---|---|
| `claim` | `claim` | `entity.x_evidence` |
| `evidence` | `evidence` | `entity.x_evidence` |

`source` KHÔNG phải document kind — nó là object lồng bên trong evidence
document. Không có standalone collection kind hay registry kind ở `1.0`;
listing/pagination dùng core sitemap/resource flow.

Registry dispatch dùng exact key `{aadp:evidence, 1.0, claim}` và
`{aadp:evidence, 1.0, evidence}` (ADR-0007).

## 4. Wire boundary

Claim entity (ví dụ **non-normative**; digest MUST được sinh bằng `checksumOf()`,
không copy tay):

```json
{
  "aadp_version": "1.0",
  "id": "claim:orbit-uptime-2026",
  "type": "claim",
  "checksum": "sha256:<generated>",
  "updated_at": "2026-08-06T09:00:00Z",
  "canonical_url": "https://example.com/claims/orbit-uptime-2026",
  "data": {},
  "x_evidence": {
    "module": "aadp:evidence",
    "version": "1.0",
    "kind": "claim",
    "statement": "Orbit reported 99.9% uptime in 2026.",
    "locale": "en",
    "evidence_refs": [
      {
        "target_type": "evidence",
        "target": {
          "id": "evidence:orbit-status-report-2026",
          "url": "https://example.com/ai/v1.0/entities/evidence/orbit-status-report-2026.json"
        },
        "stance": "support",
        "confidence": 0.8
      }
    ],
    "content_checksum": "sha256:<generated>"
  }
}
```

Evidence wrapper:

```json
{
  "module": "aadp:evidence",
  "version": "1.0",
  "kind": "evidence",
  "summary": "Annual status report published by Example Orbit.",
  "locale": "en",
  "source": {
    "title": "Orbit 2026 Status Report",
    "url": "https://example.com/reports/2026-status",
    "publisher": { "name": "Example Orbit" },
    "access": "public"
  },
  "provenance": {
    "published_at": "2026-01-15T00:00:00Z",
    "retrieved_at": "2026-08-01T09:00:00Z"
  },
  "content_checksum": "sha256:<generated>"
}
```

## 5. Field contract

Schema đóng với `additionalProperties: false` ở mọi object do Evidence định
nghĩa; wrapper KHÔNG có `x_*` extension point ở `1.0`. Object `target` được
`$ref` từ Relations `1.0` và giữ nguyên extension point `x_*` của Relations.

### 5.1 Claim document

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module` | Có | Hằng `aadp:evidence` |
| `version` | Có | Hằng `1.0` |
| `kind` | Có | Hằng `claim` |
| `statement` | Có | String đã trim, 1-1.000 Unicode code points |
| `locale` | Có | Cùng deterministic BCP 47 profile với Answer `1.0` (§6) |
| `evidence_refs` | Có | 1-50 evidence reference (§7), không trùng canonical target |
| `content_checksum` | Có | `sha256:<64 hex>` theo §9 |
| `notes` | Không | Untrusted text 1-1.000 code points, không có normative effect |

### 5.2 Evidence document

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module` / `version` | Có | Hằng `aadp:evidence` / `1.0` |
| `kind` | Có | Hằng `evidence` |
| `summary` | Có | String đã trim, 1-1.000 Unicode code points |
| `locale` | Có | Cùng profile với Answer `1.0` |
| `source` | Có | Source object (§5.3) |
| `provenance` | Có | Timestamp provenance (§8) |
| `content_checksum` | Có | `sha256:<64 hex>` theo §9 |
| `excerpt` | Không | Trích dẫn nguyên văn, 1-2.000 code points |

### 5.3 Source object

| Field | Bắt buộc | Contract |
|---|---:|---|
| `title` | Có | 1-500 code points |
| `url` | Có | Absolute HTTPS, không userinfo, không fragment |
| `publisher.name` | Có | 1-200 code points |
| `publisher.url` | Không | Absolute HTTPS, không userinfo, không fragment |
| `access` | Có | Enum `public` \| `authenticated` \| `restricted` (§12) |

`statement`, `summary`, `excerpt`, `notes`, `source.title` và `publisher.name`
đều là untrusted text (§13).

## 6. Locale contract

Evidence `1.0` dùng **cùng** deterministic BCP 47 profile với Answer `1.0`,
enforced giống nhau ở schema và pure semantic validator. Module này KHÔNG định
nghĩa profile mới và KHÔNG language-detect nội dung.

## 7. Evidence reference contract

Component `evidence-reference.schema.json` có đúng bốn field:

| Field | Bắt buộc | Contract |
|---|---:|---|
| `target_type` | Có | **Hằng `evidence`** |
| `target` | Có | `$ref` Relations `1.0` target |
| `stance` | Có | Enum `support` \| `contradict` \| `neutral` |
| `confidence` | Không | Number trong `[0, 1]`, tối đa 2 chữ số thập phân |

Quy tắc:

- Canonical identity của target tái sử dụng nguyên trạng Relations semantic
  identity `{id, normalizedUrl}`; module này KHÔNG định nghĩa identity rule mới.
- Trong một `evidence_refs`, hai phần tử MUST NOT cùng canonical identity, kể cả
  khi `stance` khác nhau. Hai stance cho cùng một evidence phải tách thành hai
  claim.
- `stance` là assertion của producer về quan hệ giữa evidence và claim, KHÔNG
  phải kết luận về truth value. `neutral` nghĩa "liên quan nhưng producer không
  khẳng định hướng", KHÁC với vắng mặt reference.
- `confidence` do producer khai báo, không có đơn vị thống kê, không so sánh
  được giữa hai publisher. Client trong package này MUST NOT tính lại hoặc tổng
  hợp nó thành score. Vắng `confidence` nghĩa "không khai báo" — không phải `0`,
  không phải `1`.

### 7.1 Acyclic by construction

`target_type` là **hằng**, nên một claim không thể trỏ tới claim khác hoặc tới
chính nó; evidence document không có field nào trỏ ngược về claim; `source.url`
là metadata và không bao giờ được traverse.

Do đó wire model `1.0` **không biểu diễn được cycle nào**. Module này KHÔNG có
cycle policy, cycle guard, rule self-reference hay cycle conformance check.
Nhiều claim cùng trỏ tới một evidence là **fan-in**, xử lý bằng dedup (§10).

## 8. Provenance contract

```json
{
  "published_at": "2026-01-15T00:00:00Z",
  "retrieved_at": "2026-08-01T09:00:00Z",
  "modified_at": "2026-03-02T00:00:00Z"
}
```

- RFC 3339 UTC dạng `Z`, precision tối đa milliseconds — cùng rule với Answer `1.0`.
- `published_at` và `retrieved_at` bắt buộc; `modified_at` optional.
- Invariant: `published_at <= retrieved_at`; nếu có `modified_at` thì
  `published_at <= modified_at <= retrieved_at`.
- **Precedence**: "thời điểm của evidence" là `modified_at` nếu có, ngược lại
  `published_at`. `retrieved_at` MUST NOT được dùng làm ngày của nội dung.
- Với entity `type: "evidence"`: `provenance.retrieved_at <= entity.updated_at`
  — **ordering, KHÔNG phải equality** (§11 và ADR-0010 §5).
- `publisher` là assertion của producer, không phải verified identity.

## 9. Content checksum contract

`content_checksum` tái sử dụng nguyên trạng
[ADR-0001](../../../../docs/adr/0001-checksum-algorithm.md) và public
`ail-aadp/canonical-json`: `checksumOf(wrapper_minus_content_checksum)`, RFC 8785
JCS, sort key theo UTF-16 code unit value. Evidence KHÔNG định nghĩa
canonicalization rule mới; chỉ khác phạm vi input (`x_evidence`).

Phạm vi hash bao phủ toàn bộ field normative của wrapper, kể cả Relations
`target.x_*` lồng bên trong `evidence_refs`. Core `checksum` vẫn chỉ bao phủ
`data`; một Evidence entity hợp lệ MUST pass cả hai.

`content_checksum` chỉ phát hiện tampering trong phạm vi hash. Nó KHÔNG phải chữ
ký, KHÔNG chứng minh producer trung thực và KHÔNG thay thế TLS.

## 10. Graph và traversal contract

### 10.1 Reference resolution requirement

| Loại reference | Bắt buộc resolve? | Ghi chú |
|---|---|---|
| `claim.evidence_refs[]` | Có, khi caller opt in traversal | Unresolved → entry có status, không throw |
| `answer.related_entities[]` với `target_type` claim/evidence | Chỉ khi caller gọi helper Evidence | Behavior Answer `1.0` không đổi khi không gọi |
| `evidence.source.url` | KHÔNG | Metadata; validator/client MUST NOT tự fetch |
| `evidence.source.publisher.url` | KHÔNG | Metadata |

### 10.2 Status vocabulary và dangling

Vocabulary tái sử dụng nguyên `AnswerTargetResolutionStatus`; không tạo enum mới.

| Kết quả | Status | Dangling? |
|---|---|---|
| 200 + entity hợp lệ | `resolved` | Không |
| 404/410 | `not-found` | **Có** |
| 200 nhưng schema/semantic invalid, hoặc sai `target_type` | `invalid` | **Có** |
| 401/403 | `forbidden` | Không — access control, không phải graph gãy |
| Bị URL/DNS policy chặn | `forbidden` | Không |
| Budget cạn hoặc abort | `budget-exhausted` | Không — partial result |

`source.access` MUST NOT tham gia phân loại này (§12).

### 10.3 Budget

Traversal dùng nguyên `RelationsTraversalBudgetState` do caller sở hữu, với sáu
dimension đã phát hành ở
[ADR-0008](../../../../docs/adr/0008-module-traversal-and-authorization.md).
Evidence MUST NOT tạo budget con, MUST NOT nới default và MUST NOT thêm dimension
mới. Depth tính theo cạnh answer → claim → evidence (evidence là leaf, tối đa hai
cạnh từ answer). Node charge qua `chargeNode` để dedup dùng chung
`visitedTargets`.

### 10.4 Dedup hai tầng

- `visitedTargets` cho **kế toán budget**;
- shared canonical outcome cache khoá theo budget cho **tái dùng entity đã fetch**.

Cùng canonical key `{id, normalizedUrl}`; cả hai đều cần thiết. Cache lưu
**canonical outcome**, KHÔNG lưu verdict theo reference: verdict `target_type`
được tính lại cho từng occurrence, nên một reference khai sai type không đầu độc
reference khác trỏ tới cùng target.

### 10.5 Kết quả traversal

Kết quả là một `EvidenceGraph` với:

- `nodes[]` — mỗi canonical target đúng một node; `status` chỉ mô tả kết quả
  fetch/schema/checksum của target đó. Discovery order, không sort lại.
- `references[]` — mỗi occurrence trong `answer.related_entities` có verdict
  riêng, giữ index gốc.
- `edges[]` — mỗi occurrence trong `claim.evidence_refs` có verdict riêng, sắp
  theo (claim discovery index, ref index).
- `partial` — true khi walk dừng trước khi thử hết reference.

Node không resolve được vẫn xuất hiện trong `nodes`; edge/reference entry luôn
tồn tại nếu wire có ref, để consumer phân biệt "không có ref" với "có ref nhưng
fetch hỏng". Mọi reference sau điểm dừng xuất hiện với status `budget-exhausted`,
không bị âm thầm bỏ.

`AbortSignal` do caller truyền; abort tạo partial result. Module KHÔNG thêm retry
layer ngoài policy HTTP hiện có.

## 11. Validation boundary

**JSON Schema** chịu trách nhiệm: required fields, constants, closed objects,
enum `stance`/`access`, string/array bounds, URL/timestamp shape, confidence
range và evidence reference shape (target qua Relations `$ref`).

Schema KHÔNG kiểm tra: timestamp ordering, duplicate semantic target,
`content_checksum`, và quan hệ thứ tự với core `updated_at`.

**Pure wrapper semantic validator** (registry key `{aadp:evidence, 1.0, claim}` /
`{aadp:evidence, 1.0, evidence}`) nhận wrapper; MUST NOT nhận entity context,
MUST NOT fetch network, MUST NOT đọc clock hệ thống, MUST NOT mutate input.
Kiểm tra: module/version/kind nhất quán; Unicode code-point bounds sau trim;
locale profile; timestamp ordering và precedence; confidence range/precision;
duplicate target theo Relations semantic identity; `content_checksum` khớp digest
tính lại.

Validator KHÔNG có rule self-reference: `target_type` hằng đã loại trừ
claim→claim ở tầng schema, và pure validator không có entity context để biết id
của chính document.

**Entity-context validator** `validateEvidenceEntityV1(entity)`:

1. Validate core entity v1.0.
2. Yêu cầu `entity.type` khớp kind (`claim` hoặc `evidence`), có `x_evidence`,
   có `entity.canonical_url`.
3. Validate `entity.canonical_url` bằng URL-policy helper dùng chung với
   `source.url` (absolute HTTPS, không userinfo, không fragment).
4. Dispatch `x_evidence` qua exact registry key.
5. Với kind `evidence`: yêu cầu `provenance.retrieved_at <= entity.updated_at`.
6. Trả typed validated entity hoặc structured validation result.

`parseEvidenceEntityV1` là throwing convenience wrapper, không duplicate rules.

Advisory (không tạo semantic error): claim có đúng sự thật không; evidence có
thực sự support/contradict claim không; publisher có đáng tin không; source có
còn tồn tại không.

Issue code ổn định với prefix `evidence.semantic.*`; message text không phải API
ổn định.

## 12. `source.access` không phải authorization

`access` là assertion của producer về **source nằm ngoài AADP** — thứ mà `1.0`
không bao giờ fetch. Nó MUST NOT tham gia bất kỳ quyết định traversal,
authorization hay conformance nào; vai trò hợp lệ duy nhất là presentation.

Authorization của chính evidence entity do core/Relations authorization và
manifest `security` declaration quyết định. Mọi 401/403 trên target đều là
`forbidden`, độc lập với `access` — và khi target trả 401/403 thì client không hề
có body để đọc `access`.

## 13. Security và privacy contract

- Mọi free text là untrusted data; package MUST NOT nối vào system prompt,
  shell, HTML hay executable template, MUST NOT parse instruction từ chúng.
- `source.url`, `publisher.url` và `entity.canonical_url` là metadata và MUST NOT
  được validator/client tự fetch. Chỉ target trong `evidence_refs` /
  `related_entities` được fetch, và chỉ qua Relations URL/DNS policy khi caller
  opt in.
- Redirect, DNS rebinding, private/link-local/reserved address và credential leak
  behavior kế thừa policy hiện có; Evidence KHÔNG có networking bypass.
- Authorization được kiểm tra trước khi trả claim/evidence/target.
- Một budget = một resolution context bất biến; canonical outcome cache và
  in-flight request MUST NOT được dùng chung giữa hai call khác context.
  Mismatch fail closed bằng `AadpClientError`
  (`code: "resolution_context_mismatch"`), theo contract đã phát hành ở `1.3.1`.
- Conformance output MUST NOT log toàn bộ private payload hoặc auth header mặc
  định.
- Stance/confidence/publisher là assertion của producer; schema validity không
  chứng minh chúng trung thực.

## 14. Freshness

Freshness là **client-computed classification**, không phải publisher metadata.
Evidence `1.0` KHÔNG có field `expires_at` và KHÔNG có field `freshness`.
`classifyEvidenceFreshness(evidence, now, maxAgeMs)` là pure helper dùng injected
clock, phân loại `fresh` | `stale` theo precedence ở §8.

## 15. Answer integration

Answer `1.0` là released immutable contract. Vì vậy:

- Answer liên kết tới claim/evidence **chỉ qua `related_entities`** với
  `target_type` là `claim` hoặc `evidence`. MUST NOT dùng
  `authorship.source_targets`.
- Helper `resolveAnswerEvidenceV1(answer, options)` lọc `related_entities`,
  resolve qua shared canonical resolution layer, validate từng entity, **rồi
  expand `evidence_refs` của mọi claim đã resolve** trên cùng budget.
- Helper MUST NOT gọi `resolveAnswerTargets` — hàm đó luôn collect cả
  `authorship.source_targets`, nằm ngoài phạm vi Evidence. Hệ quả kiểm chứng
  được: một generated-summary Answer đi qua `resolveAnswerEvidenceV1` MUST NOT
  phát sinh request nào tới `authorship.source_targets`.
- Integration MUST NOT đổi `AnswerValidationResult`,
  `AnswerEntityValidationResult` hay tập payload hợp lệ của Answer `1.0`.

## 16. Layer boundary

```text
core discovery/entity validation
        ↓
module registry ──► Evidence schema + pure semantic validator
        ↓
Evidence entity validator/client ──► shared canonical resolution (internal)
                                     ──► Relations resolver + shared budget
        ↓
application citation/editorial policy (ngoài package)
```

Shared canonical resolution layer là **internal**: nó MUST NOT xuất hiện trong
bất kỳ public subpath nào của Answer, Relations hay Evidence. Networking,
URL/DNS, authorization, scheduling và budget tiếp tục do core/Relations sở hữu.

## 17. Typed API

```ts
export type EvidenceClaimDocumentV1;
export type EvidenceDocumentV1;
export type EvidenceSourceV1;
export type EvidenceProvenanceV1;
export type EvidenceReferenceV1;
export type EvidenceStanceV1 = "support" | "contradict" | "neutral";
export type EvidenceAccessV1 = "public" | "authenticated" | "restricted";
export type ValidatedEvidenceEntityV1;
export type EvidenceValidationIssue;
export type EvidenceValidationResult;
export type EvidenceEntityValidationResult;
export type EvidenceClientOptions;
export type EvidenceResolveOptions;
export type EvidenceNodeKindV1 = "claim" | "evidence";
export type EvidenceGraphNode;
export type EvidenceGraphReference;
export type EvidenceGraphEdge;
export type EvidenceGraph;
export type EvidenceFreshnessState = "fresh" | "stale";
export type EvidenceConformanceOptions;
export type EvidenceConformanceReport;

export function registerEvidenceModule(): void;
export function validateEvidenceV1(document: unknown): EvidenceValidationResult;
export function validateEvidenceEntityV1(entity: unknown): EvidenceEntityValidationResult;
export function parseEvidenceEntityV1(entity: unknown): ValidatedEvidenceEntityV1;
export function fetchEvidenceEntityV1(
  url: string,
  options: EvidenceClientOptions,
  budget: RelationsTraversalBudgetState,
): Promise<ValidatedEvidenceEntityV1>;
export function resolveClaimEvidenceV1(
  claim: EvidenceClaimDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function resolveAnswerEvidenceV1(
  answer: AnswerDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function classifyEvidenceFreshness(
  evidence: EvidenceDocumentV1,
  now: Date,
  maxAgeMs: number,
): EvidenceFreshnessState;
export function runEvidenceConformance(
  options: EvidenceConformanceOptions,
): Promise<EvidenceConformanceReport>;
```

Hai resolver nhận `options.budget` giống hệt Answer `1.0` — không có tham số
state riêng. Canonical outcome cache khoá theo chính budget ở tầng internal, nên
không có gì để caller quên truyền và không phát sinh câu hỏi ownership khi gọi
lồng nhau hoặc đồng thời.

## 18. Schema và artifact inventory

```text
schemas/modules/evidence/v1.0/
├── module.schema.json
├── claim.schema.json
├── evidence.schema.json
├── evidence-reference.schema.json
├── source.schema.json
└── provenance.schema.json

spec/modules/evidence/v1.0/
├── specification.md
└── conformance.md

src/modules/evidence/v1.0/
├── types.ts, schemas.ts, semantic.ts, register.ts, entity.ts, index.ts
├── client/ (types, errors, fetch, freshness, resolve, index)
└── conformance/ (types, checks, report, runner, index)
```

Không file nào trong danh sách trên được tạo trước khi ADR-0010 Accepted.

## 19. Compatibility

- Evidence `1.0` là normative wire version đầu tiên; không phát hành `0.1`.
- Patch chỉ sửa documentation/implementation bug không đổi payload schema hoặc
  semantic result normative. Minor chỉ thêm optional contract tương thích ngược.
  Major dùng cho thay đổi field/reference/provenance semantics không tương thích.
- Client MUST NOT fallback sang Evidence version khác khi exact version không
  hỗ trợ; consumer opt-in trả `unsupported_module_version`.
- Core-only consumer bỏ qua `x_evidence` và module discovery entry an toàn.
- Thêm reverse edge evidence → claim là thay đổi model, cần ADR riêng — không
  phải minor bump.

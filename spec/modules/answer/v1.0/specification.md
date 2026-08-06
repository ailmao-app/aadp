# AADP Answer Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:answer` |
| Module version | `1.0` |
| Core compatibility | AADP `1.0` |
| Relations compatibility | `aadp:relations@1.0` |
| Package target | `ail-aadp@1.3.0` |

## Abstract

Tài liệu này định nghĩa wire contract normative cho Answer Module v1.0. Module mô
tả câu hỏi, câu trả lời ngắn, nội dung mở rộng, phạm vi áp dụng, locale, freshness
và entity liên quan của một answer entity, phân biệt bằng dữ liệu giữa nội dung
do nguồn biên soạn (`source-authored`) và bản tóm tắt được tạo tự động
(`generated-summary`). Từ khóa BCP 14 viết hoa có nghĩa chuẩn tắc.

## 1. Scope

Module định nghĩa discovery, `x_answer`, authorship, freshness, applicability,
answer entity reference, `content_checksum`, validation và conformance. Module
KHÔNG định nghĩa content generation, ranking/search score, AEO/GEO score, factual
truth đánh giá, hoặc evidence/claim/citation graph — các mối quan tâm đó thuộc
Evidence & Provenance Module `1.4.0` hoặc application layer.

## 2. Discovery và compatibility

```json
{
  "id": "aadp:answer",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json"
}
```

Server MUST chỉ quảng bá module khi payload, endpoint/resource và conformance
artifacts đã deploy. Core-only client MUST bỏ qua declaration và `x_answer`.
Answer client MUST exact-match ID/version và MUST NOT fallback version. Field
`schema` trỏ tới schema dispatch của document `answer`; discovery entry được
validate bởi core manifest schema v1.0, không bởi schema này.

Public API và schema paths:

```text
ail-aadp/modules/answer/v1.0
ail-aadp/schemas/modules/answer/v1.0/*
```

Package KHÔNG re-export Answer API từ root; tarball/clean-install consumer
KHÔNG import `src/**`.

## 3. Document kind

Answer `1.0` có đúng một top-level module document kind: `answer` — value của
`entity.x_answer` trên entity `type: "answer"`. Không có standalone collection
kind, registry kind hay alternate-question document; listing/pagination answer
resources dùng core sitemap/resource flow.

## 4. Wire boundary

Answer payload nằm tại extension `x_answer` ở root của core entity `type:
"answer"`. Application `data` KHÔNG chứa protocol field, và core entity schema
v1.0 KHÔNG bị sửa.

```json
{
  "aadp_version": "1.0",
  "id": "answer:what-is-orbit",
  "type": "answer",
  "checksum": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  "updated_at": "2026-08-06T09:00:00Z",
  "canonical_url": "https://example.com/answers/what-is-orbit",
  "data": {},
  "x_answer": {
    "module": "aadp:answer",
    "version": "1.0",
    "kind": "answer",
    "question": "What is Orbit?",
    "concise_answer": "Orbit is a neutral example service.",
    "locale": "en",
    "authorship": {
      "kind": "source-authored",
      "author": { "name": "Example Editorial Team", "url": "https://example.com/editorial" }
    },
    "freshness": {
      "published_at": "2026-08-01T09:00:00Z",
      "updated_at": "2026-08-06T09:00:00Z",
      "reviewed_at": "2026-08-06T09:00:00Z"
    },
    "content_checksum": "sha256:690084f26171fcc883f2ac0b9987b2511b5b9a3d21faab90ca0bdebe660bc622",
    "applicability": { "audiences": ["general"], "jurisdictions": ["001"] },
    "related_entities": [
      { "target_type": "service", "target": { "id": "service:orbit", "url": "https://example.com/ai/v1.0/entities/service/orbit.json" } }
    ]
  }
}
```

Ví dụ trên là valid vector: cả `checksum` (core, trên `data = {}`) và
`x_answer.content_checksum` được tính bằng `checksumOf()` public
(`ail-aadp/canonical-json`) trên đúng payload hiển thị. Fixture
`tests/fixtures/answer/v1.0/valid/answer-valid-wire-example.json` được generate
từ script tái tạo ví dụ này, không copy tay digest.

Core checksum chỉ bao phủ `data`; vì mọi field normative của Answer nằm trong
`x_answer`, Answer Module định nghĩa thêm `x_answer.content_checksum` làm
integrity digest riêng cho phạm vi này (§8).

## 5. Field contract

Schema đóng với `additionalProperties: false` ở mọi object do Answer Module định
nghĩa; KHÔNG có `x_*` extension point ở wrapper level (khác Relations `1.0`).
Object `target` được `$ref` từ Relations giữ nguyên extension point `x_*` của
Relations `1.0`.

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module` | Có | Hằng `aadp:answer` |
| `version` | Có | Hằng `1.0` |
| `kind` | Có | Hằng `answer` |
| `question` | Có | String đã trim, 1-500 Unicode code points |
| `concise_answer` | Có | String đã trim, 1-500 Unicode code points |
| `answer` | Không | String đã trim, 1-20.000 Unicode code points |
| `locale` | Có | Canonical BCP 47 profile (§6), tối đa 63 ký tự |
| `authorship` | Có | Tagged union `source-authored` hoặc `generated-summary` (§7) |
| `freshness` | Có | Timestamp provenance và optional expiry (§9) |
| `content_checksum` | Có | `sha256:<64 hex>` digest theo §8 |
| `applicability` | Không | Audience/jurisdiction/time applicability (§10) |
| `related_entities` | Không | 0-50 Answer entity reference (§11), không trùng canonical target |

`x_answer` KHÔNG có field `canonical_url` riêng — xem §12. KHÔNG hỗ trợ alias
`short_answer`; thuật ngữ chính thức là `concise_answer`.

`question`, `concise_answer`, `answer`, author name và applicability notes đều là
untrusted text. Package KHÔNG render, execute, interpolate vào prompt, parse
HTML/Markdown instruction hoặc dereference URL từ các field này (§14).

## 6. Locale contract

Answer `1.0` dùng deterministic BCP 47 profile giới hạn:

```text
language = 2-3 lowercase ASCII letters
script   = optional, 4 ASCII letters Title Case
region   = optional, 2 uppercase ASCII letters hoặc 3 digits
variant  = zero hoặc nhiều subtag: 5-8 lowercase alphanumeric,
           hoặc một digit theo sau bởi 3 lowercase alphanumeric
```

Regex chuẩn tắc (export `ANSWER_LOCALE_PATTERN`):

```text
^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|[0-9]{3}))?(-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*$
```

Ví dụ hợp lệ: `vi`, `en`, `en-US`, `zh-Hant`, `zh-Hant-TW`. Underscore, extension
singleton, private-use, grandfathered tag và casing khác profile bị từ chối, kể
cả khi một BCP 47 implementation tổng quát có thể hiểu chúng. Schema và pure
helper (`isValidAnswerLocale`) dùng cùng grammar; không dùng `Intl`, locale OS,
ICU version hay network registry để quyết định validity. Locale chỉ mô tả ngôn
ngữ chính của answer; validator không language-detect free text.

## 7. Authorship contract

`authorship` dùng discriminator `kind`; hai nhánh loại trừ nhau, mỗi object đóng.

**`source-authored`**: `author.name` bắt buộc (1-200 code points); `author.url`
optional, absolute HTTPS, không userinfo/fragment (§13 URL policy). Không có
`generator`/`generated_at`/`source_targets` trong nhánh này.

**`generated-summary`**: `generator.name`, `generated_at`, và 1-20
`source_targets` bắt buộc; `generator.version` và `reviewed_by` optional. Mỗi
`source_targets[]` là Answer entity reference (§11); nó chỉ biểu thị input
source, không chứng minh factual truth/support/citation validity. `reviewed_by`
KHÔNG đổi `kind` — generated content sau human review vẫn là `generated-summary`
để bảo toàn provenance. Client KHÔNG tự suy luận source-authored khi thiếu
metadata và KHÔNG tự chuyển kind sau khi fetch target.

## 8. Content checksum contract

`content_checksum` là digest `sha256:<64 lowercase hex>` bảo vệ toàn bộ field
normative của `x_answer`, độc lập với core checksum (chỉ bao phủ `data`).

- Phạm vi hash: `x_answer` sau khi loại bỏ chính field `content_checksum`. Mọi
  field còn lại nằm trong phạm vi, kể cả Relations `target.x_*` extension lồng
  bên trong `related_entities`/`source_targets`.
- Canonicalization và thuật toán tái sử dụng nguyên trạng ADR-0001 và
  `ail-aadp/canonical-json` (`canonicalize()`/`checksumOf()`): RFC 8785 JCS, sort
  key theo UTF-16 code unit value (không phải Unicode code point), reject input
  ngoài JSON/I-JSON domain.
- `content_checksum = checksumOf(x_answer minus content_checksum)`. Producer tính
  sau khi các field khác đã chốt, trước khi publish; client tính lại khi validate.
- Pure wrapper semantic validator (`validateAnswerV1`/`checkAnswerSemantics`)
  tính lại digest và từ chối khi không khớp, mã lỗi
  `answer.semantic.content_checksum_mismatch`.
- Đây là bổ sung cho, không thay thế, core checksum. Một entity Answer hợp lệ
  phải pass cả hai. `content_checksum` không phải chữ ký chống producer gian
  dối và không thay thế transport integrity (TLS).

## 9. Freshness contract

- `published_at`, `updated_at` bắt buộc; `reviewed_at`, `expires_at` optional.
  Timestamp dùng RFC 3339 UTC dạng `Z`, precision tối đa milliseconds.
- Invariant: `published_at <= updated_at`; nếu có `reviewed_at` thì
  `published_at <= reviewed_at`; nếu có `expires_at` thì mọi timestamp còn lại
  phải `<= expires_at`.
- `x_answer.freshness.updated_at` PHẢI bằng core entity `updated_at` — invariant
  này thuộc entity-context validator (§15), không thuộc wrapper semantic
  validator.
- Expired answer vẫn schema-valid. Client helper (`classifyAnswerFreshness`)
  phân loại `fresh`/`stale` dựa trên injected clock; pure validator không dùng
  wall clock. Thiếu `expires_at` nghĩa là không khai báo expiry, không có nghĩa
  "vĩnh viễn đúng".

## 10. Applicability contract

`applicability` có tối thiểu một trong các field:

- `audiences`: 1-20 token duy nhất. Token `general` là unnamespaced standard;
  namespace `aadp:*` được giữ chỗ. Vendor token theo
  `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]{0,63}$`. Answer `1.0` chỉ đăng ký `general`.
- `jurisdictions`: 1-50 code duy nhất; ISO 3166-1 alpha-2 uppercase hoặc UN M49
  ba chữ số. `001` nghĩa global.
- `valid_from`/`valid_until`: RFC 3339 UTC; nếu có cả hai thì `valid_from <
  valid_until` (strict).
- `notes`: optional untrusted text, 1-1.000 code points, không có normative effect.

Unknown unnamespaced audience token bị từ chối. Applicability KHÔNG thay thế
authorization; server vẫn dùng core/Relations authorization policy trước khi trả
resource/target.

## 11. Related entity và Evidence boundary

`related_entities` và generated `source_targets` dùng component
`answer-reference.schema.json` (`{target_type, target}`); `target` `$ref` trực
tiếp Relations `schemas/modules/relations/v1.0/target.schema.json`, không copy.
`target_type` theo core entity type grammar `^[a-z][a-z0-9_-]*$`. Mỗi list
KHÔNG được có hai phần tử cùng canonical target theo semantic identity Relations
`{id, normalizedUrl}`.

Answer client chỉ resolve target khi caller opt in, qua
`resolveRelationTarget(reference.target, reference.target_type, ...)` với cùng
URL/DNS policy, authorization behavior, scheduler, abort signal và caller-owned
`RelationsTraversalBudgetState` của traversal cha — không suy đoán expected type
từ prefix của `target.id`, không tạo budget con, không retry ngoài policy hiện có.

Answer `1.0` KHÔNG có field `evidence`, `claims` hay `citations` — Evidence
Module `1.4.0` sẽ liên kết bằng module riêng/Relations contract.

## 12. Canonical URL contract

Answer `1.0` KHÔNG định nghĩa `x_answer.canonical_url`. Answer entity dùng lại
core `entity.canonical_url` làm human-facing URL duy nhất.

- `entity.canonical_url` bắt buộc đối với entity `type: "answer"`; entity-context
  validator từ chối khi thiếu, mã lỗi `answer.semantic.missing_canonical_url`.
- Không có bản sao/alias trong `x_answer`; schema `additionalProperties: false`
  từ chối một implementation cũ gửi `x_answer.canonical_url` như unknown field.
- Core v1.0 chỉ validate `entity.canonical_url` bằng `format: uri`.
  `validateAnswerEntityV1()` tự thực thi URL policy chặt hơn (§13), dùng chung
  helper với `author.url`. Vi phạm dùng mã
  `answer.semantic.canonical_url_policy_violation`.

## 13. Shared URL policy (canonical_url / author.url)

Absolute HTTPS, không userinfo, không fragment. Pure parsing, không network.
Export: `checkUrlPolicy(url): string | undefined` (Relations URL/DNS SSRF policy
là lớp riêng, áp dụng khi thật sự fetch một target, không phải policy này).

## 14. Security và privacy contract

- Mọi free text là data không tin cậy; package không nối text vào system prompt,
  shell, HTML hay executable template.
- `entity.canonical_url` và `author.url` là metadata, không được validator/client
  tự fetch. Target URL chỉ fetch qua Relations URL/DNS policy.
- `content_checksum` chỉ phát hiện tampering trên field trong phạm vi hash; không
  phải chữ ký chống producer gian dối, không thay thế TLS.
- Redirect, DNS rebinding, private/link-local/reserved address và credential leak
  behavior kế thừa policy hiện có của core/Relations client.
- Authorization được kiểm tra trước khi trả answer/target.
  `applicability.audiences` không cấp quyền truy cập.
- Authorship metadata không phải chữ ký, identity verification hay endorsement.
  Generated/source-authored label là provenance assertion của producer; schema
  validity không chứng minh assertion trung thực.

## 15. Validation boundary

**JSON Schema** chịu trách nhiệm: required fields, constants, tagged union,
closed objects, string/array bounds, URL/timestamp shape, locale profile shape,
token grammar, Answer reference shape, `contains`/`minProperties` applicability.

**Pure wrapper semantic validator** (`validateAnswerV1`, registry key
`{aadp:answer, 1.0, answer}`) nhận `x_answer`; không nhận core entity context,
không fetch network, đọc clock hệ thống hay mutate input. Kiểm tra: module/
version/kind nhất quán; Unicode code-point bounds sau trim; locale profile;
timestamp ordering; duplicate target theo Relations semantic identity;
source-authored/generated-summary branch invariants; `author.url` HTTPS policy;
`content_checksum` khớp digest tính lại.

**Entity-context validator** (`validateAnswerEntityV1(entity)`):

1. Validate core entity v1.0.
2. Yêu cầu `entity.type === "answer"`, có `x_answer` object, có
   `entity.canonical_url`.
3. Validate `entity.canonical_url` bằng URL-policy helper (§13).
4. Dispatch `x_answer` qua exact registry key `{aadp:answer, 1.0, answer}`.
5. Yêu cầu `x_answer.freshness.updated_at === entity.updated_at`.
6. Trả typed validated entity/wrapper hoặc structured validation result.

`parseAnswerEntityV1(entity)` là throwing convenience wrapper trên
`validateAnswerEntityV1`, không duplicate validation rules.

Advisory (không tạo semantic error): câu hỏi có phải natural-language question;
concise answer có tự đủ nghĩa; concise/full answer có mâu thuẫn; nội dung có
đúng/current/đủ evidence; author/generator có thật hoặc đáng tin.

Validation result dùng stable machine-readable codes với prefix
`answer.semantic.*`; message text không phải API ổn định.

## 16. Layer boundary

```text
core discovery/entity validation
        ↓
module registry ──► Answer schema + pure semantic validator
        ↓
Answer entity validator/client ──► Relations resolver + shared traversal budget
        ↓
application content authoring/generation policy (ngoài package core)
```

Core chỉ discovery, validate core envelope và bỏ qua extension không hỗ trợ.
Entity-context validation nằm trong Answer module, không nằm trong generic
registry hoặc core validator. Networking, URL/DNS, authorization, scheduling và
budget tiếp tục do shared core/Relations infrastructure sở hữu.

## 17. Typed API

Xem `ail-aadp/modules/answer/v1.0` (`src/modules/answer/v1.0/index.ts`) cho danh
sách export đầy đủ: types (`AnswerDocumentV1`, `AnswerAuthorshipV1`,
`AnswerFreshnessV1`, `AnswerApplicabilityV1`, `AnswerEntityReferenceV1`,
`ValidatedAnswerEntityV1`, ...), schema/registry (`registerAnswerModule`,
`validateAnswerV1`, `validateAnswerEntityV1`, `parseAnswerEntityV1`), client
(`fetchAnswerEntityV1`, `classifyAnswerFreshness`, `resolveAnswerTargets`) và
conformance (`runAnswerConformance` và report renderers). Tên type có suffix
`V1` hoặc nằm trong versioned subpath để tránh collision. Public function không
nhận implementation-private registry/network type không được export.

`fetchAnswerEntityV1` dùng core `fetchEntity`, sau đó gọi `parseAnswerEntityV1`;
không fetch hoặc trust target URL trước khi toàn bộ core entity và `x_answer`
hợp lệ.

`resolveAnswerTargets` nhận caller-owned `RelationsTraversalBudgetState` qua
options và resolve CẢ HAI danh sách Answer entity reference: `related_entities`
và — khi `authorship.kind === "generated-summary"` — `authorship.
source_targets` bắt buộc; đây cùng là "Answer target", không được bỏ sót chỉ
vì nằm trong `authorship`. Mỗi entry kết quả gắn `{group: "related_entities" |
"source_targets", index}` để giữ provenance; thứ tự kết quả là toàn bộ
`related_entities` (theo input order) rồi tới toàn bộ `source_targets` (theo
input order). Một target trùng nhau giữa hai group (cùng canonical `{id,
normalizedUrl}`) chỉ bị fetch một lần — lần thứ hai trả `resolved` không kèm
`entity` (duplicate, dùng chung caller-owned budget).

Trạng thái mỗi entry: `resolved | forbidden | not-found | invalid |
budget-exhausted`; không trả partial result như thể complete. Phân loại dựa
trên nguyên nhân lỗi thực tế (`RelationsTraversalIssue.cause`), không chỉ mã
lỗi thô: HTTP 401/403 → `forbidden`; HTTP 404 → `not-found`; blocked URL,
schema-invalid, checksum mismatch, id/type integrity mismatch, hoặc unsupported
`aadp_version` → `invalid` (target tồn tại nhưng không dùng được); mọi lỗi
transport khác (timeout, 5xx, quá nhiều redirect, response quá lớn) cũng mặc
định `invalid` — một simplification có chủ đích vì taxonomy Answer không có
bucket thứ sáu cho lỗi transport, và gán `not-found` cho lỗi tạm thời sẽ báo
sai một target thực ra vẫn tồn tại.

## 18. Schema và artifact inventory

```text
schemas/modules/answer/v1.0/
├── module.schema.json
├── answer.schema.json
├── answer-reference.schema.json
├── authorship.schema.json
├── freshness.schema.json
└── applicability.schema.json

spec/modules/answer/v1.0/
├── specification.md
└── conformance.md

src/modules/answer/v1.0/
├── types.ts, schemas.ts, semantic.ts, register.ts, entity.ts, index.ts
├── client/ (types, errors, freshness, fetch, resolve, index)
└── conformance/ (types, checks, report, runner, index)
```

## 19. Compatibility

- Answer `1.0` là normative wire version đầu tiên; không có `0.1`.
- Patch chỉ sửa documentation/implementation bug không đổi payload schema/
  semantic result normative. Minor chỉ thêm optional contract tương thích ngược.
  Major dùng cho thay đổi field/discriminator/reference/freshness semantics
  không tương thích.
- Client KHÔNG được fallback sang Answer version khác khi exact version không
  hỗ trợ.
- Core-only consumer bỏ qua `x_answer` và module discovery entry an toàn.

# Kế hoạch triển khai `ail-aadp` 1.3.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Implementation Ready |
| Chủ đề | Answer Module |
| Contract baseline | ADR-0007, ADR-0008, Relations Module `1.0` stable và ADR Answer được chấp nhận ở Phase 0 |
| Owner | AADP maintainers |
| Wire impact | Module riêng; không đổi core schema v1.0 hoặc Relations schema v1.0 |

## Mục tiêu

- Phát hành Answer Module wire contract đầu tiên để mô tả câu hỏi, câu trả lời
  ngắn, nội dung mở rộng, phạm vi áp dụng, locale, freshness và entity liên quan.
- Phân biệt bằng dữ liệu giữa nội dung do nguồn biên soạn và bản tóm tắt được
  tạo tự động mà không yêu cầu client suy đoán từ free text.
- Cung cấp schema, types, pure semantic validator, typed client helper, fixtures,
  reference resource và conformance cùng module version.
- Tái sử dụng module registry, Relations target model, HTTP/URL/DNS policy và
  shared traversal budget đã phát hành trong `1.2.0`.
- Giữ core-only consumer tương thích: consumer không hỗ trợ Answer phải bỏ qua
  `x_answer` và module discovery entry an toàn.

## Ngoài phạm vi

- Không generate hoặc rewrite answer bằng model trong AADP core/client/server.
- Không ranking, search score, AEO/GEO score hoặc đánh giá factual truth.
- Không xác định bằng máy rằng câu hỏi “tự nhiên”, answer “tự đủ nghĩa” hoặc hai
  đoạn free text có mâu thuẫn ngữ nghĩa hay không.
- Không thêm claim, evidence, citation hoặc provenance graph vào Answer `1.0`;
  các contract đó thuộc Evidence & Provenance Module `1.4.0`.
- Không thay đổi schema core entity/manifest v1.0 hoặc schema Relations `1.0`.
- Không tự fetch URL nằm trong free text, canonical URL hoặc author metadata.
- Không đưa dữ liệu, type hoặc policy riêng của Ailmao vào package/fixtures.
- Không triển khai cross-module graph composition tổng quát; phần đó thuộc
  release `1.5.0`.

## Dependency bắt buộc

Implementation chỉ bắt đầu sau khi các điều kiện sau xanh:

1. `ail-aadp@1.2.0` và `aadp:relations@1.0` đã phát hành, schema immutable.
2. Relations schema, semantic, client resolution, shared budget và conformance
   hiện tại chạy xanh trên clean install.
3. [ADR-0007](../../adr/0007-module-versioning-and-discovery.md) và
   [ADR-0008](../../adr/0008-module-traversal-and-authorization.md) vẫn Accepted.
4. ADR Answer terminology/security được tạo ở Phase 0 và Accepted, ghi lại các
   quyết định contract trong kế hoạch này.

“Relations stable” trong kế hoạch này nghĩa là package `1.2.0` đã release, không
có known critical/high bug mở trong target validation, URL/DNS policy, budget
accounting hoặc module conformance. Không yêu cầu chờ một khoảng thời gian tùy ý.

Nếu ADR Answer thay đổi module ID, envelope, authorship discriminator, field bắt
buộc hoặc reference model dưới đây thì phải cập nhật lại kế hoạch trước khi sửa
wire artifact.

## Quyết định contract đã chốt

### Version matrix

| Artifact | Version phát hành |
|---|---|
| npm package | `ail-aadp@1.3.0` |
| Core protocol | `aadp_version: "1.0"` |
| Relations Module | `aadp:relations@1.0` |
| Answer Module | `aadp:answer@1.0` |

Answer `1.0` là normative wire version đầu tiên; không phát hành Answer wire
version `0.1`. Version domains và bump rules tuân theo ADR-0007:

- Patch chỉ sửa documentation/implementation bug mà không đổi tập payload schema
  chấp nhận hoặc semantic result normative.
- Minor chỉ thêm optional contract tương thích ngược.
- Major dùng cho thay đổi field, required field, discriminator, reference hoặc
  freshness semantics không tương thích.
- Client không được fallback sang Answer version khác khi exact version không hỗ
  trợ.

### Module discovery và package boundary

Manifest dùng contract core v1.0 đã phát hành:

```json
{
  "modules": [
    {
      "id": "aadp:answer",
      "version": "1.0",
      "schema": "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json"
    }
  ]
}
```

Server chỉ quảng bá entry sau khi Answer artifacts, endpoint/resource và
conformance đã deploy. Không thêm Answer-specific field vào `modules[]`.

Public API và schema paths:

```text
ail-aadp/modules/answer/v1.0
ail-aadp/schemas/modules/answer/v1.0/*
```

Không re-export Answer API từ package root. Tarball/clean-install consumer không
được import `src/**`.

### Wire boundary

Answer payload nằm tại extension `x_answer` ở root của core entity `type:
"answer"`. Không đặt protocol field trực tiếp trong application `data` và không
thêm field mới vào core entity schema.

```json
{
  "aadp_version": "1.0",
  "id": "answer:what-is-orbit",
  "type": "answer",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "updated_at": "2026-08-06T09:00:00Z",
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
      "author": {
        "name": "Example Editorial Team",
        "url": "https://example.com/editorial"
      }
    },
    "freshness": {
      "published_at": "2026-08-01T09:00:00Z",
      "updated_at": "2026-08-06T09:00:00Z",
      "reviewed_at": "2026-08-06T09:00:00Z"
    },
    "canonical_url": "https://example.com/answers/what-is-orbit",
    "applicability": {
      "audiences": ["general"],
      "jurisdictions": ["001"]
    },
    "related_entities": [
      {
        "target_type": "service",
        "target": {
          "id": "service:orbit",
          "url": "https://example.com/ai/v1.0/entities/service/orbit.json"
        }
      }
    ]
  }
}
```

`x_answer` là module document kind `answer` được registry dispatch bằng khóa
`{aadp:answer, 1.0, answer}`. Answer `1.0` không có standalone collection kind,
registry kind hoặc alternate-question document. Listing/pagination answer
resources tiếp tục dùng core sitemap/resource flow.

Core checksum vẫn tính theo core specification. Answer Module không định nghĩa
checksum thứ hai cho `x_answer`.

### Field contract

Schema đóng với `additionalProperties: false` ở mọi object do Answer Module định
nghĩa. Object `target` được `$ref` từ Relations giữ nguyên extension point `x_*`
của Relations `1.0`. Extension vendor trong Answer wrapper chưa được hỗ trợ ở
`1.0`; vendor data đặt trong core `data` hoặc module có namespace riêng.

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module` | Có | Hằng `aadp:answer` |
| `version` | Có | Hằng `1.0` |
| `kind` | Có | Hằng `answer` |
| `question` | Có | String đã trim, 1-500 Unicode code points |
| `concise_answer` | Có | String đã trim, 1-500 Unicode code points |
| `answer` | Không | String đã trim, 1-20.000 Unicode code points |
| `locale` | Có | Canonical BCP 47 language tag, tối đa 63 ký tự |
| `authorship` | Có | Tagged union `source-authored` hoặc `generated-summary` |
| `freshness` | Có | Timestamp provenance và optional expiry |
| `canonical_url` | Có | Absolute HTTPS URL không fragment/userinfo |
| `applicability` | Không | Audience/jurisdiction/time applicability có cấu trúc |
| `related_entities` | Không | 0-50 Answer entity references, không trùng canonical target |

Không hỗ trợ alias `short_answer` trong wire schema. Design draft cũ dùng
`short_answer` phải được cập nhật thành thuật ngữ chính thức `concise_answer`;
không hiển thị cả hai lựa chọn cho producer.

`question`, `concise_answer`, `answer`, author name và applicability notes đều là
untrusted text. Validator không render, execute, interpolate vào prompt, parse
HTML/Markdown instruction hoặc dereference URL từ các field này.

### Authorship contract

`authorship` dùng discriminator `kind`; hai nhánh loại trừ nhau.

Source-authored:

```json
{
  "kind": "source-authored",
  "author": {
    "name": "Example Editorial Team",
    "url": "https://example.com/editorial"
  }
}
```

- `author.name` bắt buộc, 1-200 code points.
- `author.url` optional, absolute HTTPS, không fragment/userinfo.
- Không có `generator`, `generated_at` hoặc `source_targets` trong nhánh này.

Generated summary:

```json
{
  "kind": "generated-summary",
  "generator": {
    "name": "Example Summarizer",
    "version": "2026-08"
  },
  "generated_at": "2026-08-06T08:55:00Z",
  "source_targets": [
    {
      "target_type": "document",
      "target": {
        "id": "document:orbit-overview",
        "url": "https://example.com/ai/v1.0/entities/document/orbit-overview.json"
      }
    }
  ],
  "reviewed_by": {
    "name": "Example Editorial Team"
  }
}
```

- `generator.name`, `generated_at` và 1-20 `source_targets` bắt buộc.
- `generator.version` và `reviewed_by` optional.
- Mỗi `source_targets[]` dùng Answer entity reference chứa `target_type` và một
  Relations `target`; nó chỉ biểu thị input source, không chứng minh factual
  truth, support hoặc citation validity.
- `reviewed_by` không đổi `kind`; generated content sau human review vẫn là
  `generated-summary` để bảo toàn provenance.
- Client không tự suy luận source-authored khi thiếu metadata và không tự chuyển
  kind sau khi fetch target.

### Locale contract

Answer `1.0` dùng deterministic BCP 47 profile giới hạn, không nhận toàn bộ
extension/private-use/grandfathered form của BCP 47. Profile gồm:

```text
language = 2-3 lowercase ASCII letters
script   = optional, 4 ASCII letters theo Title Case
region   = optional, 2 uppercase ASCII letters hoặc 3 digits
variant  = zero hoặc nhiều subtag: 5-8 lowercase alphanumeric,
           hoặc một digit theo sau bởi 3 lowercase alphanumeric
```

- Ví dụ hợp lệ: `vi`, `en`, `en-US`, `zh-Hant`, `zh-Hant-TW`.
- Underscore, extension singleton, private-use, grandfathered tag và casing khác
  profile bị từ chối trong Answer `1.0`, kể cả khi một BCP 47 implementation tổng
  quát có thể hiểu chúng.
- Schema và pure helper dùng cùng grammar/constants được export từ module; không
  dùng `Intl`, locale OS, ICU version hoặc network registry để quyết định validity.
- Module không yêu cầu `locale` nằm trong manifest application locales vì core
  manifest v1.0 chưa có normative locale registry.
- Locale chỉ mô tả ngôn ngữ chính của answer; validator không language-detect
  free text.

### Freshness contract

```json
{
  "published_at": "2026-08-01T09:00:00Z",
  "updated_at": "2026-08-06T09:00:00Z",
  "reviewed_at": "2026-08-06T09:00:00Z",
  "expires_at": "2027-08-06T09:00:00Z"
}
```

- Timestamp dùng RFC 3339 UTC dạng `Z`, precision tối đa milliseconds.
- `published_at` và `updated_at` bắt buộc; `reviewed_at`, `expires_at` optional.
- Invariant: `published_at <= updated_at`; nếu có `reviewed_at` thì
  `published_at <= reviewed_at`; nếu có `expires_at` thì mọi timestamp còn lại
  phải `<= expires_at`.
- `x_answer.freshness.updated_at` phải bằng core entity `updated_at`; invariant
  này thuộc entity-context validator, không thuộc registry wrapper validator.
- Expired answer vẫn schema-valid. Client helper phân loại `fresh` hoặc `stale`
  dựa trên injected clock; không dùng wall clock trong pure validator.
- Thiếu `expires_at` nghĩa là không khai báo expiry, không có nghĩa “vĩnh viễn
  đúng”.

### Applicability contract

`applicability` có tối thiểu một trong các field:

- `audiences`: 1-20 token duy nhất. Standard token `general` là unnamespaced và
  namespace `aadp:*` được AADP giữ chỗ. Vendor token phải theo
  `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]{0,63}$`; namespace trước dấu `:` phải do
  vendor sở hữu. Answer `1.0` chỉ đăng ký standard token `general`.
- `jurisdictions`: 1-50 code duy nhất; ISO 3166-1 alpha-2 uppercase hoặc UN M49
  ba chữ số. `001` nghĩa global.
- `valid_from` và `valid_until`: RFC 3339 UTC; nếu có cả hai thì
  `valid_from < valid_until`.
- `notes`: optional untrusted text, 1-1.000 code points, không có normative effect.

Namespaced vendor audience token hợp lệ về grammar được giữ nguyên. Unknown
unnamespaced token bị từ chối; client không tự hiểu vendor token là `general`.
Applicability không thay thế authorization; server vẫn dùng core/Relations
authorization policy trước khi trả resource/target.

### Related entity và Evidence boundary

`related_entities` và generated `source_targets` dùng component
`answer-reference.schema.json` có đúng hai field bắt buộc:

```json
{
  "target_type": "service",
  "target": {
    "id": "service:orbit",
    "url": "https://example.com/ai/v1.0/entities/service/orbit.json"
  }
}
```

- `target_type` theo core entity type grammar `^[a-z][a-z0-9_-]*$`.
- `target` `$ref` trực tiếp tới released Relations
  `schemas/modules/relations/v1.0/target.schema.json`; không copy schema đó.
- Relations target giữ nguyên contract đã release: cho phép HTTP/HTTPS và `x_*`.
  HTTP target không được tự coi là trusted; mọi fetch vẫn qua URL/DNS policy.
- Mỗi list không được có hai phần tử cùng canonical target theo semantic identity
  rule `{id, normalizedUrl}` của Relations.

Answer client chỉ resolve target khi caller opt in. Với mỗi reference, client gọi
`resolveRelationTarget(reference.target, reference.target_type, ...)`, dùng URL/DNS
policy, authorization behavior, scheduler, abort signal và cùng
`RelationsTraversalBudgetState` của traversal cha. Không suy đoán expected type từ
prefix của `target.id`, không tạo budget con và không retry ngoài policy hiện có.

Answer `1.0` không có field `evidence`, `claims` hoặc `citations`. Evidence Module
`1.4.0` sẽ liên kết bằng module riêng/Relations contract và không được âm thầm
thêm field vào Answer `1.0`. Rule “fact kiểm chứng được phải có evidence” trong
design memo là content governance advisory cho rollout sau `1.4.0`, không phải
Answer `1.0` schema/semantic invariant.

## Validation boundary

### JSON Schema

Schema chịu trách nhiệm cho:

- required fields, constants, tagged union và closed objects;
- string/array bounds, URL/timestamp shape và token grammar;
- Answer reference shape và target structural validation qua Relations `$ref`;
- `contains`/`minProperties` cần thiết cho applicability.

Schema không kiểm tra cross-field timestamp ordering, duplicate semantic target
hoặc equality với core entity `updated_at`; locale profile shape được schema và
pure helper kiểm tra bằng cùng constants/test vectors.

### Pure wrapper semantic validator

Registry giữ nguyên public contract đã phát hành:
`ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[]`. Validator
đăng ký cho `{aadp:answer, 1.0, answer}` chỉ nhận `x_answer`; không nhận hoặc suy
đoán core entity context, không fetch network, đọc clock hệ thống hoặc mutate
input. Validator kiểm tra:

- module/version/kind nhất quán;
- Unicode code-point bounds sau trim, không dùng UTF-16 length sai lệch;
- locale đúng deterministic Answer `1.0` profile;
- timestamp ordering;
- duplicate target theo Relations semantic identity;
- source-authored/generated-summary branch invariants ngoài khả năng schema;
- canonical HTTPS URL policy ở mức pure parsing.

### Entity-context validator

`validateAnswerEntityV1(entity)` là helper riêng ở Answer module layer. Helper:

1. Validate core entity v1.0 trước.
2. Yêu cầu `entity.type === "answer"` và có `x_answer` object.
3. Dispatch `x_answer` qua exact registry key `{aadp:answer, 1.0, answer}`.
4. Yêu cầu `x_answer.freshness.updated_at === entity.updated_at`.
5. Trả typed validated entity/wrapper hoặc structured validation result.

Không mở rộng generic module registry để truyền context và không thêm
Answer-specific branch vào core validator. Nhờ đó registry/Relations public API
và validation result của package `1.2.0` không đổi.

Các rule sau là advisory documentation, không tạo semantic error:

- câu hỏi có phải natural-language question;
- concise answer có tự đủ nghĩa;
- concise/full answer có mâu thuẫn;
- nội dung có đúng, current hoặc đủ evidence;
- author/generator có thật hoặc đáng tin.

Validation result dùng stable machine-readable codes với prefix
`answer.semantic.*`; message text không phải API ổn định.

## Layer boundary

```text
core discovery/entity validation
        ↓
module registry ──► Answer schema + pure semantic validator
        ↓
Answer entity validator/client ──► Relations resolver + shared traversal budget
        ↓
application content authoring/generation policy (ngoài package core)
```

- Core chỉ discovery, validate core envelope và bỏ qua extension không hỗ trợ.
- Answer schema/types/semantic/register nằm trong `src/modules/answer/v1.0`.
- Entity-context validation nằm trong Answer module, không nằm trong generic
  registry hoặc core validator.
- Answer client helper là service riêng, không chứa content-generation logic.
- Networking, URL/DNS, authorization, scheduling và budget tiếp tục do shared
  core/Relations infrastructure sở hữu.
- Reference server chỉ phục vụ deterministic neutral fixtures qua repository
  hiện có; không hardcode generation/business policy trong route boundary.
- Conformance runner riêng cho Answer, có thể reuse report/HTTP utilities nhưng
  không thay đổi stable core check IDs.

## Typed API contract

Module subpath export tối thiểu:

```ts
export type AnswerDocumentV1;
export type AnswerAuthorshipV1;
export type AnswerFreshnessV1;
export type AnswerApplicabilityV1;
export type AnswerEntityReferenceV1;
export type ValidatedAnswerEntityV1;
export type AnswerValidationIssue;
export type AnswerValidationResult;
export type AnswerEntityValidationResult;
export type AnswerClientOptions;
export type AnswerResolveOptions;
export type AnswerResolvedTargets;
export type AnswerConformanceOptions;
export type AnswerConformanceReport;
export type AnswerFreshnessState = "fresh" | "stale";

export function registerAnswerModule(): void;
export function validateAnswerV1(
  document: unknown,
): AnswerValidationResult;
export function validateAnswerEntityV1(
  entity: unknown,
): AnswerEntityValidationResult;
export function parseAnswerEntityV1(
  entity: unknown,
): ValidatedAnswerEntityV1;
export function fetchAnswerEntityV1(
  url: string,
  options: AnswerClientOptions,
  budget: RelationsTraversalBudgetState,
): Promise<ValidatedAnswerEntityV1>;
export function classifyAnswerFreshness(
  answer: AnswerDocumentV1,
  now: Date,
): AnswerFreshnessState;
export function resolveAnswerTargets(
  answer: AnswerDocumentV1,
  options: AnswerResolveOptions,
): Promise<AnswerResolvedTargets>;
export function runAnswerConformance(
  options: AnswerConformanceOptions,
): Promise<AnswerConformanceReport>;
```

Tên type có suffix `V1` hoặc nằm trong versioned subpath để tránh collision.
Public function không nhận implementation-private registry/network type nếu type
đó không được export từ public package path.

`fetchAnswerEntityV1` phải dùng core `fetchEntity`, sau đó gọi
`parseAnswerEntityV1`; không fetch hoặc trust target URL trước khi toàn bộ core
entity và `x_answer` hợp lệ. `parseAnswerEntityV1` là throwing convenience wrapper
trên `validateAnswerEntityV1`, không duplicate validation rules.

`resolveAnswerTargets` nhận caller-owned `RelationsTraversalBudgetState`,
`AbortSignal` và Relations resolver/dependencies qua options. Kết quả giữ thứ tự
input, phân biệt resolved, forbidden, not-found, invalid và budget-exhausted;
không trả partial result như thể complete.

## Schema và artifact inventory

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
├── types.ts
├── schemas.ts
├── semantic.ts
├── register.ts
├── index.ts
├── client/
│   ├── types.ts
│   ├── errors.ts
│   ├── fetch.ts
│   ├── freshness.ts
│   ├── resolve.ts
│   └── index.ts
└── conformance/
    ├── types.ts
    ├── checks.ts
    ├── report.ts
    ├── runner.ts
    └── index.ts
```

Nếu implementation cho thấy một file chỉ re-export một symbol và không tăng khả
năng test/reuse thì có thể gộp trong cùng layer; không được gộp pure semantic,
network resolution hoặc conformance vào UI/route/reference fixture.

## Fixture inventory

Valid fixtures tối thiểu:

- source-authored answer tối thiểu;
- source-authored có full answer, applicability và related entities;
- generated summary với source targets;
- generated summary đã human review nhưng giữ đúng generated kind;
- locale có language-region và timestamps milliseconds;
- expired nhưng schema/semantic-valid answer để test freshness helper.

Invalid fixtures tối thiểu:

- sai module/version/kind hoặc wrapper có unknown field;
- thiếu question/concise answer/locale/authorship/freshness/canonical URL;
- whitespace-only, quá giới hạn code points và malformed Unicode case;
- alias `short_answer` thay vì `concise_answer`;
- authorship chứa field của cả hai branch hoặc thiếu metadata bắt buộc;
- generated summary không có source target hoặc duplicate target;
- Answer reference thiếu `target_type`/`target`, có invalid target type hoặc fetched
  entity không khớp declared `target_type`;
- locale sai Answer `1.0` profile hoặc casing;
- timestamp sai format/order hoặc không khớp core `updated_at`;
- canonical/author URL dùng HTTP, userinfo, fragment hoặc malformed URL;
- applicability rỗng, duplicate, invalid token/jurisdiction/time range;
- related entity vượt limit, malformed Relations target hoặc duplicate identity;
- prompt-injection/HTML/script text vẫn được coi là inert data và không execute.

Fixtures dùng domain `example.com`, tên/type trung tính và deterministic timestamp.
Mỗi invalid fixture chỉ nên có một primary failure để check result ổn định.

## Conformance contract

Answer conformance có namespace check ID riêng, tối thiểu:

| Check ID | Nội dung |
|---|---|
| `answer.discovery` | Manifest quảng bá đúng `{id, version, schema}` |
| `answer.resource` | Fetch neutral Answer resource thành công qua core flow |
| `answer.schema` | Wrapper đúng Answer `1.0` schema |
| `answer.semantic` | Pure wrapper semantic invariants xanh |
| `answer.context` | Entity type, `x_answer` presence và `updated_at` equality xanh |
| `answer.authorship` | Discriminator/provenance không mơ hồ |
| `answer.references` | Targets resolve bằng Relations policy/shared budget |
| `answer.freshness` | Timestamp semantics và injected-clock classification đúng |
| `answer.security` | Free text inert; URL/target không bypass policy |

Runner phải hỗ trợ server có auth theo cùng option boundary với Relations. Report
phân biệt failed check, unsupported module và traversal/budget failure. Một external
consumer clean-install chỉ dùng public package exports phải đạt toàn bộ required
checks mà không import source internals.

Unsupported Answer version không phải remote deployment conformance check vì
runner không thể yêu cầu một conforming server quảng bá version giả. Hành vi này
được kiểm tra trong package compatibility suite bằng synthetic manifest/entity:
core-only consumer phải bỏ qua `x_answer`, còn opt-in Answer consumer phải trả
`unsupported_module_version` và không fallback sang `1.0`.

## Security và privacy contract

- Mọi free text là data không tin cậy; package không nối text vào system prompt,
  shell, HTML hoặc executable template.
- `canonical_url` và `author.url` là metadata, không được Answer validator/client
  tự fetch. Target URL chỉ fetch qua Relations URL/DNS policy.
- Redirect, DNS rebinding, private/link-local/reserved address và credential leak
  behavior kế thừa policy hiện có; Answer không có networking bypass.
- Authorization được kiểm tra trước khi trả answer/target. `applicability.audiences`
  không cấp quyền truy cập.
- Conformance output không log toàn bộ private answer/auth header mặc định.
- Authorship metadata không phải chữ ký, identity verification hoặc endorsement.
- Generated/source-authored label là provenance assertion của producer; schema
  validity không chứng minh assertion trung thực.

## Work packages

### Phase 0 — ADR và normative specification

1. Tạo Answer terminology/security ADR, Accepted trước wire code.
2. Viết `spec/modules/answer/v1.0/specification.md` từ contract đã khóa.
3. Viết `conformance.md`, stable check IDs và normative/advisory boundary.
4. Cập nhật design memo cũ từ `short_answer` sang `concise_answer`, bỏ Evidence
   invariant khỏi Answer `1.0` và ghi rõ deferred integration.

Gate: maintainer review ADR/spec; không còn TODO ảnh hưởng schema hoặc semantics.

### Phase 1 — Schema, types và fixtures

1. Tạo schema inventory, `$id` ổn định và cross-module `$ref` tới Relations target.
2. Tạo TypeScript types khớp schema; thêm compile-time public surface tests.
3. Tạo valid/invalid fixtures và schema/semantic expectation table.
4. Thêm checksum/release consistency coverage cho Answer schema artifacts.

Gate: schema tests, fixture tests và type build xanh; schema/types không lệch nhau.

### Phase 2 — Registry và semantic validation

1. Implement pure semantic helpers cho locale profile, timestamp và target uniqueness.
2. Đăng ký exact key `{aadp:answer, 1.0, answer}`.
3. Test unsupported module/version/kind và không fallback.
4. Implement/test `validateAnswerEntityV1` và `parseAnswerEntityV1` mà không đổi
   generic registry signature.
5. Test core-only validation vẫn bỏ qua `x_answer` an toàn.

Gate: deterministic semantic results trên Node hỗ trợ; không network/wall clock.

### Phase 3 — Client service và reference resource

1. Implement injected-clock freshness classifier.
2. Implement `fetchAnswerEntityV1` bằng core fetch rồi Answer parse/validation.
3. Implement typed-reference resolution bằng Relations resolver/shared budget.
4. Bổ sung neutral Answer repository/resource vào reference server và manifest
   chỉ sau khi endpoint/artifacts sẵn sàng.
5. Test abort, ordering, authorization, partial failure, budget exhaustion, URL
   policy và generated source targets.

Gate: không duplicate HTTP/DNS/budget implementation; reference server core và
Relations tests không regression.

### Phase 4 — Conformance và package exports

1. Implement Answer checks/report/runner theo conformance contract.
2. Export versioned module/schema subpaths và đưa artifacts vào npm tarball.
3. Thêm clean-install external consumer test không import internals.
4. Chạy malicious-text/security fixtures và synthetic unsupported-version
   compatibility suite.

Gate: build, full tests, docs links, release consistency, npm pack và external
conformance đều xanh.

### Phase 5 — Release hardening

1. Review immutable wire artifacts và record schema checksums.
2. Cập nhật README, changelog, module discovery examples và implementation record.
3. Chạy reference server/conformance từ packed tarball trên supported Node floor.
4. Xác nhận không còn Ailmao-specific fixture, draft `v0.1` URL hoặc import `src/**`.

Gate: release checklist được hai maintainer duyệt, gồm một reviewer không viết
schema implementation chính.

## File map dự kiến

Ngoài inventory mới, các file hiện có dự kiến thay đổi:

- `package.json`: package version, Answer exports và schema export path.
- `src/module-registry/*`: chỉ thay đổi generic registry nếu Answer làm lộ bug;
  không thêm Answer-specific branch vào core registry.
- `examples/reference-server/*`: neutral Answer repository/resource/discovery.
- `tests/modules/answer/v1.0/*`: registration, schema, semantic, client,
  conformance và package tests.
- `tests/package/*`: exports, tarball, compatibility và external clean install.
- `README.md`, `CHANGELOG.md`, docs index/design/roadmap và implementation record.

Không sửa released files dưới `schemas/modules/relations/v1.0` hoặc core schemas
v1.0 để làm Answer tests pass.

## Verification matrix

| Layer | Verification bắt buộc |
|---|---|
| Specification | Doc links, no unresolved normative TODO, examples schema-valid |
| Schema | Valid/invalid fixtures, exact `$id`, closed objects, cross-module `$ref` |
| Semantic | Locale profile, code points, timestamp order, wrapper/context validation, duplicates |
| Registry | Exact dispatch; unsupported module/version/kind; no fallback |
| Client | Fresh/stale injected clock, resolution order, abort, auth, shared budget |
| Security | Inert malicious text, URL/DNS/redirect policy, no sensitive report logging |
| Conformance | Stable check IDs, required/optional behavior, external implementation |
| Package | TypeScript build, exports, packed tarball, clean install, Node engine floor |
| Regression | Core, server, Relations và full existing test suite xanh |

Lệnh release verification tối thiểu sau khi implementation hoàn tất:

```bash
npm run build
npm test
npm run docs:check
npm run check:release-consistency
npm pack --dry-run
```

Ngoài các lệnh trên phải chạy clean-install/tarball suite hiện có; không xem
`npm pack --dry-run` đơn lẻ là bằng chứng public exports hoạt động.

## Release gate

Release `1.3.0` chỉ được phép khi:

- ADR Answer và specification/conformance `1.0` Accepted, không còn normative TODO.
- Package/core/Relations/Answer version matrix nhất quán.
- Schema, types, validator, client và conformance dùng cùng Answer version `1.0`.
- Source-authored/generated-summary phân biệt duy nhất bằng tagged union và mọi
  required provenance fixture xanh.
- Locale/freshness/applicability/reference semantics deterministic và có invalid
  fixture cho từng invariant normative.
- Target resolution dùng Relations resolver cùng shared budget, authorization,
  URL/DNS policy, abort và scheduler.
- Unsupported Answer version safely ignorable với core-only consumer và được opt-in
  consumer báo rõ là unsupported qua synthetic package compatibility test.
- External consumer clean-install đạt Answer conformance chỉ qua public exports.
- Existing core/Relations conformance và toàn bộ regression suite xanh.
- Packed tarball chứa spec/schema/examples cần thiết, không phụ thuộc `src/**`.
- Released wire schema có checksum record và được coi immutable theo module version.

## Definition of Done

- Tất cả work package và gate hoàn tất, không chỉ schema/type implementation.
- Reference server quảng bá Answer chỉ khi resource và artifacts đã deploy.
- Documentation tiếng Việt/Anh nhất quán thuật ngữ `concise answer`; không còn
  normative example dùng `short_answer` hoặc Answer `v0.1`.
- Không có Answer content generation, truth scoring hoặc Evidence contract bị kéo
  ngược vào package core/Answer `1.0`.
- Implementation record ghi quyết định, artifact checksum, verification commands
  và kết quả external conformance trước khi tag `ail-aadp@1.3.0`.

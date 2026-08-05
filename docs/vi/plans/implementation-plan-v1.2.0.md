# Kế hoạch triển khai `ail-aadp` 1.2.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Module infrastructure và Relations Module pilot |
| Blocking dependency | ADR hóa các quyết định đã chốt và hoàn tất semantics security/traversal |
| Wire impact | Module riêng; không đổi core schema v1.0 |

## Mục tiêu

- Xây module infrastructure dùng lại được cho các module sau `1.2.0`.
- Phát hành Relations Module pilot với schema, types, validator, client helper và
  conformance cùng một module version.
- Giữ package core và wire schema AADP v1.0 tương thích với consumer hiện tại.
- Chứng minh interoperability bằng một implementation không phụ thuộc internals
  của reference client.

## Ngoài phạm vi

- Không thêm Relations field chuẩn vào core entity schema v1.0.
- Không đưa Answer hoặc Evidence & Provenance Module vào `1.2.0`.
- Không thực hiện cross-module graph composition; phần này thuộc `1.5.0`.
- Không công bố `followers`/`follows` trong pilot khi privacy policy chưa được duyệt.
- Không đưa application-specific relation mapping vào package `ail-aadp`.

## Dependency bắt buộc

Chỉ bắt đầu thay đổi wire contract sau khi các quyết định sau được chấp nhận:

1. ADR quan hệ giữa package version, core protocol version và module version.
2. Module ID grammar, discovery, compatibility và package export-path rules.
3. Extension/document envelope boundary cho relation inline và collection document.
4. Authorization, shared traversal budget, cursor và cycle semantics.

ADR module versioning phải định nghĩa tối thiểu:

- Quy tắc chọn module version khi manifest công bố version chưa được client hỗ trợ.
- Thay đổi nào yêu cầu module major/minor/patch bump.
- Quan hệ tương thích giữa `aadp_version: "1.0"` và từng module version.
- Hành vi khi module ID, version, schema URL hoặc document kind không nhất quán.
- Quy tắc immutability cho schema và conformance profile đã release.

Các ADR phải chuẩn hóa và ghi rationale cho contract đã chốt trong kế hoạch này.
Không thay đổi contract đó trong quá trình implement nếu chưa cập nhật lại kế
hoạch và được maintainer phê duyệt.

## Quyết định contract đã chốt

### Version matrix

| Artifact | Version phát hành |
|---|---|
| npm package | `ail-aadp@1.2.0` |
| Core protocol | `aadp_version: "1.0"` |
| Relations Module | `aadp:relations@1.0` |

Relations `1.0` là wire contract normative đầu tiên; không phát hành wire version
`0.1` trong package `1.2.0`.

Quy tắc version của Relations Module:

- Patch: sửa tài liệu, validator hoặc implementation bug mà không thay đổi tập
  payload đã được schema chấp nhận.
- Minor: thêm relation token hoặc optional capability tương thích ngược.
- Major: thay đổi field, required field, cardinality, checksum, cursor hoặc
  authorization semantics theo cách không tương thích ngược.
- Client gặp module major version không hỗ trợ phải bỏ qua module an toàn; không
  fallback sang schema của major version khác.

### Manifest discovery

Manifest v1.0 chỉ dùng ba field core đã phát hành:

```json
{
  "modules": [
    {
      "id": "aadp:relations",
      "version": "1.0",
      "schema": "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json"
    }
  ]
}
```

Không thêm `registry` hoặc module-specific field không có namespace vào
`manifest.modules[]`. Relation registry được liên kết từ Relations specification
và module schema, không mở rộng core manifest contract.

### Inline relation set

Relation set nằm tại `x_relations` ở root entity. Không đặt nó trong `data` vì
`data` thuộc application domain, còn Relations là protocol extension.

```json
{
  "aadp_version": "1.0",
  "id": "post:abc",
  "type": "post",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "updated_at": "2026-08-05T00:00:00Z",
  "data": {},
  "x_relations": {
    "module": "aadp:relations",
    "version": "1.0",
    "kind": "relation-set",
    "items": [
      {
        "rel": "creator",
        "target_type": "character",
        "cardinality": "one",
        "target": {
          "id": "character:phu_diep",
          "url": "https://example.com/ai/v1.0/entities/character/phu_diep.json"
        }
      }
    ]
  }
}
```

Wrapper `x_relations` luôn có `module`, `version` và `kind` để entity vẫn tự mô
tả khi được cache hoặc xử lý ngoài manifest context. Core validator chỉ áp dụng
extension rule hiện có; Relations validator chịu trách nhiệm validate wrapper.

### Relation collection envelope

Collection là document của Relations Module và dùng envelope sau:

```json
{
  "aadp_version": "1.0",
  "module": "aadp:relations",
  "module_version": "1.0",
  "kind": "relation-collection",
  "source": {
    "id": "character:phu_diep",
    "type": "character"
  },
  "rel": "posts",
  "target_type": "post",
  "ordered": true,
  "generated_at": "2026-08-05T00:00:00Z",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "items": [
    {
      "id": "post:abc",
      "url": "https://example.com/ai/v1.0/entities/post/abc.json"
    }
  ],
  "cursor": {
    "next": null
  }
}
```

Collection contract:

- `checksum` tính trên canonical `items` của page, cùng convention với sitemap.
- `cursor.next` là opaque string hoặc `null`, được bind với source, relation,
  filter và ordering của collection đã phát hành.
- Collection rỗng trả `200` với `items: []`.
- Source không tồn tại trả AADP `not_found`; relation tồn tại nhưng caller không
  có quyền đọc trả `forbidden`.
- Collection endpoint không trả generic HTML error và không fallback sang HTML
  scraping.

### Document kinds

Relations `1.0` đăng ký đúng ba top-level document kinds:

- `relation-set`: wrapper tại `entity.x_relations`.
- `relation-collection`: một page của collection endpoint.
- `relation-registry`: standard relation registry machine-readable.

Relation item riêng lẻ chỉ là schema component, không phải document kind.

### Public package paths

Public JavaScript/TypeScript API:

```text
ail-aadp/modules/relations/v1.0
```

Public schema artifacts:

```text
ail-aadp/schemas/modules/relations/v1.0/*
```

Relations types, validators, client helper và `runRelationsConformance` được
export từ module subpath. Không re-export Relations API từ package root để tránh
name collision và giữ root compatibility khi thêm module mới.

## Wire boundary

- Manifest v1.0 tiếp tục discovery module qua `modules[]` với `id`, `version` và
  `schema`; không thêm field core mới vào manifest schema v1.0.
- Relation inline chỉ được đặt tại `x_relations` ở root entity v1.0 theo wrapper
  đã chốt; không đặt trong `data`.
- Relation collection là document thuộc Relations Module và phải tự mô tả core
  version, module ID/version cùng document kind theo envelope đã chốt.
- Mọi ví dụ tạm dùng `aadp_version: "0.2"` hoặc URL `/v0.2/` trong Relations
  design phải được thay bằng contract đã chốt trước khi chuyển fixture thành
  normative.
- Core-only consumer phải validate được core envelope và bỏ qua extension/module
  không hỗ trợ mà không fetch module schema hoặc relation endpoint.

## Module registry contract

Registry lookup dùng khóa `{moduleId, moduleVersion, kind}`:

- `moduleId`: module ID namespaced được manifest công bố, ví dụ
  `aadp:relations`.
- `moduleVersion`: wire version của module, độc lập với package version và
  `aadp_version`.
- `kind`: loại top-level document do module định nghĩa, không phải field mới của
  `manifest.modules[]`. Relations `1.0` có `relation-set`,
  `relation-collection` và `relation-registry`.

Mỗi registry entry ánh xạ tới schema và semantic validator tương ứng. Lookup phải
phân biệt rõ `unsupported module`, `unsupported version`, `unsupported kind` và
`invalid document`. Không fallback âm thầm sang schema của version khác.

## Layer boundary

```text
core discovery
      ↓
module registry ──► schema + pure semantic validator
      ↓
Relations client/traversal ──► core HTTP + URL/DNS policy + shared budget
      ↓
application relation mapping (ngoài package core)
```

- Core client chỉ discovery và bỏ qua unknown/unsupported module an toàn.
- Module registry, schemas và pure semantic validators nằm trong `src/modules`
  hoặc boundary tương đương theo convention được chốt trong ADR.
- Pure validator chỉ kiểm tra document đã có trong bộ nhớ; không fetch target,
  collection hoặc schema URL.
- Reference resolution và traversal là service riêng, dùng core HTTP, URL/DNS
  policy, cancellation, scheduler và cùng một shared budget của traversal cha.
- Relations client không duplicate networking, retry, SSRF policy hoặc budget
  accounting.
- Conformance runner điều phối check; rule nghiệp vụ nằm trong module service và
  check ID đã phát hành phải ổn định.

## Work packages

### `AADP-MODULE-001` — Module contract ADR

Deliverable:

- ADR cho module ID/version/discovery/compatibility/envelope/export path.
- Compatibility matrix giữa core v1.0 và module versions.
- Error taxonomy cho unsupported module/version/kind.

Gate: ADR Accepted trước khi merge schema hoặc fixture normative.

### `AADP-MODULE-REGISTRY` — Version-aware registry

Deliverable:

- Registry API theo `{moduleId, moduleVersion, kind}`.
- Schema và pure semantic validator lookup.
- Public package exports tại `ail-aadp/modules/relations/v1.0` và
  `ail-aadp/schemas/modules/relations/v1.0/*`.
- Unit tests cho exact match và unsupported ID/version/kind; không có version
  fallback ngầm.

Dependency: `AADP-MODULE-001`.

### `AADP-REL-001..003` — Relations contract

Deliverable:

- Relations ADR và standard relation registry.
- Schema cho `x_relations` one/inline-many, paginated collection và module
  envelope đã chốt.
- Valid, invalid và compatibility fixtures; ví dụ design được đồng bộ với core
  v1.0 cùng module version đã cấp.
- TypeScript types khớp schema và không duplicate core entity types.

Dependency: `AADP-MODULE-001`, `AADP-MODULE-REGISTRY`.

### `AADP-REL-004` — Semantic validation

Deliverable:

- Pure checks cho cardinality/container, token namespace, canonical ID/type,
  duplicate target và collection metadata consistency.
- Resolution checks riêng cho target ID/type, collection source/rel/type và
  broken endpoint.
- Stable issue/check IDs và provenance phân biệt lỗi local với lỗi resolution.

Dependency: `AADP-REL-001..003`.

### `AADP-REL-005` — Collection client và traversal

Deliverable:

- Typed opt-in client helper cho one, inline-many và paginated collection.
- Cursor deduplication/cycle guard và canonical-target deduplication.
- Shared depth/node/request/response-byte/deadline budget, cancellation và
  cross-origin request limit.
- Bổ sung request counter tổng quát trên shared traversal budget; không giả định
  `1.1.0` đã có `maxRequests` và không đổi default behavior của core-only client.
- Partial result kèm issue provenance khi traversal bị cắt bởi budget, policy
  hoặc unsupported module version.

Dependency: `AADP-REL-004`, core traversal controls `1.1.x` ổn định và ADR chốt
cách mở rộng budget state tương thích với public API `1.1.0`.

### `AADP-REL-006` — Conformance và security review

Deliverable:

- Relations conformance profile không thay đổi core check IDs.
- Cross-module/core compatibility, tarball export và clean-install tests.
- Privacy/social-graph, authorization, credential forwarding và SSRF review.
- Neutral implementation chỉ dựa trên published spec/schema/fixtures và public
  package exports; không import `src/**` hoặc reference-client internals.

Dependency: `AADP-REL-005`.

## Test matrix

| Nhóm | Bắt buộc |
|---|---|
| Schema | one, inline-many, collection-many, invalid envelope và unknown field |
| Semantic | cardinality, token, ID/type, duplicate target, source/rel/type mismatch |
| Compatibility | core-only, supported module, unknown module, unsupported version/kind |
| Traversal | cursor termination/cycle, target dedup, partial result, shared budgets |
| Security | SSRF, cross-origin cap, credentials, private relation, untrusted text |
| Packaging | build, public exports, tarball install và schema resolution |
| Interoperability | neutral implementation chạy cùng normative fixtures/conformance |

## Acceptance

- Typed one/inline-many/paginated collection contract không mơ hồ.
- Canonical target, inverse relation và collection snapshot semantics rõ ràng.
- Shared depth/node/request/response-byte/deadline budget, cross-origin limit và
  cycle guard có test.
- Pure validation tách khỏi network resolution/traversal.
- Privacy/social-graph và authorization review không còn finding mức blocking.
- Schema/types/validator/client/conformance cùng module version.
- External neutral implementation đạt Relations conformance chỉ bằng public
  artifacts.

## Release gate

- Tất cả ADR và quyết định tại mục Dependency đã Accepted.
- Unknown module và unsupported module version/kind được bỏ qua an toàn bởi
  core-only consumer, nhưng được báo rõ cho opt-in module consumer.
- Không thêm Relations field chuẩn vào released core schema v1.0; extension chỉ
  dùng extension point và envelope đã được ADR chấp nhận.
- Core-only consumer không regression; core conformance check IDs không đổi.
- Cross-module/core compatibility, clean-install, tarball và security tests xanh.
- Schema, fixtures, design examples, public exports và conformance cùng một module
  version.
- Neutral implementation đạt Relations conformance.

## Điều kiện chuyển trạng thái

- `Blocked Implementation Draft` → `Implementation Draft`: toàn bộ dependency
  bắt buộc đã Accepted.
- `Implementation Draft` → `Implementation Ready`: work-package owner, stable
  check IDs và normative fixtures đã được chốt; public paths và module version
  phải khớp mục Quyết định contract đã chốt.
- `Implementation Ready` → `Implemented`: toàn bộ Acceptance và Release gate đạt.

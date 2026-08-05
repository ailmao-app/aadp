# AADP Relations Module v1.0 Specification

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted |
| Module ID | `aadp:relations` |
| Module version | `1.0` |
| Core compatibility | AADP `1.0` |
| Package target | `ail-aadp@1.2.0` |

## Abstract

Tài liệu này định nghĩa wire contract normative cho Relations Module v1.0. Module
biểu diễn typed relations giữa AADP entities bằng inline relation set hoặc
paginated collection mà không đổi core schema v1.0. Từ khóa BCP 14 viết hoa có
nghĩa chuẩn tắc.

## 1. Scope

Module định nghĩa discovery, `x_relations`, relation one/inline-many/collection,
canonical target, standard registry, validation và traversal conformance. Module
không định nghĩa ranking, graph inference, database model, business authorization
hoặc automatic credential acquisition.

## 2. Discovery và compatibility

```json
{
  "id": "aadp:relations",
  "version": "1.0",
  "schema": "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json"
}
```

Server MUST chỉ quảng bá module khi payload, endpoints, schema và conformance
artifacts đã deploy. Core-only client MUST bỏ qua declaration và `x_relations`.
Relations client MUST exact-match ID/version và MUST NOT fallback version.
Field `schema` trỏ tới schema dispatch của các top-level Relations documents;
discovery entry được validate bởi core manifest schema v1.0, không bởi schema này.

## 3. Document kinds

- `relation-set`: value của `entity.x_relations`.
- `relation-collection`: một page từ collection endpoint.
- `relation-registry`: machine-readable standard registry.

Relation item và target chỉ là schema components.

## 4. Relation set

```json
{
  "module": "aadp:relations",
  "version": "1.0",
  "kind": "relation-set",
  "items": []
}
```

`module`, `version`, `kind`, `items` REQUIRED. Unknown non-`x_*` field MUST bị từ
chối; `x_*` MAY xuất hiện tại mọi object module định nghĩa.

## 5. Relation item

| Field | Required | Contract |
|---|---|---|
| `rel` | Có | Standard token hoặc vendor token namespaced |
| `target_type` | Có | AADP resource type token |
| `cardinality` | Có | `one` hoặc `many` |
| `inverse` | Không | Descriptive inverse token |
| `ordered` | Không | Default `false` |
| `updated_at` | Không | RFC 3339 date-time |

### 5.1 One

```json
{
  "rel": "creator",
  "target_type": "character",
  "cardinality": "one",
  "inverse": "created",
  "target": {
    "id": "character:alice",
    "url": "https://example.com/ai/v1.0/entities/character/alice.json"
  }
}
```

`one` MUST có đúng `target`, MUST NOT có `targets` hoặc `collection`.

### 5.2 Inline many

```json
{
  "rel": "series",
  "target_type": "series",
  "cardinality": "many",
  "ordered": false,
  "targets": [
    {
      "id": "series:example",
      "url": "https://example.com/ai/v1.0/entities/series/example.json"
    }
  ]
}
```

`many` MUST có đúng một trong `targets` hoặc `collection`. Inline list MUST không
quá 100 items; danh sách lớn hơn dùng collection.

### 5.3 Collection many

```json
{
  "rel": "posts",
  "target_type": "post",
  "cardinality": "many",
  "ordered": true,
  "collection": {
    "url": "https://example.com/ai/v1.0/relations/character/alice/posts.json",
    "pagination": "cursor"
  }
}
```

`collection.pagination` MUST là `cursor` trong v1.0.

## 6. Canonical target

`id` và absolute HTTP(S) `url` REQUIRED. `label`, `checksum`, `updated_at` là
hints. Entity tại URL authoritative và MUST có ID bằng target ID, type bằng
`target_type`. ID prefix trước `:` MUST bằng `target_type`.

## 7. Relation collection

```json
{
  "aadp_version": "1.0",
  "module": "aadp:relations",
  "module_version": "1.0",
  "kind": "relation-collection",
  "source": {
    "id": "character:alice",
    "type": "character"
  },
  "rel": "posts",
  "target_type": "post",
  "ordered": true,
  "generated_at": "2026-08-05T00:00:00Z",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "items": [],
  "cursor": {
    "next": null
  }
}
```

Mọi field REQUIRED trừ `ordered` có default `false`. `checksum` là SHA-256 của
canonical `items` theo core convention. `cursor.next` là opaque string hoặc
`null`, bind với source/relation/target type/ordering/filter. Page MUST không có
duplicate target IDs. `ordered: true` yêu cầu stable snapshot ordering.

## 8. Standard registry

Machine-readable registry dùng envelope:

```json
{
  "aadp_version": "1.0",
  "module": "aadp:relations",
  "module_version": "1.0",
  "kind": "relation-registry",
  "generated_at": "2026-08-05T00:00:00Z",
  "checksum": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "relations": [
    {
      "token": "related",
      "inverse": "related",
      "symmetric": true,
      "description": "A general symmetric relationship"
    }
  ]
}
```

`aadp_version`, `module`, `module_version`, `kind`, `generated_at`, `checksum`,
`relations` REQUIRED. `checksum` tính trên canonical `relations`. Mỗi token MUST
unique. `inverse` MAY omit khi không có inverse chuẩn; `symmetric: true` yêu cầu
`inverse` bằng chính token. `description` là untrusted informational text.

| Token | Inverse hint | Semantics |
|---|---|---|
| `creator` | `created` | Target tạo nguồn |
| `created` | `creator` | Target được nguồn tạo |
| `author` | `authored` | Target viết nguồn |
| `authored` | `author` | Target được nguồn viết |
| `posts` | `creator` hoặc `author` | Target là post của nguồn |
| `series` | `has_part` | Target là series của nguồn |
| `part_of` | `has_part` | Nguồn là phần của target |
| `has_part` | `part_of` | Target là phần của nguồn |
| `mentions` | `mentioned_by` | Nguồn nhắc target |
| `mentioned_by` | `mentions` | Target nhắc nguồn |
| `about` | `subject_of` | Nguồn nói về target |
| `subject_of` | `about` | Target nói về nguồn |
| `supports` | `supported_by` | Nguồn hỗ trợ target |
| `supported_by` | `supports` | Target hỗ trợ nguồn |
| `evidence` | `supports` | Target là evidence |
| `source` | `source_of` | Target là nguồn |
| `source_of` | `source` | Target dùng nguồn entity |
| `related` | `related` | Quan hệ đối xứng chung |

`follows`/`followers` không thuộc registry v1.0 vì privacy risk. Vendor token MUST
khớp `^x_[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$`. Unknown unnamespaced token MUST bị
từ chối. Inverse consistency là SHOULD, không phải MUST.

## 9. HTTP behavior

- Success: `200 application/json`.
- Empty collection: `200`, `items: []`.
- Unknown source: AADP `not_found`.
- Invalid/cross-context cursor: AADP `invalid_request`.
- Missing credential: AADP `unauthorized`.
- Policy-blocked known relation: AADP `forbidden`.

Collection SHOULD hỗ trợ ETag, Last-Modified và conditional GET. Generic HTML
error hoặc silent scraping fallback MUST NOT được dùng.

## 10. Schema artifacts

Package MUST ship đúng các artifacts sau:

```text
schemas/modules/relations/v1.0/
├── module.schema.json
├── relation-set.schema.json
├── relation-item.schema.json
├── target.schema.json
├── collection-link.schema.json
├── relation-collection.schema.json
└── relation-registry.schema.json
```

`module.schema.json` là schema dispatch của module và MUST dùng `oneOf` theo
`kind` tới đúng ba top-level document schemas. Nó MUST NOT validate discovery
entry `{id, version, schema}`; entry đó thuộc core manifest schema v1.0. Component
schemas MUST không được đăng ký như document kinds.

## 11. Validation model

Pure validation kiểm tra schema/cardinality/token/ID prefix/duplicates mà không
gọi network. Resolution validation fetch target/collection và kiểm tra identity,
context, cursor bằng shared HTTP/budget. Pure validation MUST chạy trước khi tin
URL trong module payload.

## 12. Traversal

Traversal MUST tuân ADR-0008: shared depth/node/request/byte/deadline budget,
cross-origin cap, cancellation, cycle guard và dedup. Partial/inconclusive result
MUST không được báo complete.

## 13. Security và privacy

- Relation text/label là untrusted data.
- Mọi URL qua SSRF/redirect policy.
- Module MUST không vượt target security scheme.
- Public AADP MUST không xuất private/block/moderation relation.
- Broken relation MUST không kích hoạt scraping hoặc tool execution.

## 14. Compatibility

Core-only consumer bỏ qua `x_relations`. Schema/types/validator/client/conformance
của Relations 1.0 MUST release cùng nhau.

## 15. IANA Considerations

Tài liệu này không yêu cầu hành động IANA.

## 16. References

- [AADP v1.0 specification](../../../v1.0/specification.md)
- [ADR-0007](../../../../docs/adr/0007-module-versioning-and-discovery.md)
- [ADR-0008](../../../../docs/adr/0008-module-traversal-and-authorization.md)
- [Conformance contract](conformance.md)

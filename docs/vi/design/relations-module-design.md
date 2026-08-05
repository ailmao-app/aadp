# Thiết kế AADP Relations Module

> Ngôn ngữ: Tiếng Việt.
>
> Trạng thái: Superseded bởi [Relations Module v1.0 specification](../../../spec/modules/relations/v1.0/specification.md), [ADR-0007](../../adr/0007-module-versioning-and-discovery.md) và [ADR-0008](../../adr/0008-module-traversal-and-authorization.md). Nội dung bên dưới chỉ giữ làm lịch sử thiết kế.
>
> Owner quyết định: AADP maintainers.
>
> Dependency bắt buộc: ADR module versioning.

Không dùng version, envelope, registry hoặc URL ví dụ bên dưới để implement.
Nguồn contract hiện hành là specification và ADR được liên kết ở trên.

## 1. Mục tiêu

Relations Module giúp AI client hiểu và duyệt graph giữa các AADP entity thay vì chỉ đọc từng document rời rạc.

```text
post ──creator─────► character
post ──part_of─────► series
character ─posts───► post collection
answer ──about─────► entity
answer ──evidence──► claim
claim ──evidence───► evidence
evidence ─source───► source
```

Module hỗ trợ:

- Quan hệ một-một và một-nhiều.
- Canonical ID và entity URL.
- Inline target cho danh sách nhỏ.
- Collection URL có cursor pagination cho danh sách lớn.
- Inverse relation khi có semantic rõ ràng.
- Reference integrity, cycle guard và traversal budget.
- Visibility/authorization policy của server.

## 2. Vị trí trong AADP

```text
AADP
├── Transport Core
├── Relations Module
├── Answer Module
└── Evidence & Provenance Module
```

Answer và Evidence modules dùng Relations Module để liên kết resource. Chúng không tự định nghĩa format reference riêng.

## 3. Vì sao không dùng object map đơn giản

Không dùng:

```json
{
  "relations": {
    "posts": "...",
    "followers": "...",
    "series": "...",
    "creator": "..."
  }
}
```

Cấu trúc trên không cho biết giá trị là canonical ID, entity URL hay collection endpoint; không thể hiện cardinality, pagination, target type, ordering hoặc freshness.

Relations Module dùng mảng typed relation với contract rõ ràng.

## 4. Data model

### 4.1 Relation một-một

```json
{
  "rel": "creator",
  "target_type": "character",
  "cardinality": "one",
  "inverse": "posts",
  "target": {
    "id": "character:phu_diep",
    "url": "https://example.com/ai/v0.2/entities/character/phu_diep.json"
  }
}
```

### 4.2 Relation một-nhiều inline

Chỉ dùng khi danh sách nhỏ, bounded và được phép bulk publication:

```json
{
  "rel": "series",
  "target_type": "series",
  "cardinality": "many",
  "ordered": false,
  "targets": [
    {
      "id": "series:ngu_quy",
      "url": "https://example.com/ai/v0.2/entities/series/ngu_quy.json"
    }
  ]
}
```

### 4.3 Relation một-nhiều qua collection

```json
{
  "rel": "posts",
  "target_type": "post",
  "cardinality": "many",
  "ordered": true,
  "collection": {
    "url": "https://example.com/ai/v0.2/relations/character/phu_diep/posts.json",
    "pagination": "cursor"
  },
  "updated_at": "2026-07-22T00:00:00Z"
}
```

## 5. Field và invariant

| Field | Required | Ý nghĩa |
|---|---|---|
| `rel` | Có | Relation token chuẩn hoặc namespaced extension |
| `target_type` | Có | Resource type của target |
| `cardinality` | Có | `one` hoặc `many` |
| `target` | Khi `one` | Một canonical target |
| `targets` | Tùy chọn khi `many` | Danh sách inline bounded |
| `collection` | Tùy chọn khi `many` | Collection endpoint có pagination |
| `inverse` | Không | Relation token chiều ngược |
| `ordered` | Không | Thứ tự target có semantic hay không |
| `updated_at` | Không | Lần gần nhất tập quan hệ thay đổi |
| `x_*` | Không | Extension có namespace |

Invariant:

- `cardinality = one` yêu cầu đúng một `target`, không có `targets`/`collection`.
- `cardinality = many` yêu cầu đúng một trong `targets` hoặc `collection`.
- `target.id` phải có prefix bằng `target_type`.
- `target.url` phải trả entity có `id` và `type` tương ứng.
- `collection` phải trả relation collection schema, không trả HTML hoặc generic 404.
- `targets` không vượt inline limit của module.
- Nếu `ordered = true`, server giữ thứ tự ổn định trong snapshot/cursor.

## 6. Canonical target

```json
{
  "id": "character:phu_diep",
  "url": "https://example.com/ai/v0.2/entities/character/phu_diep.json",
  "label": "Phù Điệp",
  "checksum": "sha256:...",
  "updated_at": "2026-07-22T00:00:00Z"
}
```

`id` và `url` là required. `label`, `checksum` và `updated_at` chỉ là hint; entity tại `url` vẫn authoritative.

## 7. Relation collection

```json
{
  "aadp_version": "0.2",
  "module": "aadp:relations",
  "source": "character:phu_diep",
  "rel": "posts",
  "target_type": "post",
  "generated_at": "2026-07-22T00:00:00Z",
  "checksum": "sha256:...",
  "items": [
    {
      "id": "post:oid_abc123",
      "url": "https://example.com/ai/v0.2/entities/post/oid_abc123.json"
    }
  ],
  "cursor": { "next": null }
}
```

Quy tắc:

- Cursor opaque, không cycle và có page-size cap.
- Checksum tính trên canonical `items` của page.
- Hỗ trợ `ETag`, `Last-Modified` và conditional GET.
- Collection tồn tại nhưng rỗng trả `200` với `items: []`.
- Source không tồn tại trả `not_found`.
- Relation không được publish trả error code chuẩn, không generic 404.

## 8. Standard relation registry

| Relation | Inverse gợi ý | Ý nghĩa |
|---|---|---|
| `creator` | `created` | Entity được tạo bởi target |
| `author` | `authored` | Nội dung được viết bởi target |
| `posts` | `creator`/`author` | Post thuộc creator/author |
| `series` | `has_part` | Entity thuộc/tham gia series |
| `part_of` | `has_part` | Entity là thành phần của target |
| `has_part` | `part_of` | Target là thành phần của entity |
| `follows` | `followers` | Entity theo dõi target |
| `followers` | `follows` | Target theo dõi entity |
| `mentions` | `mentioned_by` | Entity nhắc tới target |
| `about` | `subject_of` | Nội dung nói về target |
| `supports` | `supported_by` | Quan hệ support |
| `evidence` | `supports` | Liên kết tới evidence |
| `source` | `source_of` | Liên kết tới nguồn |
| `related` | `related` | Quan hệ đối xứng chung |

Vendor relation phải có namespace, ví dụ `x_ailmao:inspired_by`. Không tạo token mới nếu registry đã có khái niệm tương đương.

## 9. Followers và dữ liệu nhạy cảm

Phân biệt:

- `follower_count`: field tổng hợp.
- `followers`: relation công bố danh sách entity.

Không thêm `followers` relation chỉ vì UI hiển thị số follower. Chỉ publish danh sách khi visibility, block và privacy policy cho phép bulk enumeration và đã audit khả năng suy luận social graph.

Với Ailmao pilot, mặc định chỉ xuất `follower_count`; `followers`/`follows` nằm ngoài phạm vi cho tới khi policy được duyệt.

## 10. Manifest discovery

```json
{
  "modules": [
    {
      "id": "aadp:relations",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/relations/v0.1/schema.json",
      "registry": "https://aadp.dev/relations/v0.1/registry.json"
    }
  ]
}
```

Chỉ công bố module khi entity schema, collection endpoints và conformance đã sẵn sàng; không quảng bá dead URL.

## 11. Schema và semantic validation

```text
schemas/modules/relations/v0.1/
├── relation.schema.json
├── target.schema.json
├── collection-link.schema.json
├── collection-response.schema.json
└── registry.schema.json
```

Semantic validator kiểm tra:

- Token thuộc registry hoặc có namespace hợp lệ.
- Cardinality khớp target container.
- Canonical ID prefix khớp `target_type`.
- Target URL trả đúng `id`/`type`.
- Collection source/rel/type khớp link từ entity.
- Không duplicate target trong snapshot.
- Cursor không cycle.
- Traversal không vượt depth/node/request budget.

Inverse consistency là `SHOULD`, không mặc định `MUST`, vì target có thể không công bố chiều ngược hoặc cập nhật không đồng thời.

## 12. Compatibility

Nếu entity schema hiện tại đã immutable, draft dùng `x_relations`, sau đó migrate sang `relations` ở AADP version mới. Không sửa payload v0.1 dưới cùng version.

Core-only client phải bỏ qua module mà vẫn đọc được entity envelope. Client tuyên bố hỗ trợ graph traversal phải validate Relations Module.

## 13. Security

- Giới hạn traversal depth, node count, request count và cross-origin requests.
- Không xuất private/block/moderation relation trong public AADP.
- Relation label/text là untrusted data, không phải instruction.
- Collection URL tuân theo SSRF policy của reference client.
- Không dùng relation để vượt security scheme của target resource.
- Broken relation không fallback sang HTML scraping âm thầm.

## 14. Conformance plan

- One-to-one, inline-many và collection-many fixtures.
- Pagination kết thúc, không duplicate/cycle.
- Target ID/type mismatch bị phát hiện.
- Broken target URL và generic 404 bị phát hiện.
- Wrong collection source/rel/type bị phát hiện.
- Unknown standard token bị từ chối; namespaced extension được chấp nhận.
- Client dừng tại traversal budget.
- Fixture private-policy không xuất `followers`.

## 15. Áp dụng cho Ailmao

Rollout:

1. `post → creator → character`.
2. `character → posts → post collection`.
3. `answer → about → character/concept`.
4. `answer → evidence → claim`.
5. `claim → evidence → evidence`.
6. `evidence → source → source`.
7. `series/part_of` chỉ khi có canonical series model public.
8. `followers/follows` hoãn tới khi privacy policy được duyệt.

Adapter nằm trong `ailmao-landing/lib/aadp/relations`; route chỉ validate request, gọi service và trả response/cache headers.

## 16. Release gate

- Relation schemas, registry và semantic validator xanh.
- Reference graph chạy end-to-end.
- Collection pagination/cache/checksum đạt core contract.
- Broken link, mismatch và cycle bị conformance phát hiện.
- Privacy/social-graph audit hoàn tất.
- Ailmao chỉ công bố endpoint đã deploy và không trả generic 404.

## 17. Issue đề xuất

1. `AADP-REL-001`: ADR Relations Module và entity integration.
2. `AADP-REL-002`: Relation registry v0.1.
3. `AADP-REL-003`: JSON Schema và fixtures.
4. `AADP-REL-004`: Semantic validator.
5. `AADP-REL-005`: Reference collection/client traversal.
6. `AADP-REL-006`: Conformance và security review.
7. `AILMAO-REL-001`: `post → creator` mapping.
8. `AILMAO-REL-002`: Character posts collection.
9. `AILMAO-REL-003`: Answer/Evidence graph mapping.
10. `AILMAO-REL-004`: Staging conformance và rollout.

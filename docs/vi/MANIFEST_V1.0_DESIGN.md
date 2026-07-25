# Thiết kế AADP Manifest v1.0

> Ngôn ngữ: Tiếng Việt.
>
> Trạng thái: Design gate closed (Phase 0, xem [ADR-0005](adr/0005-manifest-v1-discovery.md), Accepted). Tài liệu này chưa thay thế manifest v0.1 đang được pilot sử dụng — schema v1.0 chưa viết (Phase 1).

## 1. Mục tiêu

Manifest v1.0 là **application discovery document** giúp AI client trả lời các câu hỏi sau trước khi đọc dữ liệu:

1. Ứng dụng này là gì và do ai vận hành?
2. Những URL nào dành cho người dùng?
3. AADP discovery bắt đầu từ đâu?
4. Ứng dụng công bố những resource và module AADP nào?
5. Có những interface nào ngoài AADP?
6. Mỗi interface yêu cầu cơ chế xác thực nào?
7. Chính sách truy cập, sử dụng và attribution nằm ở đâu?
8. Publisher có preference nào về ngôn ngữ, tóm tắt và trích dẫn?

Manifest không phải OpenAPI replacement, authorization server, robots policy engine hoặc system prompt.

## 2. Cấu trúc chuẩn

```text
AADP Manifest
├── application          # Danh tính ứng dụng/publisher
├── links                # Điều hướng dành cho người
├── discovery            # AADP sitemap index
├── modules              # Module chuẩn như Answer/Evidence
├── resources            # Loại dữ liệu được công bố
├── interfaces           # REST/GraphQL/MCP/WebSocket liên quan
├── security_schemes     # Cơ chế auth có thể tham chiếu
├── policies             # Policy URL và machine-readable summary
└── usage_guidance       # Publisher preference, không phải instruction
```

## 3. Ranh giới semantic

| Section | Trả lời | Không chứa |
|---|---|---|
| `application` | Đây là ứng dụng nào? | Endpoint và auth |
| `links` | Người dùng mở trang nào? | API contract |
| `discovery` | AADP enumeration bắt đầu ở đâu? | Resource payload |
| `modules` | Semantic module AADP nào được bật? | Nhãn marketing trống nghĩa |
| `resources` | Loại dữ liệu nào được công bố? | Interactive operation |
| `interfaces` | Có interface/transport nào? | Credential thật |
| `security_schemes` | Interface dùng auth gì? | Token, secret hoặc session |
| `policies` | Policy nào áp dụng? | Nội dung pháp lý đầy đủ |
| `usage_guidance` | Publisher mong muốn cách dùng/cite ra sao? | System/developer instruction |

## 3a. Design gate đã chốt (Phase 0)

Bốn quyết định sau đóng design gate tại `IMPLEMENTATION_PLAN.md` §3. Chi tiết
rationale nằm ở [ADR-0005](adr/0005-manifest-v1-discovery.md); phần này là
bản chốt áp dụng trực tiếp cho schema Phase 1.

### 3a.1 Localization

Quyết định: **v1.0 không có `localization` object riêng.** Locale phục vụ
retrieval tiếp tục là cơ chế core envelope không đổi — entity `locale` field
và query param `locale` (spec v0.1 §4) — độc lập với manifest.

- `usage_guidance.default_language` / `usage_guidance.available_languages`
  **chỉ** là publisher preference cho AI output (tóm tắt, trả lời bằng ngôn
  ngữ nào), **không** điều khiển content negotiation khi fetch entity.
- Client MUST NOT dùng `usage_guidance.default_language` để chọn `locale`
  query param khi gọi entity endpoint.
- Nếu server không localize entity, `usage_guidance.available_languages` MAY
  chỉ chứa một ngôn ngữ duy nhất — điều này không có nghĩa server hỗ trợ
  localized retrieval.

### 3a.2 Resource authority

Quyết định: **sitemap index authoritative, `resources[]` không lặp `sitemap`
URL.**

- `discovery.sitemap_index` → sitemap-index document (`sitemaps[].type`,
  `sitemaps[].url`) là nguồn duy nhất cho danh sách resource type thực sự
  được publish và URL sitemap tương ứng.
- `resources[]` (manifest) chỉ bổ sung metadata theo `type`: `media_types`,
  `security`. **Không có field `resources[].sitemap`** — ví dụ manifest ở
  mục 4 đã được cập nhật để bỏ field này.
- Semantic validator (Phase 3, pure/no-HTTP) chỉ kiểm tra `resources[].type`
  duy nhất trong danh sách. Việc đối chiếu `resources[].type` với
  `sitemap-index.sitemaps[].type` thực tế là HTTP check, thuộc conformance
  suite (Phase 5), không thuộc semantic validator.

### 3a.3 Security metadata

Quyết định: **phương án đầy đủ** — v1.0 định nghĩa 3 security scheme type
với metadata tối thiểu đủ để client xác định flow:

| `type` | Required fields | Ghi chú |
|---|---|---|
| `none` | — | Không auth. |
| `api_key` | `in` (`"header"` \| `"query"`), `name` | Không chứa key mẫu hay giá trị thật. |
| `oauth2` | `authorization_url` | `token_url`, `scopes` optional. Không chứa client secret. |

- `security_schemes` dùng discriminated union theo `type` (khớp §5 Phase 1
  yêu cầu).
- Không được công bố `interfaces[].security` hoặc `resources[].security`
  trỏ tới một scheme thiếu required field theo bảng trên — schema Phase 1
  phải enforce việc này bằng JSON Schema `oneOf`/`if-then`, không chỉ bằng
  tài liệu.
- Ailmao pilot (mục 10) chỉ dùng `none` ở giai đoạn đầu; `api_key`/`oauth2`
  là năng lực core, không bắt buộc mọi adapter phải dùng.

### 3a.4 Root required fields

| Field | Required? | Ghi chú |
|---|---|---|
| `aadp_version` | **Required** | `const "1.0"`. |
| `application` | **Required** | `name`, `description`, `publisher.name`, `publisher.url` required bên trong. |
| `discovery` | **Required** | `sitemap_index` required bên trong. |
| `policies` | **Required** | `robots`, `terms` required bên trong; các field còn lại optional (§5.8). |
| `links` | Optional | Omit nếu không có route nào. |
| `modules` | Optional | Omit nếu không module nào đạt conformance. |
| `resources` | Optional | Omit nếu chưa publish resource nào. |
| `interfaces` | Optional | Omit nếu không có interface ngoài AADP. |
| `security_schemes` | Optional* | *Required nếu bất kỳ `resources[].security` hoặc `interfaces[].security` tham chiếu tới một scheme ID. |
| `usage_guidance` | Optional | Omit nếu publisher chưa duyệt preference. |

Quy tắc omit vs rỗng: **mọi field kiểu array cấp top-level (`resources`,
`modules`, `interfaces`) phải omit hoàn toàn khi không có phần tử nào — MUST
NOT publish `[]`.** Lý do: JSON Schema không phân biệt được "server cố ý
không có gì" với "server quên điền"; ép field vắng mặt loại bỏ nhập nhằng đó
mà không cần thêm field `*_declared: boolean` phụ. Field kiểu object
(`security_schemes`) áp dụng cùng quy tắc: omit thay vì `{}`.

## 4. Manifest đề xuất

```json
{
  "aadp_version": "1.0",
  "application": {
    "name": "Example Application",
    "description": "A short factual description.",
    "mission": "The application's public mission.",
    "categories": ["social-network", "ai-characters"],
    "publisher": {
      "name": "Example Publisher",
      "url": "https://example.com"
    }
  },
  "links": {
    "homepage": "https://example.com",
    "feed": "https://example.com/feed",
    "search": "https://example.com/search",
    "profiles": "https://example.com/profiles"
  },
  "discovery": {
    "sitemap_index": "https://example.com/ai/v1.0/sitemap-index.json"
  },
  "modules": [
    {
      "id": "aadp:relations",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/relations/v0.1/schema.json"
    },
    {
      "id": "aadp:answer",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/answer/v0.1/schema.json"
    },
    {
      "id": "aadp:evidence",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/evidence/v0.1/schema.json"
    }
  ],
  "resources": [
    {
      "type": "character",
      "media_types": ["text", "image", "video"],
      "security": "guest"
    }
  ],
  "interfaces": [
    {
      "id": "public-rest",
      "type": "rest",
      "version": "v1",
      "documentation": "https://example.com/docs/api",
      "security": "guest"
    },
    {
      "id": "public-mcp",
      "type": "mcp",
      "endpoint": "https://example.com/mcp",
      "security": "oauth2"
    }
  ],
  "security_schemes": {
    "guest": {
      "type": "none"
    },
    "oauth2": {
      "type": "oauth2",
      "authorization_url": "https://example.com/oauth/authorize",
      "scopes": ["aadp.read"]
    }
  },
  "policies": {
    "robots": "https://example.com/robots.txt",
    "terms": "https://example.com/terms",
    "privacy": "https://example.com/privacy",
    "content_license": {
      "id": "proprietary-public-read",
      "url": "https://example.com/terms#content-license"
    },
    "adult_content": "not_published",
    "copyright": "https://example.com/terms#copyright"
  },
  "usage_guidance": {
    "default_language": "en",
    "available_languages": ["en"],
    "summary_preference": "Preserve material context and uncertainty.",
    "citation_preference": "Cite the canonical_url of the referenced resource.",
    "attribution": {
      "preferred_text": "Source: Example Publisher",
      "publisher_url": "https://example.com"
    }
  }
}
```

## 5. Quy tắc từng section

### 5.1 `application`

Required:

- `name`
- `description`
- `publisher.name`
- `publisher.url`

Optional:

- `mission`
- `categories`

Quy tắc:

- Nội dung phải mang tính mô tả, không dùng superlative không có bằng chứng.
- Category dùng token lowercase đã chuẩn hóa hoặc extension namespace.
- Publisher URL phải là URL public canonical.

### 5.2 `links`

- Đây là URL dành cho người, không phải API endpoint.
- Các key chuẩn ban đầu: `homepage`, `feed`, `search`, `profiles`.
- Key ngoài chuẩn phải dùng `x_*`.
- URL không tồn tại không được quảng bá.
- Locale-specific link nên dùng object được schema hóa thay vì tự thêm suffix key.

### 5.3 `discovery`

- Manifest v1.0 được publish tại URL canonical `/.well-known/ai-manifest.json`.
- URL well-known trả trực tiếp manifest có `aadp_version: "1.0"`; không dùng version index hoặc content negotiation.
- `sitemap_index` là entry point authoritative cho AADP enumeration.
- Không quảng bá base URL luôn trả 404.
- Entity URL authoritative nằm trong `sitemap.items[].url`.
- Nếu tương lai cần dựng URL, dùng URI Template được chuẩn hóa, không dùng một `entity_base` mơ hồ.

HTTP behavior của manifest (chốt Phase 0, kế thừa ADR-0002 cho v0.1):

- `Content-Type: application/json`, giống v0.1.
- Server SHOULD set `Cache-Control` (khuyến nghị `max-age=300`); manifest
  không bắt buộc có checksum-backed `ETag` ở v1.0 — giống quyết định v0.1
  (ADR-0002 §"manifest có no checksum"), vì đây là tài liệu discovery nhỏ,
  gần như tĩnh. Một minor version sau MAY thêm validator additive.
- Response size: server SHOULD giữ manifest dưới 64 KiB. Reference client
  (Phase 4) MUST từ chối (không parse) response vượt quá **256 KiB** — đây
  là hard cap bảo vệ client khỏi oversized/malicious response, không phải
  khuyến nghị kích thước cho server.

### 5.4 `modules`

Module là thành phần chuẩn bên trong AADP, ví dụ:

- `aadp:relations`
- `aadp:answer`
- `aadp:evidence`

Mỗi entry required:

- `id`
- `version`
- `schema`

Không dùng token `aeo`, `geo`, `story` hoặc `chat` mà không có contract/schema cụ thể.

`aadp:relations` chuẩn hóa graph link giữa entity, bao gồm cardinality, canonical target, inverse relation và paginated collection. Chi tiết nằm tại [`RELATIONS_MODULE_DESIGN.md`](RELATIONS_MODULE_DESIGN.md).

### 5.5 `resources`

Resource là loại dữ liệu có thể enumeration/retrieval, ví dụ:

- `character`
- `post`
- `answer`
- `claim`
- `evidence`
- `source`

`image` và `video` mặc định là `media_types`; chỉ trở thành resource riêng nếu có canonical ID, sitemap và entity lifecycle độc lập.

`chat` không phải resource; đó là operation/interface và không thuộc AADP read-only core.

Resource authority: `discovery.sitemap_index` là nguồn duy nhất cho danh sách
type thực publish (xem §3a.2). `resources[]` không có field `sitemap` — chỉ
bổ sung `media_types` và `security` theo `type` đã xuất hiện trong sitemap
index.

### 5.6 `interfaces`

Các type dự kiến:

- `rest`
- `graphql`
- `mcp`
- `websocket`

Manifest chỉ mô tả discovery metadata. Contract chi tiết phải nằm trong OpenAPI, GraphQL schema, MCP discovery hoặc tài liệu tương ứng.

Mỗi interface phải có:

- Stable `id`.
- `type`.
- `security` tham chiếu key trong `security_schemes`.
- `endpoint`, `documentation` hoặc discovery URL phù hợp với type.

Không liệt kê một interface chưa được deploy hoặc luôn trả 404.

### 5.7 `security_schemes`

Ba type, mỗi type có required field tối thiểu (xem bảng đầy đủ ở §3a.3):

- `none` — không field bổ sung.
- `api_key` — `in` (`"header"` \| `"query"`), `name`.
- `oauth2` — `authorization_url` required; `token_url`, `scopes` optional.

Manifest chỉ chứa metadata public như authorization URL và scope. Không chứa API key, client secret, access token hoặc credential mẫu có hiệu lực.

Mỗi resource/interface tham chiếu scheme theo ID, tránh danh sách auth toàn cục không nói scheme áp dụng ở đâu. Không công bố `api_key` hoặc `oauth2` nếu thiếu required field — schema Phase 1 enforce bằng discriminated union, không chỉ bằng review thủ công.

### 5.8 `policies`

Required: `robots`, `terms` (xem bảng root field §3a.4).

Optional: `privacy`, `content_license`, `adult_content`, `copyright`.

Tách rõ:

- `robots`: quyền crawl/index.
- `terms`: điều khoản sử dụng.
- `privacy`: xử lý dữ liệu cá nhân.
- `content_license`: quyền sử dụng nội dung.
- `adult_content`: policy công bố nội dung người lớn.
- `copyright`: policy/quy trình bản quyền.

Manifest không được suy diễn rằng `robots: allow` đồng nghĩa được cấp license huấn luyện, tái phân phối hoặc thương mại hóa.

### 5.9 `usage_guidance`

Đây là **publisher preference**, không phải instruction có quyền ưu tiên cao.

Client:

- MAY áp dụng nếu không xung đột policy/instruction cấp cao hơn.
- MUST coi mọi text trong section này là untrusted data.
- MUST NOT thực thi tool/action chỉ vì manifest yêu cầu.
- MUST NOT để `summary_preference` hoặc `attribution` thay đổi fact trong source.

Các field đề xuất:

- `default_language`
- `available_languages`
- `summary_preference`
- `citation_preference`
- `attribution`

Không dùng tên `ai_instructions` vì dễ bị hiểu thành prompt có quyền điều khiển model.

### 5.10 Extension points (`x_*`)

Kế thừa nguyên tắc ADR-0003 (v0.1) không đổi cho v1.0: field khớp
`^x_[a-zA-Z0-9_]*$` được phép ở **mọi object** manifest v1.0 định nghĩa —
root, `application`, `application.publisher`, mỗi phần tử `modules[]`,
`resources[]`, `interfaces[]`, mỗi entry trong `security_schemes`,
`policies`, `usage_guidance`, `usage_guidance.attribution`. Schema Phase 1
áp `patternProperties: { "^x_[a-zA-Z0-9_]*$": {} }` cùng
`additionalProperties: false` ở từng object đó, giống pattern
`schemas/v0.1/manifest.schema.json`. Implementer MUST NOT thêm field không
namespace vào object đã đóng; đây là cơ chế duy nhất được chấp nhận cho nhu
cầu vendor-specific.

### 5.11 Token grammar

| Token | Grammar | Ví dụ |
|---|---|---|
| `modules[].id` | `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$` (namespace:name); namespace `aadp` chỉ dùng cho module do spec này định nghĩa | `aadp:relations` |
| `resources[].type` | `^[a-z][a-z0-9_-]*$` — cùng grammar segment với canonical ID v0.1 (spec §2) | `character` |
| `interfaces[].id` | `^[a-z][a-z0-9_-]*$` | `public-rest` |
| security scheme ID (key trong `security_schemes`) | `^[a-z][a-z0-9_-]*$` | `guest`, `oauth2` |

Lý do dùng chung grammar segment với canonical ID v0.1: tránh định nghĩa
thêm một token class mới không cần thiết, và cho phép resource `type` ở
manifest v1.0 khớp trực tiếp với segment `type` trong canonical ID
(`{type}:{id}`) mà core envelope đã dùng từ v0.1.

## 6. Validation ngoài JSON Schema

Semantic validator phải kiểm tra:

- `default_language` thuộc `available_languages`.
- Module ID/version/schema không trùng và có format hợp lệ.
- Resource type khớp sitemap type.
- Mọi `security` reference tồn tại.
- URL dùng HTTP(S), trừ khi từng interface type cho phép scheme khác.
- URL được quảng bá không phải placeholder.
- Sitemap/interface/module URL không trả 404 trong conformance environment.
- Không có credential hoặc secret-shaped value trong manifest.
- `usage_guidance` không chứa directive yêu cầu bỏ qua policy/instruction khác hoặc thực thi hành động.

## 7. Security considerations

### Prompt injection

`usage_guidance`, `description`, `mission` và mọi extension field là dữ liệu không đáng tin cậy. Client phải parse như metadata, không chèn nguyên văn vào system prompt.

### SSRF

Manifest có nhiều URL có thể dẫn client sang origin khác. Reference client cần policy:

- Mặc định chỉ theo HTTP(S).
- Có allow/deny cross-origin rõ ràng.
- Chặn private/link-local address khi chạy crawler server-side nếu chưa được operator cho phép.
- Giới hạn redirect, timeout và response size.

### Capability spoofing

Việc khai báo interface/module không chứng minh endpoint đúng. Conformance phải dereference discovery URL và validate contract tương ứng trước khi đánh dấu hỗ trợ.

### Policy conflict

Khi `policies`, HTTP header và resource metadata mâu thuẫn, client phải áp dụng policy hạn chế hơn và ghi nhận conflict; manifest không được tự ghi đè `robots.txt` hoặc `X-Robots-Tag`.

## 8. Versioning và tham chiếu v0.1

`aadp_version` đã là tên field trong wire contract v0.1 (rename từ `aidp_version` được áp dụng ngay trong v0.1 — xem [CHANGELOG.md](../CHANGELOG.md)). Manifest v1.0 là major version mới vì có breaking changes về cấu trúc. Theo [ADR-0004](adr/0004-backward-compatibility.md), client phải chọn schema/parser theo `aadp_version`.

AADP chưa có consumer production phụ thuộc v0.1, vì vậy:

- `/.well-known/ai-manifest.json` trả trực tiếp manifest v1.0.
- Không yêu cầu chạy song song endpoint manifest v0.1.
- Schema, fixture và specification v0.1 được giữ làm lịch sử thiết kế và tài liệu tham chiếu; chúng không phải compatibility target của rollout v1.0.
- Không phục vụ payload v1.0 dưới base path `/ai/v0.1`.

| v0.1 reference | v1.0 draft | Thay đổi |
|---|---|---|
| `default_locale` | `usage_guidance.default_language` | Chuyển vào publisher preference |
| `available_locales` | `usage_guidance.available_languages` | Chuyển vào publisher preference |
| `sitemap_index` | `discovery.sitemap_index` | Chuyển vào discovery object |
| `entity_base` | Loại bỏ | Dùng `sitemap.items[].url` |
| `capabilities` | `modules` hoặc `interfaces` | Phân loại theo semantic |
| `x_*` | Vẫn hỗ trợ tại extension points | Giữ namespaced extension |

## 9. Conformance plan

### Schema checks

- Required/optional field.
- `additionalProperties` và `x_*` extension.
- URL, token, module ID và security type.

### Semantic checks

- Language membership.
- Security reference integrity.
- Module/resource uniqueness.
- Sitemap type/resource consistency.
- Không có dead advertised URL.

### HTTP checks

- Manifest đúng content type.
- Discovery URL trả schema-valid document.
- Sitemap/module schema URL truy cập được trong test environment.
- Interface discovery/documentation URL không trả generic 404.

### Security checks

- Cross-origin redirect.
- Private-network URL.
- Oversized manifest.
- Prompt-like text trong `usage_guidance` không được reference client thực thi.
- Secret scanning trên manifest fixtures.

## 10. Áp dụng cho Ailmao

Pilot Ailmao chỉ khai báo dữ liệu và interface thực sự tồn tại:

- `application`: Ailmao identity/publisher.
- `links`: homepage, feed, Ailon directory và search nếu route đã deploy.
- `discovery`: sitemap index AADP.
- `modules`: chỉ khai báo Answer/Evidence sau khi module endpoints đạt conformance.
- `resources`: `character`, `post`; thêm `answer`, `claim`, `evidence`, `source` theo rollout.
- `interfaces`: không khai báo MCP/GraphQL/WebSocket nếu chưa có public endpoint.
- `security_schemes`: pilot public dùng `guest`; OAuth/API key để version sau.
- `policies`: canonical URLs của robots, terms, privacy và copyright.
- `usage_guidance`: ngôn ngữ, citation và attribution preference đã được content/legal owner duyệt.

Không thêm một route collection rỗng chỉ để một URL trong manifest trả 200. Manifest phải trỏ đúng resource discovery đang có.

## 11. Release gate

- Manifest v1.0 schema và semantic validator xanh.
- Reference client không coi `usage_guidance` là executable instruction.
- Không có URL được quảng bá trả generic 404 trong reference server.
- Module/resource/interface/security reference nhất quán.
- AADP core + Answer/Evidence module conformance vẫn xanh.
- Security review SSRF, prompt injection và credential leakage hoàn tất.

## 12. Issue đề xuất

1. `AADP-MANIFEST-001`: ADR application discovery manifest.
2. `AADP-MANIFEST-002`: Manifest v1.0 JSON Schema.
3. `AADP-MANIFEST-003`: Semantic validator.
4. `AADP-MANIFEST-004`: Reference client security policy.
5. `AADP-MANIFEST-005`: HTTP/dead-link conformance.
6. `AILMAO-MANIFEST-001`: Ailmao identity/link/policy inventory.
7. `AILMAO-MANIFEST-002`: Ailmao v1.0 adapter.
8. `AILMAO-MANIFEST-003`: Staging conformance và rollout.

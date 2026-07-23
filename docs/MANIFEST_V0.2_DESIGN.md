# Thiết kế AADP Manifest v0.2

> Trạng thái: Design Draft. Tài liệu này chưa thay thế manifest v0.1 đang được pilot sử dụng.

## 1. Mục tiêu

Manifest v0.2 là **application discovery document** giúp AI client trả lời các câu hỏi sau trước khi đọc dữ liệu:

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

## 4. Manifest đề xuất

```json
{
  "aadp_version": "0.2",
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
    "sitemap_index": "https://example.com/ai/v0.2/sitemap-index.json"
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
      "sitemap": "https://example.com/ai/v0.2/sitemaps/character.json",
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

- `sitemap_index` là entry point authoritative cho AADP enumeration.
- Không quảng bá base URL luôn trả 404.
- Entity URL authoritative nằm trong `sitemap.items[].url`.
- Nếu tương lai cần dựng URL, dùng URI Template được chuẩn hóa, không dùng một `entity_base` mơ hồ.

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

Các type ban đầu:

- `none`
- `api_key`
- `oauth2`

Manifest chỉ chứa metadata public như authorization URL và scope. Không chứa API key, client secret, access token hoặc credential mẫu có hiệu lực.

Mỗi resource/interface tham chiếu scheme theo ID, tránh danh sách auth toàn cục không nói scheme áp dụng ở đâu.

### 5.8 `policies`

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

## 8. Compatibility và migration từ v0.1

| v0.1 | v0.2 draft | Migration |
|---|---|---|
| `aidp_version` | `aadp_version` | Rename field theo tên protocol mới (AADP); v0.1 giữ nguyên `aidp_version` |
| `default_locale` | `usage_guidance.default_language` | Copy và validate membership |
| `available_locales` | `usage_guidance.available_languages` | Copy array |
| `sitemap_index` | `discovery.sitemap_index` | Chuyển vào discovery object |
| `entity_base` | Loại bỏ | Dùng `sitemap.items[].url` |
| `capabilities` | `modules` hoặc `interfaces` | Mapping theo semantic, không copy token mù |
| `x_*` | Vẫn hỗ trợ tại extension points | Giữ namespaced extension |

Migration phải additive ở giai đoạn transition:

1. AADP v0.1 endpoint tiếp tục trả manifest v0.1.
2. AADP v0.2 có base path/manifest version riêng theo quyết định versioning.
3. Client đọc version field trước khi parse (`aidp_version` với v0.1, `aadp_version` với v0.2).
4. Không trả payload v0.2 dưới URL tuyên bố v0.1.

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

- Manifest v0.2 schema và semantic validator xanh.
- Reference client không coi `usage_guidance` là executable instruction.
- Không có URL được quảng bá trả generic 404 trong reference server.
- Module/resource/interface/security reference nhất quán.
- Migration v0.1 → v0.2 có fixtures và tests.
- AADP core + Answer/Evidence module conformance vẫn xanh.
- Security review SSRF, prompt injection và credential leakage hoàn tất.

## 12. Issue đề xuất

1. `AADP-MANIFEST-001`: ADR application discovery manifest.
2. `AADP-MANIFEST-002`: Manifest v0.2 JSON Schema.
3. `AADP-MANIFEST-003`: Semantic validator.
4. `AADP-MANIFEST-004`: Reference client security policy.
5. `AADP-MANIFEST-005`: HTTP/dead-link conformance.
6. `AADP-MANIFEST-006`: v0.1 → v0.2 migration fixtures.
7. `AILMAO-MANIFEST-001`: Ailmao identity/link/policy inventory.
8. `AILMAO-MANIFEST-002`: Ailmao v0.2 adapter.
9. `AILMAO-MANIFEST-003`: Staging conformance và rollout.

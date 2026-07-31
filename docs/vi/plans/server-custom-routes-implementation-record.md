# Hồ sơ triển khai custom route cho AADP Server SDK

> Ngôn ngữ: Tiếng Việt.
>
> Trạng thái: Implemented trong `ail-aadp@1.0.7`.
>
> Phạm vi: `ail-aadp/server`, tài liệu SDK, regression test và release patch.
>
> Finding lịch sử: Server SDK được thêm từ `1.0.5` và còn limitation ở
> `1.0.6`: URL generator và route matcher cùng hardcode `/ai/v1.0`.

## Trạng thái triển khai

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Route config và compiler | Đã triển khai | `src/server/routes.ts`, `src/server/types.ts` |
| Runtime integration | Đã triển khai | `src/server/runtime.ts` |
| Route unit/regression tests | Đã triển khai | `tests/server/routes.test.ts`, `tests/server/runtime.test.ts` |
| Public documentation và release | Đã triển khai | `README.md`, `CHANGELOG.md`, package `1.0.7` |

Phần “đề xuất”, phase và test matrix bên dưới được giữ làm implementation record
và regression baseline. Các câu ở thì tương lai mô tả yêu cầu ban đầu, không
phản ánh hạng mục còn mở.

## 1. Bối cảnh

AADP v1.0 chỉ cố định discovery manifest tại:

```text
/.well-known/ai-manifest.json
```

Các URL sau không phải endpoint cố định của wire contract:

- `manifest.discovery.sitemap_index`.
- `sitemap-index.sitemaps[].url`.
- `sitemap.items[].url`.

Các URL được công bố trong document mới là nguồn authoritative mà client phải
follow. `/ai/v1.0/...` là convention và default hợp lý, nhưng không phải routing
contract bắt buộc đối với mọi server.

Trước bản `1.0.7`, Server SDK chưa phản ánh đúng semantics này. Trong
`src/server/runtime.ts`, một `basePath` hardcode đang đồng thời điều khiển:

1. URL sitemap index được ghi vào manifest.
2. URL sitemap được ghi vào sitemap index.
3. URL entity được ghi vào sitemap.
4. Path matcher của `handleRequest()`.

Vì vậy adapter muốn publish AADP document tại custom route phải tự viết lại
runtime hoặc giữ route convention của SDK, dù wire contract cho phép URL khác.
Đây là limitation của package `aadp`, không phải lỗi riêng của adapter landing.

## 2. Mục tiêu

1. Cho phép application cấu hình route của sitemap index, sitemap và entity.
2. Dùng cùng một cấu hình làm nguồn duy nhất cho URL generation và request
   matching.
3. Giữ nguyên well-known manifest route.
4. Giữ backward compatibility tuyệt đối khi consumer không cấu hình custom
   route.
5. Fail fast tại `defineAADP()` nếu route template không hợp lệ hoặc mơ hồ.
6. Không làm thay đổi cache, checksum, cursor, error envelope, security metadata
   hoặc resource lifecycle.
7. Giữ HTTP boundary mỏng; logic route tái sử dụng nằm trong module riêng và có
   unit test độc lập.

## 3. Ngoài phạm vi

- Không đổi AADP v1.0 JSON Schema.
- Không thêm protocol version mới.
- Không đổi client discovery hoặc URL policy.
- Không cho phép đổi `/.well-known/ai-manifest.json`.
- Không thêm rewrite/proxy framework-specific cho Next.js, Express hoặc nền
  tảng khác.
- Không hỗ trợ cross-origin route do `handleRequest()` của một server instance
  không thể phục vụ origin khác.
- Không đổi auth, quota, pagination hoặc cache semantics hiện tại.
- Không sửa adapter landing trong cùng patch của package. Adapter chỉ migrate
  sau khi package mới được phát hành.

## 4. Public API đề xuất

Thêm cấu hình optional vào `AadpServerConfig`:

```ts
export interface AadpRouteConfig {
  /**
   * Static pathname for the sitemap index.
   * Default: `/ai/v{version}/sitemap-index.json`.
   */
  sitemapIndex?: string;

  /**
   * Sitemap pathname template. Must contain exactly one `{type}` token.
   * Default: `/ai/v{version}/sitemaps/{type}.json`.
   */
  sitemap?: string;

  /**
   * Entity pathname template. Must contain exactly one `{type}` token
   * and one `{id}` token.
   * Default: `/ai/v{version}/entities/{type}/{id}.json`.
   */
  entity?: string;
}

export interface AadpServerConfig {
  // Existing fields remain unchanged.
  routes?: AadpRouteConfig;
}
```

Ví dụ:

```ts
const aadp = defineAADP({
  baseUrl: "https://example.com",
  routes: {
    sitemapIndex: "/discovery/aadp-index.json",
    sitemap: "/discovery/aadp/{type}",
    entity: "/public/aadp/{type}/{id}",
  },
  application,
  policies,
  resources,
});
```

Kết quả phải nhất quán:

```text
manifest.discovery.sitemap_index
  -> https://example.com/discovery/aadp-index.json

sitemap-index.sitemaps[post].url
  -> https://example.com/discovery/aadp/post

sitemap.items[post:welcome].url
  -> https://example.com/public/aadp/post/welcome
```

`handleRequest()` phải match đúng ba pathname trên. Route mặc định hiện tại
được giữ nguyên nếu `routes` hoặc từng field con bị omit.

### 4.1 Vì sao dùng template thay vì callback

Không dùng API dạng:

```ts
entityUrl: (type, id) => string
```

Callback có thể sinh URL nhưng không cung cấp phép đảo đáng tin cậy để
`handleRequest()` khôi phục `type` và `id`. Route template hữu hạn cho phép
compile một lần thành cả URL builder và matcher, tránh hai implementation bị
lệch nhau.

### 4.2 Pathname thay vì absolute URL

Config chỉ nhận origin-relative pathname bắt đầu bằng `/`. Absolute URL, query
và fragment bị từ chối. URL public tuyệt đối được tạo bằng `baseUrl` đã validate
cộng pathname đã build.

Quyết định này bảo đảm URL được công bố là URL mà chính `handleRequest()` có thể
phục vụ. Cross-origin publication cần một server/runtime khác và nằm ngoài phạm
vi API này.

## 5. Kiến trúc triển khai

### 5.1 Module route riêng

Tạo:

```text
src/server/routes.ts
```

Module này sở hữu ba trách nhiệm liên quan trực tiếp:

1. Validate và normalize route config.
2. Build pathname/absolute URL từ parameter.
3. Match inbound pathname thành typed route.

API nội bộ dự kiến:

```ts
interface AadpRouteResolver {
  readonly paths: {
    sitemapIndex: string;
  };

  sitemapPath(type: string): string;
  entityPath(type: string, id: string): string;
  sitemapIndexUrl(baseUrl: string): string;
  sitemapUrl(baseUrl: string, type: string): string;
  entityUrl(baseUrl: string, type: string, id: string): string;
  match(pathname: string): AadpRouteMatch | null;
}

type AadpRouteMatch =
  | { kind: "sitemap-index" }
  | { kind: "sitemap"; type: string }
  | { kind: "entity"; type: string; id: string };

function compileAadpRoutes(
  version: "1.0",
  config?: AadpRouteConfig
): AadpRouteResolver;
```

Tên và visibility cuối cùng có thể điều chỉnh theo convention TypeScript hiện
có, nhưng boundary phải được giữ: `runtime.ts` không tự nối prefix và không tự
parse cấu trúc route.

### 5.2 Runtime integration

Trong `defineAADP()`:

1. Validate `baseUrl` và version như hiện tại.
2. Compile route resolver đúng một lần.
3. Dùng resolver để tạo:
   - `manifest.discovery.sitemap_index`.
   - `sitemap-index.sitemaps[].url`.
   - `sitemap.items[].url`.
4. Dùng `resolver.match(url.pathname)` trong `handleRequest()`.
5. Dispatch typed match tới `sitemapIndex()`, `sitemap()` hoặc `entity()`.

Well-known manifest được kiểm tra riêng trước custom resolver và không nằm trong
`AadpRouteConfig`.

### 5.3 Layer boundary

```text
Inbound Request
      |
      v
handleRequest()                 HTTP boundary, method/CORS/response mapping
      |
      v
AadpRouteResolver              validate, build và match route
      |
      v
sitemapIndex/sitemap/entity    document/business operation hiện có
      |
      v
Resource list/get/serialize    application data boundary hiện có
```

Không tạo service abstraction mới cho checksum, cursor hoặc document builder vì
finding này không yêu cầu thay đổi các phần đó.

## 6. Quy tắc validation

Mọi lỗi config phải throw đồng bộ trong `defineAADP()`, trước khi server nhận
request đầu tiên.

### 6.1 Quy tắc chung

- Path phải là string không rỗng và bắt đầu bằng đúng một `/`.
- Path không được chứa scheme, authority, query hoặc fragment.
- Path không được chứa backslash hoặc control character.
- Không chấp nhận empty segment do `//`.
- Không chấp nhận dot segment `.` hoặc `..`, kể cả dạng percent-encoded sau khi
  decode.
- Chỉ `{type}` và `{id}` là placeholder hợp lệ.
- Literal `{` hoặc `}` không hợp lệ nếu không tạo thành placeholder được hỗ trợ.
- Route không được trùng well-known manifest pathname.

### 6.2 Quy tắc theo route

| Route | Placeholder bắt buộc | Placeholder bị cấm |
|---|---|---|
| `sitemapIndex` | Không có | `{type}`, `{id}` |
| `sitemap` | Chính xác một `{type}` | `{id}` |
| `entity` | Chính xác một `{type}` và một `{id}` | Không có |

Placeholder phải chiếm trọn một path segment. Không hỗ trợ các dạng:

```text
/sitemaps/{type}.json
/entities/{type}/{id}.json
```

nếu matcher được triển khai theo segment thuần. Tuy nhiên default route hiện tại
có suffix `.json`, nên implementation phải chọn một trong hai cách sau:

1. Compiler hỗ trợ placeholder có literal prefix/suffix trong cùng segment; hoặc
2. Public template dùng token segment riêng và giữ default dưới dạng compiled
   legacy pattern đặc biệt.

Kế hoạch chốt phương án 1 để default và custom route đi qua cùng một compiler,
không tạo nhánh matcher legacy riêng.

### 6.3 Encoding

- Khi build URL, `type` và `id` được encode bằng `encodeURIComponent`.
- Khi match, placeholder được decode bằng helper an toàn hiện có.
- Malformed percent encoding trả AADP `invalid_request`.
- Giá trị sau decode tiếp tục đi qua validation nghiệp vụ hiện có:
  - Unknown `type` trả `unsupported_type`.
  - `id` sai canonical grammar trả `invalid_request`.
- Slash encoded trong placeholder không được biến thành segment mới; validation
  canonical ID hiện tại phải từ chối giá trị không hợp lệ sau decode.

### 6.4 Collision

Compiler phải từ chối ít nhất:

- `sitemapIndex` trùng manifest path.
- `sitemapIndex` match được bởi sitemap hoặc entity template.
- Sitemap và entity template có cùng shape và có thể match cùng pathname.
- Hai placeholder liền nhau hoặc pattern không thể phân tách xác định.

Collision detection chỉ cần áp dụng cho ba route của một `AadpServer`; không cần
biết route khác của application/framework.

## 7. Kế hoạch thay đổi theo file

### Phase 1 — Route types và compiler

Files:

```text
src/server/types.ts
src/server/routes.ts
tests/server/routes.test.ts
```

Tasks:

1. Thêm `AadpRouteConfig` và `routes?: AadpRouteConfig`.
2. Export type qua `ail-aadp/server`.
3. Implement default templates theo version.
4. Implement tokenizer/compiler cho literal và placeholder.
5. Implement builder, matcher và collision validation.
6. Unit test compiler độc lập với document runtime.

### Phase 2 — Runtime integration

Files:

```text
src/server/runtime.ts
tests/server/runtime.test.ts
```

Tasks:

1. Xóa việc runtime tự tạo `basePath`, prefix sitemap và prefix entity.
2. Compile resolver một lần trong `defineAADP()`.
3. Dùng resolver cho mọi published URL.
4. Dùng typed matcher trong `handleRequest()`.
5. Giữ manifest well-known branch cố định.
6. Giữ nguyên response builder, error mapping và resource calls.

### Phase 3 — Regression và compatibility

Files:

```text
tests/server/runtime.test.ts
tests/package/*
```

Tasks:

1. Chứng minh default behavior byte-for-byte tương thích về pathname công bố.
2. Chứng minh custom path được công bố và serve nhất quán.
3. Build package và kiểm tra type declaration có `AadpRouteConfig`.
4. Nếu package test hiện có kiểm tra tarball, bổ sung smoke test import type/API
   khi cần; không tạo test đóng gói trùng lặp nếu test hiện tại đã bao phủ.

### Phase 4 — Documentation và release

Files:

```text
README.md
docs/guides/implementation-guide-v1.0.md
docs/vi/*
CHANGELOG.md
ERROR_LOG.md
package.json
package-lock.json
```

Tasks:

1. Ghi rõ well-known manifest là route cố định.
2. Ghi rõ `/ai/v1.0/...` là default convention.
3. Thêm ví dụ cấu hình custom route.
4. Thêm entry `ERROR_LOG.md` gồm ngày, nơi xảy ra, triệu chứng, root cause, fix
   và link file:line thực tế sau khi code hoàn tất.
5. Thêm changelog cho patch release dự kiến `1.0.7`.
6. Chỉ bump version khi patch đã qua toàn bộ release gate.

## 8. Test matrix

### 8.1 Backward compatibility

- Không truyền `routes`: mọi URL vẫn là `/ai/v1.0/...`.
- Chỉ override một field: các field còn lại dùng default độc lập.
- Manifest vẫn chỉ serve ở `/.well-known/ai-manifest.json`.
- Direct API `manifest()`, `sitemapIndex()`, `sitemap()` và `entity()` không đổi
  signature hoặc document shape.

### 8.2 URL publication

- Manifest chứa đúng custom sitemap index URL.
- Sitemap index chứa đúng custom sitemap URL cho từng resource type.
- Sitemap chứa đúng custom entity URL cho từng item.
- Placeholder được encode đúng khi build.
- `baseUrl` có trailing slash vẫn normalize đúng như trước.

### 8.3 Request routing

- Custom sitemap index route trả document và cache header đúng.
- Custom sitemap route đọc `cursor` từ query như trước.
- Custom entity route truyền đúng decoded `type` và `id`.
- Route default cũ trả `404` khi field tương ứng đã được override.
- Unrouted path và non-GET giữ error semantics hiện tại.
- `OPTIONS` giữ CORS/preflight behavior hiện tại.

### 8.4 Invalid configuration

- Relative path.
- Absolute URL.
- Query hoặc fragment.
- Thiếu placeholder.
- Placeholder lặp.
- Placeholder không hỗ trợ.
- Template mơ hồ.
- Collision giữa các AADP route.
- Collision với well-known manifest.
- Dot segment, backslash, control character và malformed escape.

### 8.5 Không regression

- ETag mạnh/yếu và conditional GET.
- `Last-Modified`.
- Public/private `Cache-Control`.
- Error envelope.
- Security-scheme CORS header.
- Cursor binding theo resource type/version.
- Schema và semantic validation của generated documents.

## 9. Verification và release gate

Chạy từ root package:

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Nếu repository CI có clean-install/tarball test, phải chạy test đó trong
`npm test`; không phát hành chỉ dựa trên unit test của source tree.

Release chỉ được thông qua khi:

1. Toàn bộ test cũ pass mà không nới assertion.
2. Custom route test pass cho cả URL generation và inbound matching.
3. TypeScript build pass.
4. Tarball chứa declaration và runtime mới.
5. Tài liệu không mô tả `/ai/v1.0/...` như route bắt buộc.
6. `ERROR_LOG.md` và changelog đã có link/version chính xác.

## 10. Tiêu chí nghiệm thu

Ví dụ sau phải hoạt động mà adapter không tự build AADP document:

```ts
const aadp = defineAADP({
  baseUrl: "https://example.com",
  routes: {
    sitemapIndex: "/aadp/index",
    sitemap: "/aadp/maps/{type}",
    entity: "/aadp/resources/{type}/{id}",
  },
  application,
  policies,
  resources: [posts],
});
```

Các assertion bắt buộc:

```text
GET /.well-known/ai-manifest.json
  -> discovery.sitemap_index = https://example.com/aadp/index

GET /aadp/index
  -> sitemaps[post].url = https://example.com/aadp/maps/post

GET /aadp/maps/post
  -> items[0].url = https://example.com/aadp/resources/post/<id>

GET /aadp/resources/post/<id>
  -> entity document hợp lệ
```

Đồng thời, một consumer không truyền `routes` phải tiếp tục hoạt động mà không
cần thay code hoặc route wiring.

## 11. Rủi ro và cách kiểm soát

### Matcher và URL builder lệch nhau

Kiểm soát bằng một compiler duy nhất tạo cả hai từ cùng tokenized template.
Không duy trì regex matcher và string builder ở hai module riêng.

### Collision hoặc route quá rộng

Validate tại definition time và có test matrix cho shape collision. Không đợi
đến request time mới chọn route theo thứ tự `if`.

### Double encoding

Builder chỉ nhận raw `type`/`id` từ domain boundary và encode đúng một lần.
Matcher decode đúng một lần trước validation nghiệp vụ.

### Breaking change ngoài ý muốn

Default route phải được biểu diễn bằng chính public template compiler. Regression
test khóa URL cũ và handler path cũ.

### Scope creep sang framework adapter

SDK chỉ quản lý pathname và Fetch `Request`/`Response`. Việc framework wire file
route nào tới `handleRequest()` vẫn thuộc adapter/application.

## 12. Thứ tự commit đề xuất

1. `feat(server): add validated AADP route templates`
2. `refactor(server): use route resolver for URLs and request matching`
3. `test(server): cover custom routes and legacy defaults`
4. `docs(server): document authoritative custom routes`
5. `chore(release): prepare 1.0.7`

Mỗi commit phải giữ build/test pass nếu có thể. Version bump chỉ nằm ở commit
release cuối để implementation có thể review độc lập với release metadata.

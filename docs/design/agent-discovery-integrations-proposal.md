# Đề xuất tích hợp các cơ chế agent discovery liền kề AADP

## Metadata tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Proposed |
| Đối tượng | Maintainer AADP, implementer và reviewer tích hợp discovery |
| Phạm vi | Các chuẩn/cơ chế agent discovery nằm cạnh AADP nhưng không mặc định thuộc AADP core |
| Tính chuẩn tắc | Informational; chưa thay đổi specification hoặc JSON Schema đã phát hành |
| Nguồn phát hiện | Tích hợp `ailmao-landing` với external agent-readiness scanner |

## Tóm tắt

Khi kết nối `ailmao-landing`, implementation tham chiếu của AADP, với một external
agent-readiness scanner, project phải xử lý nhiều cơ chế chưa thuộc AADP v1.0:
RFC 8288 Link header, `Accept: text/markdown`, RFC 9727 API Catalog, DNS-AID SVCB,
WebMCP, MCP Server Card, OAuth/OIDC discovery và `auth.md`.

Một số phần lặp lại giữa mọi AADP publisher và nên được đưa vào `ail-aadp`; các
phần khác giải quyết vấn đề khác và phải tiếp tục nằm ngoài core. Memo này ghi rõ
ranh giới đó, đồng thời dẫn tới các proposal chuyên sâu khi một mục cần thiết kế
wire contract hoặc semantics mới.

## 1. Trạng thái của memo

Memo này tuân theo [quy ước tài liệu AADP](../document-conventions.md). Các ví dụ,
tên API helper và field được nêu đều là non-normative ở trạng thái Proposed.

Memo MUST NOT được dùng để tuyên bố một capability đã thuộc AADP hoặc đã được cấp
version chỉ vì capability đó xuất hiện trong tài liệu. Mọi thay đổi wire contract
phải đi qua ADR, specification và schema theo chính sách tương thích.

## 2. Phạm vi và non-goals

Memo này:

- phân loại integration nào có thể tái sử dụng trong package;
- ghi lại integration nào thuộc application, browser hoặc infrastructure;
- tránh việc publisher tạo discovery metadata giả chỉ để tăng scanner score;
- cung cấp đầu vào cho ADR/proposal chuyên sâu.

Memo này không:

- biến AADP thành OpenAPI, OAuth/OIDC server hoặc MCP runtime;
- yêu cầu publisher hỗ trợ mọi chuẩn mà scanner biết;
- thay đổi schema v1.0 đã phát hành;
- coi scanner score là protocol conformance.

## 3. Các phần nên đưa vào `ail-aadp`

### 3.1 Helper tạo `Link` header

`ailmao-landing/middleware.ts` hiện phải tự khai báo:

```text
</.well-known/ai-manifest.json>; rel="api-catalog"
```

Mọi AADP publisher cần cùng giá trị và well-known path đã có thể suy ra từ config
được truyền vào `defineAADP()`. Package SHOULD cung cấp helper như
`aadp.linkHeader()` hoặc export constant well-known path từ `ail-aadp/server` để
publisher không phải lặp chuỗi và tránh typo.

Tên helper cuối cùng cần được chốt theo public API convention của package.

### 3.2 Sinh RFC 9727 API Catalog

`ailmao-landing` đang tự phục vụ `/.well-known/api-catalog` với media type
`application/linkset+json`. Catalog hiện chỉ có một entry trung thực:
`service-desc` trỏ đến AADP manifest. Các field `links`, `policies` và `resources`
trong `defineAADP()` chưa map trực tiếp, đầy đủ sang `service-doc` hoặc `status`.

Package có thể:

1. sinh entry `service-desc` cho AADP manifest;
2. chỉ sinh `status` khi publisher cấu hình một health endpoint thật;
3. cung cấp helper như `aadp.buildApiCatalogLinkset()` thay vì bắt mỗi application
   viết lại cùng Linkset shape.

Một field tùy chọn như `healthCheck` chỉ nên được thêm sau khi xác định đúng layer
và compatibility impact; publisher MUST NOT quảng cáo endpoint chưa deploy.

### 3.3 Markdown rendering cho AADP resource

`ailmao-landing/lib/markdown/homepage.ts` được viết riêng để đáp ứng
`Accept: text/markdown`, nhưng nó đọc từ cùng data source đang cấp dữ liệu cho
`characterResource` và `postResource`.

AADP resource đã có bước `serialize()`. Package có thể khảo sát hai hướng:

- callback `markdown: (record) => string` trong `defineResource()`;
- generic JSON-to-Markdown renderer chạy trên serialized shape.

Hướng callback cho publisher kiểm soát nội dung nhưng mở rộng public server API;
hướng generic giảm code nhưng khó đảm bảo semantic và presentation ổn định. Cần
design memo riêng trước khi chọn một trong hai.

### 3.4 Manifest checksum được DNSSEC xác thực qua DNS-AID

ADR-0001 dùng checksum `sha256:<hex>` trên canonical JSON như tín hiệu phát hiện
tampering. Tuy nhiên checksum tự công bố cùng payload không xác thực được nguồn:
một bên sửa payload cũng có thể tính và công bố checksum mới.

AADP không có signing/key/JWS contract riêng và SHOULD ưu tiên một cơ chế đã được
công bố thay vì tự phát minh PKI. DNS-AID draft có SvcParamKey `cap-sha256` cho
base64url-encoded SHA-256 digest. Khi digest của manifest được đặt trong SVCB record
dưới DNSSEC, resolver có DNSSEC validation có thể nhận assertion từ domain owner về
checksum kỳ vọng.

Package có thể khảo sát helper như `aadp.dnsAidCapChecksum()` để chuyển checksum
manifest sang đúng base64url representation. Việc phát hành SVCB record vẫn thuộc
DNS/infrastructure, không thuộc JS runtime.

Do `cap-sha256` chưa được IANA đăng ký, Cloudflare có thể chỉ chấp nhận private-use
numeric key như `key65281`. Giá trị này chỉ là ví dụ vận hành tạm thời, không phải
allocation của AADP.

## 4. Các phần phải tiếp tục nằm ngoài AADP core

### 4.1 DNS-AID SVCB record

Record `_index._agents.<domain>` thuộc registrar/DNS provider. Package có thể tạo
giá trị/digest hỗ trợ, nhưng không nên tự mutate DNS hoặc sở hữu DNS lifecycle.

Với `ailmao.com`, Cloudflare dashboard không chấp nhận unregistered SvcParamKey name
và cần numeric `keyNNNNN` theo private-use range cho đến khi draft ổn định. Đây là
runbook infrastructure, không phải AADP wire behavior.

### 4.2 WebMCP

`document.modelContext.registerTool()` và legacy
`navigator.modelContext.provideContext()` expose hành động UI cho in-browser agent.
Đây là browser interaction API, khác với server-side resource discovery của AADP.

WebMCP implementation nên ở application component tương ứng, ví dụ
`ailmao-landing/components/WebMcpTools.tsx`, không nằm trong AADP core.

### 4.3 OAuth/OIDC discovery, OAuth Protected Resource Metadata và `auth.md`

Các discovery document này chỉ áp dụng khi tồn tại authorization server, protected
resource hoặc agent registration flow thật. AADP v1.0 đã mô tả được security scheme
`none`, `api_key` và `oauth2`; vì vậy khoảng trống không phải là “AADP chưa biết
protected resource”. Khoảng trống thực tế là:

- application-level profile để tuyên bố đây là content site;
- default access và resource/interface override;
- semantics rõ ràng để scanner phân biệt `not_applicable` với `missing`;
- runtime phải giữ public cache semantics khi scheme được tham chiếu có
  `type: "none"`.

Thiết kế chi tiết nằm trong
[Đề xuất khai báo Content Site và truy cập công khai](../vi/design/content-site-access-discovery-proposal.md).

`ailmao-api-v2` hiện dùng custom JWT từ `POST /auth/login`, không có đầy đủ
`authorization_endpoint`, `token_endpoint`, `jwks_uri` hoặc agent registration
contract. Publisher MUST NOT tạo OAuth/OIDC metadata trỏ đến endpoint không tồn tại
chỉ để vượt scanner.

### 4.4 MCP Server Card

MCP Server Card chỉ phù hợp khi có MCP server và transport endpoint thật. WebMCP
không phải remote MCP server. Card mô tả một server chưa tồn tại là fabrication,
không phải discovery.

Mục này nên được xem lại khi organization triển khai MCP server thực tế.

### 4.5 Agent Skills index

`/.well-known/agent-skills/index.json` đã được triển khai theo hướng không mô tả
AI Lmao như một skills/tools provider. Thay vào đó,
`ailmao-landing/public/skills/ailmao-agent-access/SKILL.md` hướng dẫn sử dụng các
read-only surface thật: AADP manifest, sitemap/entity endpoint, Markdown negotiation
và WebMCP tools.

Index route tính `sha256` từ file đang phục vụ thay vì hardcode, nên digest không
drift khỏi nội dung tại `url`. Đây là per-application authored document; chưa có
phần đủ AADP-specific để đưa vào core. Nếu AADP sau này phát hành skill riêng,
pattern “tính digest từ live file” SHOULD được giữ lại.

## 5. Quan hệ giữa các proposal

```text
Agent-discovery integrations proposal (memo này)
├── helper/library candidates
│   ├── Link header
│   ├── RFC 9727 API Catalog
│   ├── Markdown rendering
│   └── DNS-AID checksum representation
└── focused design proposals
    └── Content Site + public access discovery
```

Memo này là umbrella inventory. Proposal Content Site là focused design memo có
thể dẫn tới ADR và protocol version mới. Nội dung wire shape, validation và migration
MUST nằm ở proposal chuyên sâu, không được nhân đôi tại đây.

## 6. Hướng triển khai đề xuất

1. Tách từng package helper candidate thành issue/design item có acceptance criteria.
2. Ưu tiên sửa semantics `security_schemes.type: "none"` trước khi thêm field mới.
3. Mở ADR riêng cho application profile/default access.
4. Không gộp DNS mutation, WebMCP runtime hoặc MCP server implementation vào core.
5. Chỉ công bố adjacent discovery metadata khi capability thật đã deploy.

## 7. Housekeeping

Tại thời điểm memo ban đầu được viết, `ailmao-landing/node_modules/ail-aadp` dùng
version `1.0.5` trong khi repository `aadp` đã ở `1.0.9`. Việc nâng dependency là
maintenance task riêng, không nên gộp vào protocol proposal.

## 8. Security considerations

- Helper MUST NOT tạo placeholder endpoint hoặc live credential.
- DNS digest chỉ có giá trị xác thực nguồn khi resolver thực hiện DNSSEC validation.
- Client vẫn phải áp dụng URL/redirect/SSRF policy cho mọi discovered URL.
- Scanner score không phải security proof hoặc protocol conformance result.
- Publisher không được biến protected resource thành public chỉ bằng metadata sai;
  enforcement tại resource server vẫn là security boundary.

## 9. Compatibility và versioning

- Helper chỉ sinh representation từ contract hiện có có thể là package-level feature.
- Field mới trong manifest cần protocol/schema version mới theo ADR-0004.
- Schema v1.0 MUST NOT bị sửa để nhận application profile/default access mới.
- Draft DNS-AID key hoặc MCP proposal MUST NOT được trình bày như chuẩn đã final.

## 10. IANA Considerations

Memo này không yêu cầu hành động IANA.

## 11. Tài liệu tham chiếu

### Nguồn AADP

- [Quy ước tài liệu AADP](../document-conventions.md)
- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [ADR-0001: Checksum algorithm](../adr/0001-checksum-algorithm.md)
- [ADR-0004: Backward compatibility](../adr/0004-backward-compatibility.md)
- [ADR-0005: Manifest v1 discovery](../adr/0005-manifest-v1-discovery.md)
- [Đề xuất khai báo Content Site và truy cập công khai](../vi/design/content-site-access-discovery-proposal.md)

### Chuẩn ngoài

- RFC 8288, “Web Linking”.
- RFC 8414, “OAuth 2.0 Authorization Server Metadata”.
- RFC 9460, “Service Binding and Parameter Specification via the DNS”.
- RFC 9727, “api-catalog: A Well-Known URI and Link Relation”.
- RFC 9728, “OAuth 2.0 Protected Resource Metadata”.

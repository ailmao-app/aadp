# Đề xuất khai báo Content Site và truy cập công khai trong AADP

## Metadata tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Proposed |
| Đối tượng | Maintainer AADP, tác giả schema, client và conformance tool |
| Phạm vi | Phân loại ứng dụng, access mặc định và khả năng xác định OAuth/MCP có áp dụng hay không |
| Tính chuẩn tắc | Informational; chưa thay đổi specification hoặc JSON Schema đã phát hành |
| Nguồn phát hiện | Tích hợp `ailmao.com` với external agent-readiness scanner |

## Tóm tắt

AADP v1.0 mô tả được resource/interface không cần xác thực qua security scheme
`type: "none"`, nhưng chưa có application-level contract để nói rõ một deployment
là content site công khai và các chuẩn OAuth, agent registration hoặc remote MCP
không áp dụng. Khi thiếu tín hiệu này, scanner bên ngoài có thể diễn giải sự vắng
mặt của OAuth/OIDC discovery, OAuth Protected Resource Metadata, `auth.md` và MCP
Server Card như các lỗi cần sửa.

Memo này đề xuất hai lớp cải tiến:

1. làm rõ và sửa semantics hiện có của `security_schemes.type: "none"` để resource
   công khai có thể khai báo tường minh mà vẫn shared-cacheable;
2. thiết kế application profile và default access cho protocol version kế tiếp,
   giúp client/scanner phân biệt `not applicable` với `supported but missing` mà
   không cần publisher phát hành OAuth/MCP metadata giả.

## 1. Trạng thái của memo

Các từ khóa **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** và **MAY** trong
memo này được hiểu theo BCP 14, RFC 2119 và RFC 8174 khi quyết định tương ứng được
chấp nhận vào specification tương lai. Ở trạng thái Proposed, ví dụ và field mới
đều là non-normative.

Memo này MUST NOT được dùng để quảng cáo rằng AADP v1.0 đã có application profile
hoặc default access. Wire contract v1.0 và schema v1.0 tiếp tục bất biến theo
[ADR-0004](../../adr/0004-backward-compatibility.md).

## 2. Bối cảnh

### 2.1 Trường hợp `ailmao.com`

`ailmao.com` là landing/content site có các AADP resource và WebMCP read-only tool
công khai. Deployment không phải:

- OAuth 2.0 Authorization Server;
- OpenID Provider;
- OAuth Protected Resource yêu cầu bearer token;
- agent registration service;
- remote MCP server có transport endpoint.

Do đó, việc tạo các endpoint sau chỉ để vượt qua scanner sẽ công bố metadata sai:

```text
/.well-known/openid-configuration
/.well-known/oauth-authorization-server
/.well-known/oauth-protected-resource
/auth.md
/.well-known/mcp/server-card.json
```

### 2.2 Contract AADP hiện có

AADP v1.0 đã định nghĩa:

- `resources[].security` và `interfaces[].security` tham chiếu scheme ID;
- `security_schemes.<id>.type: "none"` cho no authentication;
- `api_key` và `oauth2` cho các interface/resource được bảo vệ;
- khi không có gì để công bố, `security_schemes` phải được omit thay vì `{}`.

Như vậy, `type: "none"` đã là khái niệm tương đương và MUST được dùng lại. Đề xuất
này không tạo role/trạng thái song song như `guest`, `anonymous` hoặc `public_auth`.

Tuy nhiên còn hai khoảng trống:

1. omission của `security` có thể được hiểu là “public” bởi AADP server hiện tại,
   nhưng không tạo ra một tuyên bố application-level tường minh cho scanner;
2. runtime hiện có thể phân loại mọi `resources[].security` truthy là private,
   kể cả khi reference trỏ tới scheme `type: "none"`. Điều này khiến publisher
   phải bỏ reference `none` để giữ shared caching, làm mất tín hiệu explicit.

## 3. Mục tiêu

1. Cho phép publisher nói rõ application chủ yếu là content site công khai.
2. Cho phép khai báo no authentication mà không làm resource mất shared caching.
3. Cho phép resource/interface override access mặc định khi có protected surface.
4. Giúp scanner suy ra OAuth/Auth.md/MCP Server Card là `not_applicable` thay vì
   `missing` khi deployment không quảng cáo capability tương ứng.
5. Giữ AADP là discovery protocol, không biến nó thành OAuth server, MCP runtime
   hoặc registry của mọi chuẩn agent-adjacent.

## 4. Non-goals

- Không định nghĩa OAuth/OIDC flow mới.
- Không tạo well-known endpoint “no auth” mang tên OAuth.
- Không thay thế RFC 8414, OpenID Connect Discovery hoặc RFC 9728.
- Không coi WebMCP là remote MCP server.
- Không thay đổi schema v1.0 đã phát hành.
- Không yêu cầu scanner bên thứ ba phải hiểu extension trước khi có integration.

## 5. Mô hình đề xuất

### 5.1 Phân loại application

Protocol version kế tiếp SHOULD bổ sung một field đóng vai trò profile, không tái
sử dụng `application.categories`. Categories mô tả domain như `entertainment` hoặc
`ai-characters`; chúng không đủ chặt để quyết định auth/MCP applicability.

Ví dụ non-normative:

```json
{
  "application": {
    "name": "Example",
    "description": "Public content site.",
    "profile": "content_site",
    "publisher": {
      "name": "Example",
      "url": "https://example.com"
    }
  }
}
```

Candidate values ban đầu:

| Giá trị | Ý nghĩa |
|---|---|
| `content_site` | Nội dung/read-only discovery là surface chính |
| `api_application` | Có API/interface tương tác là surface chính |
| `hybrid` | Có cả content discovery và interactive API đáng kể |

Danh sách cuối cùng cần được chốt bằng ADR. Client MUST NOT suy ra authorization
chỉ từ `profile`; access contract bên dưới mới là nguồn quyết định.

### 5.2 Access mặc định ở application level

Protocol version kế tiếp SHOULD cho phép application trỏ tới một security scheme
mặc định. Reference MUST dùng lại `security_schemes` thay vì thêm enum auth mới.

Ví dụ non-normative:

```json
{
  "default_security": "public",
  "resources": [
    {
      "type": "post"
    },
    {
      "type": "private_profile",
      "security": "oauth"
    }
  ],
  "security_schemes": {
    "public": {
      "type": "none"
    },
    "oauth": {
      "type": "oauth2",
      "authorization_url": "https://auth.example.com/authorize",
      "token_url": "https://auth.example.com/token",
      "scopes": ["profile.read"]
    }
  }
}
```

Semantics đề xuất:

1. `resources[].security` hoặc `interfaces[].security` override
   `default_security`.
2. Nếu không có override, entry kế thừa `default_security`.
3. Scheme `type: "none"` nghĩa là request không cần credential.
4. Scheme `type: "none"` MUST giữ public/shared-cache semantics nếu response đáp
   ứng các điều kiện cache khác.
5. Scheme `oauth2` chỉ mô tả endpoint thật; publisher MUST NOT tạo placeholder.

Tên và vị trí chính xác của `default_security` là open design question. ADR cần so
sánh root-level field với `application.default_security` trước khi chốt schema.

### 5.3 Applicability của chuẩn adjacent

AADP SHOULD ưu tiên positive capability discovery thay vì duy trì một map phủ định
lớn như `oauth: "not_applicable"`, vì danh sách chuẩn adjacent sẽ tiếp tục tăng.

Scanner có thể dùng quy tắc sau:

```text
profile = content_site
AND effective security của mọi resource/interface = none
AND không có interface type = mcp
    → OAuth/OIDC discovery: not_applicable
    → OAuth Protected Resource Metadata: not_applicable
    → auth.md: not_applicable
    → MCP Server Card: not_applicable
```

Khi manifest quảng cáo một OAuth-protected interface/resource, scanner mới SHOULD
kiểm tra RFC 8414/OpenID discovery và RFC 9728. Khi manifest quảng cáo remote MCP
interface có endpoint, scanner mới SHOULD kiểm tra MCP Server Card.

WebMCP không kích hoạt remote MCP checks vì WebMCP là browser API, không phải MCP
transport endpoint.

## 6. Thay đổi tương thích với v1.0

Các cải tiến sau có thể triển khai trong package mà không đổi wire schema v1.0:

1. Server runtime resolve scheme reference trước khi chọn cache policy.
2. `type: "none"` được xử lý giống resource/interface không có security reference.
3. Conformance test khóa invariant `none → public cache`, protected scheme →
   `private, no-store`.
4. Implementation guide giải thích cách khai báo explicit no-auth bằng scheme
   `type: "none"` và cảnh báo không phát hành OAuth metadata giả.

Việc thêm `application.profile` hoặc `default_security` là wire change và MUST chờ
protocol version mới theo ADR-0004.

## 7. Validation và conformance

Nếu đề xuất được chấp nhận, validator/conformance SHOULD kiểm tra:

- `default_security` resolve tới scheme tồn tại;
- override ở resource/interface resolve đúng;
- `type: "none"` không có field credential/endpoint thừa;
- application `content_site` MAY có protected override, nhưng scanner không được
  suy ra toàn site no-auth khi tồn tại override protected;
- OAuth discovery chỉ được yêu cầu khi có effective OAuth security;
- MCP Server Card chỉ được yêu cầu khi có remote MCP interface thật.

Test transition tối thiểu:

```text
public default → public resource
public default → OAuth override
OAuth default → public override
omitted default → legacy v1.0 behavior
none scheme → shared cache
OAuth/API key scheme → private/no-store
```

## 8. Security considerations

- Metadata `type: "none"` MUST NOT làm một protected endpoint trở thành public chỉ
  vì manifest khai báo sai; enforcement tại resource server vẫn là security boundary.
- Client MUST NOT gửi credential tới endpoint public nếu manifest không yêu cầu.
- Publisher MUST NOT nhúng API key, client secret hoặc access token vào manifest.
- Scanner MUST NOT khuyến nghị OAuth endpoint giả chỉ để tăng readiness score.
- Client vẫn phải xem manifest là publisher-controlled input và áp dụng URL policy,
  redirect policy và SSRF protection hiện có.

## 9. Compatibility và versioning

- Không sửa `schemas/v1.0/manifest.schema.json`.
- Runtime fix cho scheme `none` có thể phát hành dưới package version tương thích
  nếu test chứng minh không làm đổi behavior của protected scheme.
- Application profile/default access cần ADR và protocol/schema version mới.
- Client cũ phải tiếp tục hoạt động khi đọc manifest v1.0 không có field mới.

Release allocation hiện đề xuất:

| Issue family | Release đích |
|---|---|
| `AADP-ACCESS-001` — explicit `none` cache semantics | `1.0.10` hoặc patch phù hợp gần nhất |
| `AADP-PROFILE-001` — ADR/design gate | Trước hoặc đầu `1.9.0` |
| `AADP-PROFILE-002` — experimental v2 implementation | `1.9.0` |
| `AADP-PROFILE-003` — scanner interoperability | `1.9.x` → `2.0.0` |
| Stable profile/default access wire contract | `2.0.0` |

Chi tiết patch candidate `AADP-ACCESS-001` được theo dõi trong
[kế hoạch `ail-aadp` 1.0.10](../plans/implementation-plan-v1.0.10.md).

## 10. Operational considerations

Scanner integration SHOULD hiển thị ba trạng thái riêng:

- `pass`: capability áp dụng và discovery hợp lệ;
- `fail`: capability được quảng cáo/áp dụng nhưng discovery thiếu hoặc sai;
- `not_applicable`: profile/access cho biết capability không thuộc deployment.

`not_applicable` không nên cộng điểm giả, cũng không nên trừ điểm. Report SHOULD
giải thích evidence AADP nào dẫn tới kết luận này.

## 11. Open questions

1. Field nên là `application.profile`, `application.kind` hay một profile URI?
2. `default_security` nên ở root hay trong `application`?
3. Có cần profile registry mở rộng hay enum đóng theo protocol version?
4. Scanner nên tin self-declared profile đến mức nào trước khi kiểm tra response thật?
5. `oauth2` vNext nên trỏ trực tiếp tới RFC 8414 metadata URL thay vì chỉ có
   `authorization_url`/`token_url` hay không?

## 12. Hướng triển khai đề xuất

1. `AADP-ACCESS-001`: viết test tái hiện `security: <none-scheme>` đang làm
   response mất shared cache; sửa runtime semantics và guide trong phạm vi v1.0.
2. `AADP-PROFILE-001`: mở ADR cho application profile/default access.
3. `AADP-PROFILE-002`: chốt và thử nghiệm wire shape trong v2 preview; thêm
   validator, conformance fixtures, client và server implementation.
4. `AADP-PROFILE-003`: tích hợp scanner dựa trên effective security và interface
   thật, phân biệt `pass`, `fail`, `not_applicable`.
5. Freeze stable contract chỉ sau migration rehearsal và ít nhất hai implementation
   độc lập, trong đó có content site public và hybrid/protected application.

## 13. IANA Considerations

Memo này không yêu cầu hành động IANA.

## 14. Tài liệu tham chiếu

### Nguồn AADP

- [AADP v1.0 specification](../../../spec/v1.0/specification.md)
- [AADP v1.0 manifest schema](../../../schemas/v1.0/manifest.schema.json)
- [ADR-0004: Backward compatibility](../../adr/0004-backward-compatibility.md)
- [ADR-0005: Manifest v1 discovery](../../adr/0005-manifest-v1-discovery.md)
- [Security considerations](../../guides/security-considerations.md)
- [Đề xuất agent-discovery integrations](../../design/agent-discovery-integrations-proposal.md)
- [Kế hoạch triển khai AADP v1.0 và roadmap hậu v1](../plans/implementation-plan.md)
- [Release roadmap](../plans/release-roadmap.md)
- [Kế hoạch `ail-aadp` 1.0.10](../plans/implementation-plan-v1.0.10.md)
- [Kế hoạch `ail-aadp` 2.0.0](../plans/implementation-plan-v2.0.0.md)

### Chuẩn ngoài

- RFC 8414, “OAuth 2.0 Authorization Server Metadata”.
- OpenID Connect Discovery 1.0.
- RFC 9728, “OAuth 2.0 Protected Resource Metadata”.
- RFC 9111, “HTTP Caching”.

# Kế hoạch triển khai `ail-aadp` 1.7.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Auth-aware retrieval helpers |
| Dependency | Security/credential-provider ADR |
| Wire impact | Không đổi manifest schema v1.0 |

## Scope

- Injectable credential provider theo security scheme ID.
- Header/query decoration sau khi manifest/security metadata đã qua
  schema/semantic validation, nhưng trước khi fetch protected resource.
- Allowed origin/path scope và cross-origin stripping.
- Secret redaction trong error, log, JSON/JUnit report.
- Authenticated conformance profile dùng test credential explicit.

OAuth token acquisition SHOULD nằm ngoài core; application cung cấp token/provider.
Client không auto-login, auto-execute interface hoặc lưu credential.

Request flow bắt buộc:

```text
validate manifest/security metadata
        ↓
resolve credential policy và allowed origin/path
        ↓
decorate protected request
        ↓
fetch resource → validate resource schema/semantics
```

Không gửi credential dựa trên metadata chưa được validate. Không yêu cầu validate
protected document trước khi gửi request đầu tiên vì document đó chưa thể được
đọc; validation sau fetch vẫn phải hoàn tất trước khi client tin hoặc traversal
URL do document cung cấp.

## Work packages

1. Credential lifecycle/origin/redaction ADR.
2. Provider interface và request decorator service.
3. URL/redirect integration.
4. Error/report redaction.
5. Auth profile, fixtures và security tests.

## Release gate

- Không credential leakage.
- Default client không gửi credential.
- Cancellation/provider cleanup rõ.
- Auth error phân biệt protocol invalid.
- Security review và clean-install tests xanh.

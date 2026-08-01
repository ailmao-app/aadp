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
- Header/query decoration sau schema/semantic validation.
- Allowed origin/path scope và cross-origin stripping.
- Secret redaction trong error, log, JSON/JUnit report.
- Authenticated conformance profile dùng test credential explicit.

OAuth token acquisition SHOULD nằm ngoài core; application cung cấp token/provider.
Client không auto-login, auto-execute interface hoặc lưu credential.

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

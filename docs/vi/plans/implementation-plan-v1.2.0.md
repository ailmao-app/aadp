# Kế hoạch triển khai `ail-aadp` 1.2.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Module infrastructure và Relations Module |
| Blocking dependency | ADR module versioning |
| Wire impact | Module riêng; không đổi core schema v1.0 |

## Work packages

1. `AADP-MODULE-001`: module ID/version/discovery/compatibility ADR.
2. Registry theo `{moduleId, moduleVersion, kind}`.
3. `AADP-REL-001..003`: Relations ADR, registry, schema và fixtures.
4. `AADP-REL-004`: semantic validator.
5. `AADP-REL-005`: collection/client traversal.
6. `AADP-REL-006`: conformance và security review.

## Layer boundary

- Core client chỉ discovery và safely ignore unknown module.
- Module registry/validator nằm trong `src/modules` hoặc boundary tương đương.
- Relations client dùng core HTTP/URL/budget service, không duplicate networking.
- Application relation mapping nằm ngoài package core.

## Acceptance

- Typed one/inline-many/paginated collection contract.
- Canonical target và inverse relation semantics rõ.
- Depth/request/byte budget và cycle guard.
- Privacy/social-graph review.
- Schema/types/validator/client/conformance cùng module version.
- External neutral implementation đạt Relations conformance.

## Release gate

- ADR Accepted và unknown module safely ignorable.
- Không thêm Relations field vào released core schema v1.0 ngoài extension rule.
- Core-only consumer không regression.

# ADR-0007: Versioning, discovery và package boundary cho AADP Module

## Status

Accepted — áp dụng từ kế hoạch package `ail-aadp@1.2.0`.

## Context

AADP v1.0 cho phép manifest khai báo `modules[]`, nhưng chưa khóa quan hệ giữa
package version, core protocol version và module version. Relations Module là
module chuẩn đầu tiên và phải tạo precedent dùng lại được cho các module sau.

## Decision

### Version domains

Ba version domain độc lập:

```text
ail-aadp@1.2.0          npm package version
aadp_version: "1.0"    core protocol version
aadp:relations@1.0      module wire version
```

Package bump MUST NOT tự đổi core hoặc module version. Module major thay đổi wire
không tương thích; minor thêm optional contract tương thích; patch chỉ sửa
implementation, không đổi tập payload được chấp nhận. Released artifacts là
immutable.

### Module ID và discovery

Module ID MUST khớp `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$`. Namespace `aadp` dành
cho module chuẩn AADP; vendor MUST dùng namespace do mình sở hữu.

Manifest v1.0 chỉ dùng contract đã release:

```json
{
  "modules": [
    {
      "id": "aadp:relations",
      "version": "1.0",
      "schema": "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json"
    }
  ]
}
```

Server MUST chỉ quảng bá module khi endpoints và artifacts đã deploy và đạt module
conformance. Không thêm field không có namespace như `registry` vào declaration.

### Registry lookup

Registry exact-match `{moduleId, moduleVersion, kind}` và MUST phân biệt:

- `unsupported_module`;
- `unsupported_module_version`;
- `unsupported_module_kind`;
- `invalid_module_document`.

Registry MUST NOT fallback sang version khác.

### Envelope boundary

Core entity v1.0 tiếp tục immutable. Inline module payload dùng extension point
`x_*` ở root entity; Relations dùng `x_relations`, không đặt trong application
`data`.

Standalone module document MUST tự mô tả `aadp_version`, module ID, module version
và document kind. Core-only consumer MUST bỏ qua module không hỗ trợ mà không
fetch module schema/endpoint. Opt-in consumer MUST báo unsupported state rõ ràng.

### Package exports

Module APIs và schemas nằm dưới versioned subpath:

```text
ail-aadp/modules/<module-name>/v<module-version>
ail-aadp/schemas/modules/<module-name>/v<module-version>/*
```

Relations dùng `ail-aadp/modules/relations/v1.0` và
`ail-aadp/schemas/modules/relations/v1.0/*`. Module API MUST NOT được re-export từ
package root. Tarball tests MUST không import `src/**`.

### Conformance boundary

Core checks và stable core check IDs không đổi khi thêm module. Mỗi module có
runner/check suite riêng nhưng MAY dùng chung report, HTTP policy và execution
utilities.

## Consequences

- Module registry nằm ngoài closed core schema registry.
- Module clients dùng shared infrastructure, không duplicate HTTP/URL/budget.
- Core-only consumer tiếp tục tương thích với manifest/entity v1.0.
- Public surface tăng qua versioned subpaths thay vì package root.

## References

- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [ADR-0004](0004-backward-compatibility.md)
- [Relations Module v1.0 specification](../../spec/modules/relations/v1.0/specification.md)
- [Kế hoạch 1.2.0](../vi/plans/implementation-plan-v1.2.0.md)

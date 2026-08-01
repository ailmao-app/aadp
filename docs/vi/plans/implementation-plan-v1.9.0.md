# Kế hoạch triển khai `ail-aadp` 1.9.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | AADP v2 preview và migration tooling |
| Dependency | V2 problem statement và ADRs |
| Wire impact | Experimental preview only |

## Scope

- `experimental/v2` schema/types/validator/client namespace.
- V1→v2 compatibility analyzer; không silent migration.
- CLI opt-in `--version 2.0-preview`.
- Dual-version fixtures và conformance preview.
- Deprecation warnings cho API dự kiến xóa ở 2.0.
- Migration guide và mechanical codemod.

Unversioned exports MUST không đổi trong 1.9. Preview mutable và không dùng cho
production certification.

## Work packages

1. V2 design gates/ADRs.
2. Experimental registry và artifacts.
3. Analyzer với loss/ambiguity report.
4. Codemod/import migration.
5. Preview conformance/reference server.
6. Deprecation telemetry/docs và migration rehearsal.

## Release gate

- Preview namespace không ảnh hưởng v1.
- Analyzer không làm mất dữ liệu im lặng.
- Breaking API inventory hoàn chỉnh.
- Khi v2 freeze chỉ nhận blocker fix trước 2.0.

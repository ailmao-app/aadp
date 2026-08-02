# Kế hoạch triển khai `ail-aadp` 2.0.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Major Implementation Draft |
| Chủ đề | Stable AADP v2 và package compatibility cleanup |
| Dependency | `1.9.x` migration evidence, v2 ADR/spec Accepted |
| Breaking impact | Package API và AADP wire v2 |

## Khi nào được phép mở 2.0

Chỉ mở khi có breaking requirement không thể giải quyết bằng module, extension
hoặc opt-in API. Refactor thư mục nội bộ hoặc mong muốn “đẹp hơn” không đủ lý do.

## Candidate breaking scope

- Stable v2 spec/schema/types/validator/client/server/conformance.
- Application profile để phân biệt `content_site`, `api_application` và `hybrid`
  sau khi vocabulary được ADR chốt.
- Default security cùng inheritance/override semantics cho resource và interface,
  dùng lại `security_schemes` thay vì tạo auth enum song song.
- Chuẩn hóa extension đã chứng minh nếu ADR yêu cầu, ví dụ `ai_usage`.
- Đổi unversioned/default client khỏi legacy v0.1 theo migration policy.
- Xóa/deprecate dứt điểm `./schemas/*` alias ngầm trỏ v0.1.
- Xóa CLI/API alias đã cảnh báo từ `1.9.x`.
- Giữ explicit versioned entry points trong support window.

## Kiến trúc mục tiêu

```text
shared infrastructure: HTTP, URL/DNS, budgets, canonical JSON
          │
          ├── protocol/v1 (compatibility support)
          ├── protocol/v2 (stable default)
          │   └── application profile + effective access resolution
          └── modules/* (version độc lập)
```

Không rewrite toàn bộ nếu shared layer hiện tại vẫn đúng. Chỉ tách khi có
duplication/test/ownership value.

## Work packages

1. Chấp nhận `AADP-PROFILE-001`, chốt application profile, default security,
   inheritance, override và omission semantics.
2. Freeze v2 contract và publish schemas/spec/ADRs.
3. Implement versioned v2 layers dùng shared infrastructure.
4. Thêm effective-security resolver dùng chung cho validator, client, server và
   conformance; `type: "none"` không được biến thành protected cache policy.
5. Package exports/defaults và deprecated API removal.
6. Migration analyzer/codemod/guide, gồm mapping từ v1 omission/explicit `none`.
7. Dual-version compatibility/conformance window.
8. Scanner interoperability cho `pass`/`fail`/`not_applicable`, không phát hành
   OAuth/MCP metadata giả để đạt điểm.
9. Security/privacy/legal/interoperability review.
10. Release rehearsal, rollback và support policy.

## Release gate

- Hai implementation độc lập đạt v2 conformance.
- Ít nhất một content site public và một hybrid/protected implementation chứng
  minh profile/access inheritance có thể interoperable.
- V1 explicit `none` và omission fixtures có migration result được review, không
  tự quyết business intent khi dữ liệu v1 còn mơ hồ.
- V1→v2 rehearsal không silent data loss.
- Breaking API diff và migration guide được review.
- Module compatibility matrix hoàn chỉnh.
- Package/tag/spec/schema/changelog/provenance khớp.
- Có rollback và v1 support/deprecation timeline.

## Sau 2.0

Tiếp tục `2.x` cho feature tương thích ngược. `3.0.0` chỉ được mở khi có breaking
requirement mới đã được chứng minh bằng ADR và migration evidence; hiện chưa lập
feature plan cho 3.0.

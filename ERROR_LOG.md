# Nhật ký lỗi

## 2026-07-26 - Metadata package npm

- **Nơi xảy ra:** Cấu hình publish package `ail-aadp`.
- **Triệu chứng:** Package sau khi publish lên npm không có từ khóa tìm kiếm.
- **Nguyên nhân (root cause):** `package.json` chưa khai báo trường `keywords`.
- **Fix:** Bổ sung các từ khóa mô tả AADP, AI application discovery, AEO/GEO, protocol, schema và validator tại [package.json:5](package.json#L5).

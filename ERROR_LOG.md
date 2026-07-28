# Nhật ký lỗi

## 2026-07-26 - Metadata package npm

- **Nơi xảy ra:** Cấu hình publish package `ail-aadp`.
- **Triệu chứng:** Package sau khi publish lên npm không có từ khóa tìm kiếm.
- **Nguyên nhân (root cause):** `package.json` chưa khai báo trường `keywords`.
- **Fix:** Bổ sung các từ khóa mô tả AADP, AI application discovery, AEO/GEO, protocol, schema và validator tại [package.json:5](package.json#L5).

## 2026-07-27 - Giới hạn tải của conformance runner

- **Nơi xảy ra:** Conformance runner v1.0, các bước traversal, kiểm tra cache validator và negative target.
- **Triệu chứng:** `maxPages` và `maxEntities` vẫn cho phép runner gửi thêm request ngoài giới hạn đã cấu hình.
- **Nguyên nhân (root cause):** Budget chỉ được tính trong discovery traversal; các request cache validator và negative target gọi HTTP client trực tiếp nên không dùng chung bộ đếm.
- **Fix:** Đưa mọi request sitemap/entity qua helper có tính shared budget, xử lý budget exhaustion thống nhất thành kết quả inconclusive và bổ sung test đếm request thực tế tại [src/conformance/checks.ts:173](src/conformance/checks.ts#L173), [src/conformance/runner.ts:325](src/conformance/runner.ts#L325), [tests/conformance/v1.0/runner.test.ts:202](tests/conformance/v1.0/runner.test.ts#L202).

## 2026-07-27 - Giới hạn redirect bị lệch một hop

- **Nơi xảy ra:** HTTP client dùng chung của validator và conformance runner.
- **Triệu chứng:** `maxRedirects: 1` từ chối ngay redirect đầu tiên, nên có hành vi giống `maxRedirects: 0`.
- **Nguyên nhân (root cause):** Điều kiện chặn dùng `hop + 1 >= maxRedirects`, tính redirect hiện tại là đã vượt giới hạn thay vì chỉ chặn hop kế tiếp.
- **Fix:** Chỉ ném lỗi khi số hop cần theo lớn hơn giới hạn và thêm test boundary cho `0`, `1`, `2` tại [src/client/http.ts:293](src/client/http.ts#L293), [tests/conformance/v1.0/runner.test.ts:493](tests/conformance/v1.0/runner.test.ts#L493).

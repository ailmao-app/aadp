# Kế hoạch triển khai `ail-aadp` 1.0.10

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Conditional Implementation Draft |
| Chủ đề | Robustness fixes từ corpus và consumer feedback |
| Dependency | `1.0.9` đã release |
| Wire impact | Không |

## Mục tiêu và điều kiện mở milestone

Chỉ mở `1.0.10` khi `1.0.9` phát hiện bug tương thích patch. Nếu không có bug,
MUST bỏ qua version này thay vì tạo release rỗng.

Candidate scope: URL/route canonicalization, DNS pinning/redirect header,
cursor/budget accounting, JSON/JUnit escaping, CLI output và tarball portability.

## Quy trình mỗi fix

1. Viết reproduction test tại layer sở hữu behavior.
2. Xác nhận root cause và SemVer impact.
3. Fix tối thiểu, không đổi policy/flow ngoài lỗi.
4. Ghi `ERROR_LOG.md` với file:line.
5. Chạy unit, integration, clean-install và conformance liên quan.

## Test matrix

| Layer | Regression bắt buộc |
|---|---|
| URL/route | Unicode, percent encoding, collision, traversal |
| HTTP/DNS | Redirect, rebinding, header stripping, timeout |
| Traversal | Cycle, shared budget, cleanup |
| Report/CLI | XML escaping, exit code, output failure |
| Package | Node support matrix và tarball import |

## Release gate

- Mọi fix có reproduction test và `ERROR_LOG.md`.
- Không đổi schema v1.0, public export hoặc stable machine code.
- `npm run docs:check`, build, test, audit và pack xanh.
- Changelog chỉ liệt kê bug thực sự đã fix.

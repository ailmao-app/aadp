# Kế hoạch triển khai `ail-aadp` 1.0.10

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Released / Implementation Record |
| Release | `1.0.10` — 2026-08-02 |
| Chủ đề | Robustness fixes từ corpus và consumer feedback |
| Dependency | `1.0.9` đã release |
| Wire impact | Không |

## Mục tiêu và điều kiện mở milestone

Chỉ mở `1.0.10` khi `1.0.9` phát hiện bug tương thích patch. Nếu không có bug,
MUST bỏ qua version này thay vì tạo release rỗng.

Candidate scope: URL/route canonicalization, DNS pinning/redirect header,
cursor/budget accounting, JSON/JUnit escaping, CLI output, tarball portability và
server runtime regression làm explicit no-auth scheme mất public cache semantics.

## Candidate work items

### `AADP-ACCESS-001` — Explicit `none` phải giữ public cache semantics

Nguồn phát hiện:
[Đề xuất khai báo Content Site và truy cập công khai](../design/content-site-access-discovery-proposal.md).

AADP v1.0 đã định nghĩa `security_schemes.<id>.type: "none"`. Tuy nhiên server
runtime hiện có nguy cơ chỉ kiểm tra `resources[].security` có truthy hay không để
chọn cache policy. Khi resource tham chiếu tường minh tới scheme `none`, response
có thể bị phân loại `private, no-store`, trong khi cùng resource omit `security`
lại được shared-cache.

Đây là candidate patch fix, không phải feature wire mới. Chỉ đưa vào release khi
reproduction test chứng minh behavior hiện tại vi phạm semantics đã phát hành.

Phạm vi:

1. Thêm test resource tham chiếu scheme `type: "none"`.
2. Resolve scheme definition trước khi chọn cache policy.
3. `none` dùng cùng public/shared-cache path với resource không có security.
4. `api_key` và `oauth2` tiếp tục dùng protected/private cache path.
5. Không sửa schema v1.0, manifest shape hoặc public API ngoài bug fix cần thiết.
6. Cập nhật implementation/security guide và `ERROR_LOG.md` khi fix thực tế được
   triển khai.

Acceptance:

- explicit `none` và omitted security có cache behavior tương đương;
- protected scheme vẫn `private, no-store`;
- conditional GET, ETag và Last-Modified invariants không regression;
- server runtime, schema, semantic và conformance tests liên quan xanh;
- SemVer assessment xác nhận patch-compatible.

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
| Server/cache | Omitted security, explicit `none`, API key/OAuth protected scheme |
| Report/CLI | XML escaping, exit code, output failure |
| Package | Node support matrix và tarball import |

## Release gate

- Mọi fix có reproduction test và `ERROR_LOG.md`.
- Không đổi schema v1.0, public export hoặc stable machine code.
- `AADP-ACCESS-001` chỉ được đánh dấu hoàn tất khi explicit `none` và omission có
  cache behavior tương đương, còn protected scheme không regression.
- `npm run docs:check`, build, test, audit và pack xanh.
- Changelog chỉ liệt kê bug thực sự đã fix.

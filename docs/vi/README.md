# Tài liệu AADP nội bộ bằng tiếng Việt

## Trạng thái tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Phạm vi | Thiết kế, kế hoạch, review và hướng dẫn vận hành nội bộ |
| Ngôn ngữ | Tiếng Việt có dấu |
| Tính chuẩn tắc | Không mặc định; xem specification/schema/ADR được liên kết |
| Quy ước | [`../document-conventions.md`](../document-conventions.md) |

## 1. Thứ tự ưu tiên nguồn

Specification theo version trong `spec/` và JSON Schema trong `schemas/` là nguồn
contract được công bố. ADR Accepted ghi lại quyết định kiến trúc. Tài liệu trong
thư mục này phục vụ triển khai nội bộ, có thể chi tiết hơn nhưng MUST NOT âm thầm
thay đổi wire contract đã release.

## 2. Thiết kế và kế hoạch chính

- [Thiết kế Manifest v1.0](design/manifest-v1.0-design.md)
- [Thiết kế Relations Module](design/relations-module-design.md)
- [Kế hoạch tích hợp AEO/GEO](design/aeo-geo-integration-plan.md)
- [Kế hoạch và hồ sơ triển khai v1.0](plans/implementation-plan.md)
- [Hồ sơ triển khai custom route cho Server SDK](plans/server-custom-routes-implementation-record.md)
- [Hướng dẫn phát hành npm](operations/npm-release-guide.md)
- [Bản nháp AADP lịch sử](archive/aadp-draft.md)
- [Review Socket.dev cho 1.0.5](archive/socket-dev-review-1.0.5.md)
- [ADR-0005 bằng tiếng Việt](adr/0005-manifest-v1-discovery.md)

## 3. Tài liệu làm việc và lưu trữ

- `design/`: thiết kế đang được review hoặc chờ ADR/specification.
- `plans/`: kế hoạch và implementation record nội bộ.
- `operations/`: runbook phát hành và vận hành còn hiệu lực.
- `archive/`: snapshot lịch sử, không dùng làm hướng dẫn hiện hành.

Mỗi tài liệu mới SHOULD ghi rõ trạng thái, owner/phạm vi và tài liệu chuẩn tắc
liên quan. Nội dung đã lỗi thời SHOULD được đánh dấu Historical hoặc Superseded
thay vì xóa nếu còn giá trị truy vết.

## 4. Quy tắc duy trì

- Documentation và nội dung giải thích viết bằng tiếng Việt có dấu.
- Code, identifier và code comment trong ví dụ giữ tiếng Anh.
- Dùng từ khóa BCP 14 viết hoa (`MUST`, `SHOULD`, `MAY`) khi yêu cầu cần nghĩa chuẩn tắc.
- Khi một quyết định được chốt, cập nhật ADR/specification trước rồi đồng bộ tài liệu nội bộ.
- Khi implementation hoàn tất, cập nhật trạng thái và dẫn tới test/release evidence.

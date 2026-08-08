# ADR-0009: Answer Module terminology và security boundary

## Status

Accepted — áp dụng từ Answer Module `1.0` và package `ail-aadp@1.3.0`.

## Context

Design draft trước đó cho Answer dùng thuật ngữ `short_answer` và một field
`x_answer.canonical_url` riêng, và chưa chốt: (a) tên field chính thức cho câu
trả lời ngắn, (b) integrity digest nào bảo vệ nội dung Answer khi core checksum
chỉ bao phủ `data`, (c) URL human-facing của một Answer entity dùng field nào,
và (d) ranh giới rõ ràng giữa Answer `1.0` và Evidence & Provenance Module
`1.4.0` (claim/citation) để tránh Answer `1.0` âm thầm gánh trách nhiệm evidence.

Implementation không được bắt đầu cho tới khi các quyết định contract này được
Accepted, vì chúng ảnh hưởng trực tiếp field bắt buộc, discriminator và
reference model của wire schema.

## Decision

### Thuật ngữ `concise_answer`

Field câu trả lời ngắn chính thức là `concise_answer`, không phải
`short_answer`. Design draft/document cũ dùng `short_answer` MUST được cập nhật;
wire schema Answer `1.0` KHÔNG hỗ trợ alias `short_answer` — một document dùng
alias này bị từ chối bởi `additionalProperties: false` (thiếu field bắt buộc
`concise_answer`).

### `content_checksum` — integrity digest riêng cho `x_answer`

Core checksum chỉ tính trên `data`; vì mọi field normative của Answer nằm trong
`x_answer`, core checksum không phát hiện được thay đổi nội dung Answer. Answer
Module `1.0` định nghĩa `x_answer.content_checksum` làm digest bổ sung:

- Phạm vi hash: `x_answer` sau khi loại bỏ chính field `content_checksum`.
- Thuật toán/canonicalization tái sử dụng nguyên trạng ADR-0001 và
  `ail-aadp/canonical-json` (`canonicalize()`/`checksumOf()`) — không định nghĩa
  canonicalization rule mới.
- Đây là bổ sung cho, không thay thế, core checksum; một entity Answer hợp lệ
  phải pass cả hai.
- `content_checksum` không phải chữ ký chống producer gian dối và không thay
  thế transport integrity (TLS) — nó chỉ phát hiện tampering trên field nằm
  trong phạm vi hash.

### Tái sử dụng `entity.canonical_url`, không có field riêng trong `x_answer`

Answer `1.0` KHÔNG định nghĩa `x_answer.canonical_url`. Answer entity dùng lại
core `entity.canonical_url` làm URL human-facing duy nhất cho mọi consumer,
core-only lẫn Answer-aware — loại bỏ khả năng hai consumer cite hai URL khác
nhau cho cùng entity. `entity.canonical_url` trở thành bắt buộc đối với entity
`type: "answer"` ở entity-context validator (không phải core schema, vốn giữ
field này optional cho mọi entity type khác). Vì core v1.0 chỉ validate
`format: uri`, entity-context validator tự thực thi URL policy chặt hơn (§ dưới)
dùng chung với `author.url`.

### Shared URL policy: absolute HTTPS, không userinfo, không fragment

`entity.canonical_url` và `authorship.author.url` dùng cùng một pure-parsing
policy: scheme phải là `https:`, không có userinfo, không có fragment. Đây là
Answer entity/wrapper-context rule, không phải core v1.0 policy — core
schema/validator giữ nguyên permissive cho entity type khác. Vi phạm dùng mã
`answer.semantic.canonical_url_policy_violation` /
`answer.semantic.author_url_policy_violation`.

### Ranh giới với Evidence & Provenance Module

Answer `1.0` KHÔNG có field `evidence`, `claims` hay `citations`. `source_targets`
trong `generated-summary` chỉ biểu thị input source của bản tóm tắt — nó KHÔNG
chứng minh factual truth, support hay citation validity. Rule "fact kiểm chứng
được phải có evidence" là content governance advisory cho rollout Evidence
Module `1.4.0`, KHÔNG phải Answer `1.0` schema/semantic invariant. Evidence
Module `1.4.0` sẽ liên kết bằng module riêng/Relations contract và KHÔNG được
âm thầm thêm field vào Answer `1.0` đã release.

### Security: free text luôn là untrusted data

`question`, `concise_answer`, `answer`, author name và applicability `notes` là
untrusted text. Package KHÔNG render, execute, interpolate vào system
prompt/shell/HTML/executable template, không parse instruction từ chúng, và
không dereference URL xuất hiện bên trong free text. Đây là behavior bắt buộc
kiểm chứng ở conformance check `answer.security` (advisory scan, không phải
absence proof — xem `spec/modules/answer/v1.0/conformance.md` §7) và ở test
suite (`prompt-injection-shaped` fixture PHẢI vẫn schema/semantic-valid, không
bị coi là invalid nội dung).

### Authorship là provenance assertion, không phải chữ ký

`authorship` (kể cả `reviewed_by`) là assertion của producer, không phải chữ ký,
identity verification hay endorsement. Schema/semantic validity không chứng
minh assertion trung thực; client KHÔNG tự suy luận `source-authored` khi thiếu
metadata và KHÔNG tự chuyển `kind` sau khi fetch target.

## Consequences

- Wire schema/type/semantic validator/client/conformance đều dùng
  `concise_answer`, `content_checksum`, và `entity.canonical_url` nhất quán —
  không còn hai lựa chọn cạnh tranh nhau cho producer.
- Một implementation cũ gửi `x_answer.canonical_url` hoặc `short_answer` bị từ
  chối rõ ràng (unknown field / missing required field) thay vì được chấp nhận
  âm thầm với ngữ nghĩa mơ hồ.
- `content_checksum` thêm một bước tính digest cho producer, nhưng tái sử dụng
  100% `checksumOf()` đã released — không thêm thuật toán mới cần audit riêng.
- Evidence/citation vẫn ngoài phạm vi Answer `1.0`; Answer `1.0` có thể release
  độc lập với tiến độ Evidence Module `1.4.0`.

## References

- ADR-0001 (checksum algorithm), ADR-0007 (module versioning and discovery),
  ADR-0008 (module traversal and authorization).
- `docs/vi/plans/implementation-plan-v1.3.0.md` — kế hoạch triển khai gốc, các
  quyết định trong ADR này copy nguyên trạng "Quyết định contract đã chốt".
- `spec/modules/answer/v1.0/specification.md`, `conformance.md`.

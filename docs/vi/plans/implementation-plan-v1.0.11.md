# Kế hoạch triển khai `ail-aadp` 1.0.11

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Conditional Implementation Draft |
| Chủ đề | Production certification operations |
| Dependency | `1.0.9`; có thể gộp vào `1.0.10` |
| Wire/runtime impact | Không |

## Mục tiêu

Hoàn thiện automation/evidence cho release và conformance mà không thêm public
runtime API.

## Work packages

1. Scheduled conformance cho neutral reference deployment.
2. Lưu JSON/JUnit artifact với package/protocol version và timestamp.
3. Clean-install Node matrix và `npm pack --dry-run` gate.
4. Trusted publishing/provenance sau khi maintainer chốt quyền/environment.
5. Release, deprecation, rollback và artifact-retention runbook.

Workflow chỉ orchestration; logic report/conformance tiếp tục nằm trong
`src/conformance`. Không nhúng rule protocol vào YAML CI.

## Acceptance

- Scheduled run có timeout và không dùng credential production.
- Inconclusive/skipped không bị báo pass.
- Artifact không chứa secret/internal URL.
- Tag, changelog, package/lockfile và provenance khớp.
- Nếu cần API/profile mới, defer sang `1.1.0`.

## Release gate

- CI/release rehearsal xanh từ clean tag candidate.
- Rollback/deprecate được thử bằng dry-run/documented exercise.
- Không có package behavior change ngoài correction tương thích patch.

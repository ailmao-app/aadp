# Kế hoạch triển khai `ail-aadp` 1.8.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Certification profiles và attestations |
| Dependency | Nhiều implementation độc lập |
| Wire impact | Versioned report/attestation contract |

## Scope

- Versioned certification profile registry.
- Attestation gồm target, protocol/module/package version, effective limits,
  timestamp và report digest.
- JSON/JUnit archive conventions và verification helper.
- Scheduled reference workflow, expiry/revocation và badge example.

Attestation chỉ chứng minh check/profile đã chạy tại thời điểm xác định; không
chứng minh accuracy, license hoặc security toàn hệ thống.

## Work packages

1. Certification scope/trust/retention ADR.
2. Attestation schema/types/digest.
3. Profile registry và report integration.
4. Verification helper và scheduled example.
5. Privacy/security/interoperability review.

## Release gate

- Tối thiểu hai implementation độc lập.
- Inconclusive/skipped không chuyển thành pass.
- Profile/check IDs versioned.
- Expiry/revocation và privacy retention rõ.

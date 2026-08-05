# Kế hoạch triển khai `ail-aadp` 1.4.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Evidence & Provenance Module |
| Dependency | Relations `1.0` stable; Answer `1.0` stable; citation/claim ADR |
| Wire impact | Module riêng |

## Scope

- Contracts cho `claim`, `evidence`, `source`.
- Claim→evidence→source reference integrity.
- Canonical citation, publisher và provenance timestamps.
- Support/contradict/neutral stance và confidence provenance.
- Freshness/staleness metadata.
- Typed helpers, traversal, fixtures và conformance.

Schema validity MUST NOT được diễn giải thành factual truth, authenticity hoặc
legal validity. Source URL luôn qua URL/DNS policy; checksum không phải chữ ký.

## Work packages

1. Citation/provenance/security ADR.
2. Versioned schemas/types/fixtures.
3. Graph semantic validator.
4. Client traversal và Answer integration.
5. Conformance, malicious-citation tests và external reference implementation.

## Release gate

- Không dangling reference hoặc unbounded graph.
- Timestamp/canonical target interoperable.
- Answer tham chiếu Evidence không duplicate payload vô hạn.
- Security/privacy review và module conformance xanh.

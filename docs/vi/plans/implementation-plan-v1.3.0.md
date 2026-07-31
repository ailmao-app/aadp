# Kế hoạch triển khai `ail-aadp` 1.3.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Answer Module |
| Dependency | Relations Module stable |
| Wire impact | Module riêng |

## Scope

- Answer module specification, ID/version và schema.
- Question, concise answer, applicability, locale/freshness và related entity.
- Phân biệt source-authored answer với generated summary.
- Semantic reference validation.
- Typed client helper, neutral fixtures và module conformance.

AADP core MUST NOT generate answer, ranking hoặc AEO score. Free text luôn là
untrusted data; core-only client bỏ qua Answer Module an toàn.

## Work packages

1. Answer terminology/security ADR.
2. Schema/types/examples/invalid fixtures.
3. Semantic validator và Relations integration.
4. Reference resource/client helper.
5. Conformance và clean-install module exports.

## Release gate

- Generated/source-authored boundary không mơ hồ.
- Relation target resolve trong shared budget.
- Unsupported module version safely ignorable.
- External consumer đạt Answer conformance.
- Wire schema đã release immutable theo module version.

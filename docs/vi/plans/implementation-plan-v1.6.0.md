# Kế hoạch triển khai `ail-aadp` 1.6.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Experimental AI Usage Policy |
| Dependency | `AADP-AI-POLICY-001` và legal review |
| Wire impact | Versioned `x_ai_usage`, không đổi core field |

## Scope

- Vocabulary cho discovery, indexing, inference/RAG, training, redistribution,
  commercial use.
- `allowed`/`disallowed`/`conditional`, omit và scope inheritance.
- Attribution, compensation, expiry, jurisdiction, revocation references.
- Conflict evaluation với terms/license/robots/X-Robots-Tag.
- Parser/validator/examples/conformance shape-reference checks.

Metadata là publisher declaration, không phải verified legal right. Conformance
MUST NOT kết luận license có hiệu lực pháp lý.

## Work packages

1. Vocabulary/legal/conflict ADR.
2. Versioned experimental schema/types/fixtures.
3. Pure conflict evaluator và validator.
4. Client exposure không tự enforce ngoài explicit policy.
5. Legal/interoperability review.

## Release gate

- Legal boundary Accepted.
- Conflict/revocation fixtures xanh.
- Unknown condition safely handled.
- Experimental status hiển thị rõ.
- Chỉ xem xét core `ai_usage` ở wire v2.

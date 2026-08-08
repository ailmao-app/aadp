# Kế hoạch triển khai `ail-aadp` 1.4.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Evidence & Provenance Module; generic server module support (kế thừa từ `1.3.0`) |
| Dependency | Relations `1.0` stable; Answer `1.0` stable; citation/claim ADR |
| Wire impact | Module riêng; generic server capability là additive public API của `ail-aadp/server` |
| Nợ kế thừa | Hai release gate của `1.3.0` được defer sang release này — xem [roadmap §10](release-roadmap.md) và [implementation record 1.3.0](../../records/implementation-record-v1.3.0.md) |

## Scope

- **Generic module support ở server layer (kế thừa từ `1.3.0`)**: manifest
  `modules` declaration và extension-field (`x_*`) serialization trong
  `ail-aadp/server`. Generic, KHÔNG Answer/Evidence-specific. Đây là điều kiện
  tiên quyết cho reference deployment của cả hai module, và là khoản nợ phải
  trả cho `1.3.0`.
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
5. **Generic server module support (nợ `1.3.0`)**: thêm manifest `modules`
   declaration và extension-field (`x_*`) serialization vào `ail-aadp/server`
   (`SerializedEntity` hiện chỉ có `id`/`updatedAt`/`canonicalUrl`/`locale`/
   `data`, manifest builder chưa có `modules`). Giữ generic ở server layer;
   KHÔNG hardcode module cụ thể vào example route.
6. **Reference resources (nợ `1.3.0`)**: dựa trên (5), thêm neutral Answer
   resource/repository và Evidence resource vào `examples/reference-server`,
   kèm module declaration trong manifest.
7. Conformance, malicious-citation tests và external reference implementation,
   gồm run `runAnswerConformance` + Evidence conformance từ packed tarball với
   `baseUrl`/`sampleEntityUrl` thật.

## Release gate

- Không dangling reference hoặc unbounded graph.
- Timestamp/canonical target interoperable.
- Answer tham chiếu Evidence không duplicate payload vô hạn.
- Security/privacy review và module conformance xanh.
- **(Nợ `1.3.0`)** Reference server publish được cả Answer lẫn Evidence entity
  qua generic module support ở server layer.
- **(Nợ `1.3.0`)** External conformance chạy từ packed tarball trên reference
  deployment đạt overall `passed` cho Answer `1.0` VÀ Evidence `1.0`. Gate này
  không được đóng bằng mock server hay unit test.

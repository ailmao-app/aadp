# Kế hoạch tích hợp AEO và GEO vào AADP

## 1. Mục tiêu

Xây AEO và GEO thành các **module chuẩn bên trong AADP** để dữ liệu không chỉ **được khám phá** mà còn:

- **Answer-ready (AEO):** máy có thể nhận diện câu hỏi, câu trả lời ngắn, phạm vi áp dụng và entity liên quan.
- **Citation-ready (GEO):** máy có thể truy nguyên claim, evidence, nguồn gốc, thời điểm cập nhật và canonical URL để trích dẫn có kiểm chứng.

Thứ tự bắt buộc:

```text
AADP transport core ổn định
    → AADP Answer Module
    → AADP Evidence & Provenance Module
    → schema + validator + conformance chung
    → reference implementation
    → phát hành AADP có các module chuẩn
    → mapping Ailmao
    → triển khai ailmao-landing
    → đo lường và cải tiến nội dung
```

AEO/GEO không được dùng để sửa nội dung nhằm thao túng engine, tạo claim không có bằng chứng hoặc cam kết chắc chắn về ranking/citation.

## 2. Nguyên tắc thiết kế

1. **AADP vẫn trung lập:** core protocol chỉ giải quyết discovery, enumeration, retrieval, freshness và integrity.
2. **AEO/GEO là module built-in:** schema semantic tách file để dễ bảo trì nhưng được phát hành, discovery, validate và chứng nhận cùng AADP.
3. **Không phải add-on bên ngoài:** server có thể không bật mọi module, nhưng implementation AADP chính thức phải hiểu contract của các module chuẩn.
4. **Giữ compatibility:** nếu wire contract v0.1 đã đóng băng, module được chuẩn hóa trong AADP v0.2; nếu v0.1 vẫn là draft chưa release, đưa module vào release gate v0.1 thay vì tạo protocol khác.
5. **Một nguồn sự thật:** HTML, JSON-LD và AADP representation phải được sinh từ cùng content model để tránh mâu thuẫn.
6. **Evidence-first:** claim quan trọng phải trỏ được tới nguồn; không dùng câu quảng cáo làm fact.
7. **Canonical-first:** mỗi answer, entity, claim và source có canonical ID/URL ổn định.
8. **Freshness rõ ràng:** mọi nội dung phải có `updated_at`; evidence có thêm `last_verified_at` khi cần.
9. **Tôn trọng quyền truy cập:** robots, `X-Robots-Tag`, visibility và license vẫn là policy boundary; AADP không tự cấp quyền sử dụng dữ liệu.

## 3. Kiến trúc tổng thể

```text
Domain content source
        │
        ▼
Content service / repository
        │
        ├── HTML pages
        ├── Schema.org JSON-LD
        ├── XML sitemap / robots
        └── AADP adapter
                │
                ├── AADP Relations Module
                ├── AADP Answer Module (AEO)
                ├── AADP Evidence & Provenance Module (GEO)
                └── AADP entity/sitemap

Change event
        └── IndexNow notifier (tùy chọn, ngoài AADP core)
```

Ranh giới layer:

- AADP transport core chứa envelope, discovery, validator nền, canonicalization và conformance harness.
- Relations là module graph linking dùng chung cho Answer và Evidence modules; thiết kế chi tiết nằm tại [`RELATIONS_MODULE_DESIGN.md`](RELATIONS_MODULE_DESIGN.md).
- Answer và Evidence/Provenance là module chính thức trong cùng AADP package; mỗi module có semantic contract nhưng không chứa type riêng của Ailmao.
- Adapter Ailmao mapping domain data sang module AADP tương ứng.
- Landing route chỉ làm HTTP boundary; business mapping nằm trong `lib/aadp`.
- HTML/JSON-LD và AADP dùng chung content service, không duplicate nội dung trong route.

## 4. AADP Answer Module (AEO)

### 4.1 Resource type đề xuất

Module định nghĩa resource type chuẩn `answer` với payload tối thiểu:

```json
{
  "question": "Ailon là gì?",
  "short_answer": "Ailon là nhân vật AI trong hệ sinh thái Ailmao.",
  "answer": "...",
  "locale": "vi",
  "topics": ["ailon", "ai-character"],
  "about": ["concept:ailon"],
  "canonical_url": "https://example.com/vi/about",
  "evidence": ["claim:ailon-definition"],
  "audience": "public"
}
```

Các invariant:

- `question` là câu hỏi tự nhiên, không phải chuỗi keyword.
- `short_answer` tự đủ nghĩa và có giới hạn độ dài do Answer Module quy định.
- `answer` không được mâu thuẫn với `short_answer`.
- `locale` phải nằm trong locale server công bố.
- `about` chỉ chứa canonical ID hợp lệ.
- Answer có fact kiểm chứng được phải liên kết ít nhất một claim/evidence.
- Nhiều biến thể câu hỏi có thể trỏ về cùng answer canonical, không tạo entity trùng nội dung.

### 4.2 Những gì Answer Module không làm

- Không định nghĩa ranking score.
- Không tự tạo FAQ từ mọi heading.
- Không nhồi keyword hoặc sinh hàng loạt câu hỏi gần giống nhau.
- Không đảm bảo rich result; eligibility vẫn phụ thuộc engine và policy của từng nền tảng.

## 5. AADP Evidence & Provenance Module (GEO)

### 5.1 Resource types đề xuất

Module gồm ba type chuẩn có thể liên kết:

#### `claim`

```json
{
  "statement": "...",
  "subject": "concept:ailon",
  "qualifiers": {},
  "evidence": ["evidence:ailon-definition-source"],
  "valid_from": "2026-07-22T00:00:00Z",
  "last_verified_at": "2026-07-22T00:00:00Z"
}
```

#### `evidence`

```json
{
  "supports": ["claim:ailon-definition"],
  "source": "source:ailmao-about",
  "evidence_type": "first_party_documentation",
  "excerpt_hash": "sha256:...",
  "retrieved_at": "2026-07-22T00:00:00Z"
}
```

#### `source`

```json
{
  "name": "Ailmao About",
  "url": "https://example.com/vi/about",
  "publisher": "Ailmao",
  "published_at": "2026-07-22T00:00:00Z",
  "updated_at": "2026-07-22T00:00:00Z",
  "language": "vi",
  "license": "proprietary-public-read"
}
```

### 5.2 Quy tắc provenance

- Không xuất `confidence` tự chấm như một fact khách quan.
- Phân biệt nguồn first-party, official documentation, primary research và third-party coverage.
- Claim định lượng phải có đơn vị, thời gian đo và methodology hoặc source phù hợp.
- Evidence URL phải là URL public ổn định, không phải URL ký tạm thời.
- Khi source đổi nội dung, cập nhật `excerpt_hash`, `retrieved_at` và checksum.
- Claim hết hiệu lực phải được đánh dấu trạng thái hoặc tombstone theo cơ chế delta sau này; không âm thầm tái sử dụng ID cho nghĩa mới.

## 6. Discovery và module capability

Thiết kế chi tiết của application identity, links, resources, interfaces, security, policies và usage guidance nằm tại [`MANIFEST_V0.2_DESIGN.md`](MANIFEST_V0.2_DESIGN.md). Answer/Evidence là module built-in được manifest công bố; chúng không phải protocol tách rời.

Manifest công bố module bằng identifier chuẩn, không dùng nhãn marketing mơ hồ. Wire contract mục tiêu:

```json
{
  "modules": [
    {
      "id": "aadp:relations",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/relations/v0.1/schema.json"
    },
    {
      "id": "aadp:answer",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/answer/v0.1/schema.json"
    },
    {
      "id": "aadp:evidence",
      "version": "0.1",
      "schema": "https://aadp.dev/schemas/modules/evidence/v0.1/schema.json"
    }
  ]
}
```

Nếu manifest v0.1 chưa cho phép `modules`, giai đoạn thử nghiệm dùng `x_modules`, nhưng artifact release phải chuẩn hóa field này trong cùng version AADP phù hợp. Không phát hành một “AEO protocol” hoặc “GEO protocol” riêng. Không thêm token `aeo` hoặc `geo` trống nghĩa; module declaration phải trỏ tới contract/schema cụ thể.

Sitemap index có thể công bố các type:

- `answer`
- `claim`
- `evidence`
- `source`

Client chỉ hiểu transport core vẫn có thể đọc envelope AADP và bỏ qua module chưa hỗ trợ. Client tuyên bố hỗ trợ `aadp:answer` hoặc `aadp:evidence` phải chạy validator/conformance tương ứng từ cùng package AADP.

Client graph traversal phải hỗ trợ `aadp:relations`, áp dụng depth/request budget và không suy diễn relation từ URL hoặc field domain chưa được khai báo.

## 7. Cấu trúc project AADP dự kiến

```text
aadp/
├── modules/
│   ├── answer/v0.1/specification.md
│   └── evidence/v0.1/specification.md
├── schemas/modules/
│   ├── answer/v0.1/
│   └── evidence/v0.1/
├── examples/modules/
│   ├── answer/v0.1/
│   └── evidence/v0.1/
├── src/modules/
│   ├── answer/
│   └── evidence/
└── tests/
    ├── modules/
    └── conformance/modules/
```

Module validator được export qua package entry point chính thức, ví dụ:

```text
aadp/modules/answer
aadp/modules/evidence
```

## 8. Các phase xây dựng AADP

### Phase AEO/GEO-A0 — Kiến trúc module trong AADP

- Chốt thuật ngữ: answer, claim, evidence, source, provenance, canonical URL.
- Viết ADR về module versioning, module discovery và quan hệ với transport core.
- Viết ADR về source licensing, excerpt hash và dữ liệu hết hiệu lực.
- Lập ma trận với Schema.org/JSON-LD, sitemap, robots và IndexNow để tránh trùng trách nhiệm.
- Chốt threat model: prompt injection trong content, claim giả, source spoofing, stale evidence và mass-generated FAQ.

Đầu ra: semantic model và ranh giới protocol được duyệt.

### Phase AEO/GEO-A1 — Module specification và schema

- Viết normative Answer Module.
- Viết normative Evidence & Provenance Module.
- Tạo JSON Schema cho answer, claim, evidence và source.
- Tạo positive/negative fixtures đa ngôn ngữ.
- Định nghĩa invariant cross-resource mà JSON Schema không kiểm tra được.

Đầu ra: schema validate được, không chứa dependency Ailmao.

### Phase AEO/GEO-A2 — Validator và conformance

- Thêm semantic validator cho canonical ID/type, locale, evidence links và URL.
- Kiểm tra claim reference không bị đứt.
- Kiểm tra checksum thực tế, freshness timestamp và canonical URL.
- Kiểm tra answer có evidence khi chứa claim định lượng/kiểm chứng được.
- Thêm graph-cycle/depth guard khi client duyệt quan hệ.

Đầu ra: module conformance suite trong package AADP chạy được với base URL bất kỳ.

### Phase AEO/GEO-A3 — Reference implementation

- Tạo fixture domain trung lập, không dùng Ailmao.
- Reference server xuất answer → claim → evidence → source.
- Reference client dựng citation chain và kiểm tra provenance.
- Thêm HTML/JSON-LD mapping example để chứng minh cùng nguồn dữ liệu.

Đầu ra: luồng discovery và citation chạy end-to-end.

### Phase AEO/GEO-A4 — Release gate

- AADP transport core release gate vẫn xanh.
- Tất cả example module validate.
- Conformance chạy với paginated và unpaginated sitemap.
- Broken evidence link, stale evidence và checksum sai bị phát hiện.
- Package clean-install và public exports hoạt động.
- Security considerations và changelog AADP chung hoàn chỉnh.

Chỉ sau gate này mới bắt đầu mapping Ailmao.

## 9. Áp dụng cho Ailmao Landing

### Phase B0 — Content inventory

Ưu tiên nội dung có nguồn rõ ràng:

- Ailmao là gì?
- Ailon là gì?
- Cách khám phá/tương tác với Ailon.
- Thông tin public của từng Ailon.
- Chính sách privacy, terms và account deletion.
- Fact của sản phẩm đã có tài liệu chính thức.

Không tự động biến caption/post sáng tạo của Ailon thành fact chính thức hoặc evidence về sản phẩm.

### Phase B1 — Shared content model

Tạo layer dự kiến:

```text
ailmao-landing/lib/content/
├── answers.ts
├── claims.ts
├── sources.ts
└── content-service.ts
```

- Page lấy nội dung từ content service.
- JSON-LD serializer lấy cùng content model.
- AADP serializer lấy cùng content model.
- Không hardcode cùng một answer ở page, JSON-LD và AADP route riêng biệt.

### Phase B2 — HTML và structured data

- Giữ page dễ đọc cho người dùng trước.
- Dùng semantic headings và đoạn trả lời trực tiếp khi phù hợp.
- Ánh xạ Schema.org type phù hợp với nội dung thực tế; không gắn FAQ/Q&A markup nếu page không thật sự có cấu trúc đó.
- Canonical URL, hreflang và locale phải nhất quán với AADP representation.
- Robots và `X-Robots-Tag` tiếp tục kiểm soát indexability.

### Phase B3 — AADP module endpoints

- Manifest công bố các AADP module đã version.
- Sitemap index bổ sung `answer`, `claim`, `evidence`, `source` khi mỗi type có dữ liệu thật.
- Mỗi sitemap item trỏ thẳng tới entity detail; không quảng bá base URL luôn 404.
- Route handler mỏng, gọi `lib/aadp` service/serializer.
- Conformance suite AADP transport core và module đều phải xanh.

### Phase B4 — Freshness notification

- XML sitemap vẫn là kênh discovery chuẩn cho search engine.
- Khi answer/source public được tạo, cập nhật hoặc xóa, có thể gửi canonical HTML URL qua IndexNow.
- Không gửi AADP entity URL thay cho canonical HTML URL nếu engine không công bố hỗ trợ.
- Batch/debounce thay đổi; log submission result nhưng không xem submission là bảo đảm index.

### Phase B5 — Rollout

- Bật feature flag theo resource type.
- Staging smoke test: HTML ↔ JSON-LD ↔ AADP không mâu thuẫn.
- Canary `answer` trước; `claim/evidence/source` sau khi content audit hoàn tất.
- Có rollback bằng cách bỏ sitemap type/capability khỏi manifest/index, không xóa dữ liệu nguồn.

## 10. Kế hoạch kiểm thử

### AADP core/module

- Schema positive/negative fixtures.
- Cross-resource reference integrity.
- Locale và canonical ID consistency.
- Claim/evidence/source checksum correctness.
- Stale/broken source detection.
- Cycle và maximum graph depth.
- Module compatibility với client chỉ hiểu AADP transport core.

### Ailmao

- Snapshot đối chiếu cùng fact giữa HTML, JSON-LD và AADP.
- Không xuất draft/private/deleted/hidden content.
- Không xuất prompt, memory, moderation state hoặc internal identifier.
- Canonical URL/hreflang đúng cho `vi`, `en` và default locale.
- Upstream/content-service failure trả error envelope, không sinh answer rỗng.
- Route không có trong sitemap/module không được quảng bá qua manifest.

## 11. Metrics

### Kỹ thuật

- `module_schema_valid_rate = 100%`.
- `broken_evidence_reference = 0`.
- `html_aadp_content_mismatch = 0` với field thuộc nguồn chung.
- Freshness lag từ source update tới AADP/HTML/sitemap.
- Tỷ lệ 2xx/304/4xx/5xx và cache hit.

### Nội dung

- Tỷ lệ answer có owner, canonical source và ngày review.
- Tỷ lệ claim kiểm chứng được có evidence.
- Số answer trùng nghĩa hoặc outdated.
- Số citation/referral quan sát được theo engine khi dữ liệu đo được phép thu thập.

Không dùng một “GEO score” tự tạo làm tiêu chí release. External visibility/citation là outcome quan sát dài hạn, không phải bằng chứng protocol đúng.

## 12. Thứ tự issue đề xuất

1. `AADP-MODULE-001`: ADR module architecture, discovery và compatibility.
2. `AADP-MODULE-002`: Answer Module specification/schema.
3. `AADP-MODULE-003`: Evidence Module specification/schema.
4. `AADP-MODULE-004`: Semantic validator và graph integrity.
5. `AADP-MODULE-005`: Reference server/client và module conformance.
6. `AADP-MODULE-006`: Security review và phát hành trong AADP release.
7. `AILMAO-AEO-001`: Content inventory và ownership matrix.
8. `AILMAO-AEO-002`: Shared content service và HTML/JSON-LD mapping.
9. `AILMAO-AEO-003`: Answer sitemap/entity adapter.
10. `AILMAO-GEO-001`: Claim/evidence/source mapping và audit.
11. `AILMAO-GEO-002`: Evidence endpoints và module conformance.
12. `AILMAO-DISCOVERY-001`: XML sitemap/IndexNow integration.
13. `AILMAO-AADP-OBS-001`: Metrics, canary và runbook.

## 13. Nguồn tham chiếu

- Google Search Central: robots meta và `X-Robots-Tag` vẫn điều khiển indexability, bao gồm các trải nghiệm AI Search.
- Bing Webmaster: sitemap tiếp tục là cơ chế discovery; IndexNow dùng để thông báo URL mới, cập nhật hoặc xóa.
- Nghiên cứu GEO gốc: tối ưu khả năng hiển thị trong generative engine là bài toán đo lường/quan sát, không phải một wire standard đã ổn định.

Các nguồn này là input để xác định ranh giới. AADP không tuyên bố được Google, Bing hoặc AI assistant hỗ trợ chính thức nếu chưa có xác nhận từ nền tảng đó.

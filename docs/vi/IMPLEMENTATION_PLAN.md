# Kế hoạch triển khai AADP v1.0

> Ngôn ngữ: Tiếng Việt.
>
> Trạng thái: Implementation Draft
> Phạm vi: AADP core, Manifest v1.0, validator, reference client và conformance suite.
> Branch triển khai: `feat/aadp-v1-implementation`
> Tài liệu thiết kế nguồn: [`MANIFEST_V1.0_DESIGN.md`](MANIFEST_V1.0_DESIGN.md).

## Quy ước branch

Branch chính cho kế hoạch này:

```text
feat/aadp-v1-implementation
```

Branch chỉ chứa AADP core v1.0 gồm specification, schema, validator, reference client, conformance suite và tài liệu liên quan. Adapter Ailmao triển khai sau release gate của core nên tách sang branch riêng:

```text
feat/ailmao-aadp-v1-adapter
```

Không trộn refactor hoặc tính năng ngoài phạm vi AADP vào hai branch này. Mỗi phase nên được commit độc lập để có thể review và revert theo ranh giới contract, validator, client và adapter.

## 1. Mục tiêu

Triển khai AADP v1.0 thành package độc lập có thể:

1. Công bố manifest tại `/.well-known/ai-manifest.json`.
2. Validate manifest và các AADP document bằng JSON Schema.
3. Kiểm tra các ràng buộc semantic không thể biểu diễn đầy đủ bằng JSON Schema.
4. Cho phép reference client discovery và đọc resource một cách an toàn.
5. Chạy conformance suite với mock server hoặc một deployment bất kỳ.
6. Được Ailmao sử dụng qua adapter mà không đưa domain Ailmao vào AADP core.

AADP v0.1 chưa có consumer production. Không triển khai dual manifest, content negotiation hoặc migration runtime từ v0.1. Artifact v0.1 được giữ nguyên làm tài liệu lịch sử.

## 2. Quyết định đã chốt

- Wire contract mới dùng `aadp_version: "1.0"`.
- Manifest canonical URL là `/.well-known/ai-manifest.json`.
- URL well-known trả trực tiếp manifest v1.0.
- AADP v1.0 dùng base path convention `/ai/v1.0`.
- `discovery.sitemap_index` là entry point authoritative cho enumeration.
- `sitemap.items[].url` là entity URL authoritative.
- Manifest chỉ công bố endpoint/module đã deploy và đạt conformance.
- `usage_guidance` là untrusted publisher preference, không phải executable instruction.
- Schema, specification, client type và validator được version hóa theo wire contract.
- AADP core không chứa resource schema hoặc business rule riêng của Ailmao.

## 3. Design gate trước khi viết schema

> **Đã đóng** — xem [ADR-0005](adr/0005-manifest-v1-discovery.md) (Accepted)
> và `MANIFEST_V1.0_DESIGN.md` §3a cho quyết định chi tiết của cả 4 mục
> dưới đây. Mục này giữ nguyên làm lịch sử câu hỏi gốc.

Các quyết định sau phải được bổ sung vào `MANIFEST_V1.0_DESIGN.md` và ADR tương ứng trước khi khóa schema:

### 3.1 Localization và language preference

Chốt một trong hai semantics:

- Có `localization` riêng để mô tả locale phục vụ retrieval; `usage_guidance.default_language` chỉ là preference cho AI output.
- Hoặc v1.0 không hỗ trợ localized retrieval và chỉ giữ language preference.

Không dùng một field vừa điều khiển content negotiation vừa là publisher preference.

### 3.2 Resource authority

Khuyến nghị:

- Sitemap index authoritative cho danh sách resource type và sitemap URL.
- `resources[]` chỉ bổ sung metadata theo `type`.
- Không lặp `resources[].sitemap`, tránh hai nguồn dữ liệu lệch nhau.

Nếu vẫn giữ `resources[].sitemap`, semantic validator phải yêu cầu URL và type khớp chính xác với sitemap index.

### 3.3 Security metadata

Chốt phạm vi v1.0:

- Phương án tối thiểu: chỉ hỗ trợ `type: "none"`.
- Phương án đầy đủ: định nghĩa API key placement và tham chiếu OAuth Authorization Server Metadata/OpenAPI security scheme.

Không công bố `api_key` hoặc `oauth2` nếu metadata chưa đủ để client xác định flow.

### 3.4 Root required fields

Lập bảng required/optional cho toàn bộ top-level field. Tối thiểu cần chốt:

- `aadp_version`
- `application`
- `discovery`
- `resources`
- `modules`
- `interfaces`
- `security_schemes`
- `policies`
- `usage_guidance`

Với array/object optional, phải định nghĩa rõ khác biệt giữa field bị omit và giá trị rỗng.

## 4. Kiến trúc triển khai

```text
HTTP/server adapter
        │
        ▼
JSON Schema validation
        │
        ▼
Semantic validation
        │
        ▼
Typed AADP document
        │
        ▼
Reference client / application adapter
```

Ranh giới layer:

- `schemas/`: wire shape, required field, format và extension point.
- `src/validator/`: schema validation và semantic rule thuần.
- `src/client/`: HTTP discovery/retrieval, URL safety và typed result.
- `tests/conformance/`: kiểm tra behavior qua HTTP.
- Ailmao adapter: mapping domain model sang AADP document; nằm ngoài package core.

Validator không tự thực hiện HTTP request. Dead-link, redirect và SSRF checks thuộc conformance/reference-client layer.

## 5. Cấu trúc thư mục mục tiêu

```text
aadp/
├── schemas/
│   ├── v0.1/
│   └── v1.0/
│       ├── manifest.schema.json
│       ├── sitemap-index.schema.json
│       ├── sitemap.schema.json
│       ├── entity.schema.json
│       └── error.schema.json
├── spec/
│   ├── v0.1/
│   └── v1.0/
│       └── specification.md
├── examples/
│   ├── v0.1/
│   └── v1.0/
├── src/
│   ├── client/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── url-policy.ts
│   ├── validator/
│   │   ├── index.ts
│   │   ├── schemas.ts
│   │   ├── semantic.ts
│   │   └── cli.ts
│   └── canonical-json/
└── tests/
    ├── fixtures/
    ├── schema/
    ├── semantic/
    └── conformance/
```

Không bắt buộc tách file nếu implementation còn rất nhỏ, nhưng URL policy và semantic validation phải độc lập để test mà không cần chạy HTTP server.

## 6. Các phase triển khai

### Phase 0 — Khóa contract

Đầu việc:

1. Hoàn tất bốn design gate tại mục 3.
2. Tạo ADR cho Manifest v1.0 và canonical discovery URL.
3. Chốt extension points `x_*` ở từng object.
4. Chốt token grammar cho module ID, resource type, interface ID và security scheme ID.
5. Chốt HTTP content type, cache behavior và maximum response size của manifest.

Đầu ra:

- Design không còn câu hỏi blocking.
- ADR có trạng thái Accepted.
- Có bảng root field đầy đủ.

### Phase 1 — Specification và JSON Schema

Tạo:

- `spec/v1.0/specification.md`
- `schemas/v1.0/manifest.schema.json`
- Các schema v1.0 còn lại nếu envelope thay đổi version.
- Example manifest và discovery documents trong `examples/v1.0/`.

Schema phải kiểm tra:

- `aadp_version` là constant `"1.0"`.
- Required/optional và `additionalProperties`.
- `x_*` extension đúng extension point.
- HTTP(S) URL cho các field yêu cầu web URL.
- Array uniqueness ở nơi JSON Schema có thể xác định.
- Token pattern, min/max length và object/array size hợp lý.
- Security scheme dùng discriminated union theo `type`.

Không đưa vào JSON Schema:

- Kiểm tra reference tồn tại.
- So sánh type giữa nhiều document.
- HTTP reachability.
- Secret scanning hoặc prompt-injection detection.

Acceptance:

- Mọi example hợp lệ pass.
- Mỗi required field có fixture thiếu field và fail.
- Mỗi object đóng có fixture extra field và fail.
- `$id` và internal `$ref` resolve được khi package được build.

### Phase 2 — Version-aware schema validator

Refactor `src/validator/schemas.ts` để không hardcode duy nhất `schemas/v0.1`.

API mục tiêu:

```ts
validateDocument({
  version: "1.0",
  kind: "manifest",
  data
});
```

Yêu cầu:

- Registry schema theo `{version, kind}`.
- Lỗi `unsupported_version` riêng với lỗi `schema_invalid`.
- CLI nhận `--version 1.0` hoặc tự đọc `aadp_version`.
- Giữ validator v0.1 hoạt động để tránh làm hỏng test lịch sử trong repo.
- Không tự fallback từ v1.0 sang v0.1.

Acceptance:

- Unit test cho registry v0.1/v1.0.
- CLI trả exit code khác `0` khi version không hỗ trợ hoặc payload sai.
- Error output chứa JSON pointer và message có thể hành động.

### Phase 3 — Semantic validator

Tạo semantic rule thuần, nhận document đã pass schema và trả danh sách issue.

Rule tối thiểu:

- Default language/locale thuộc danh sách available tương ứng.
- Module ID duy nhất; cặp module ID/version/schema không mâu thuẫn.
- Resource type duy nhất.
- Interface ID duy nhất.
- Mọi `security` reference tồn tại.
- Resource và sitemap-index nhất quán theo authority đã chốt.
- URL không phải placeholder như `example.com` ngoài fixtures/documentation.
- Không có secret-shaped value trong public manifest.
- `usage_guidance` không được client coi là instruction.

Mức lỗi:

- `error`: vi phạm contract hoặc không thể xử lý an toàn.
- `warning`: metadata đáng ngờ nhưng chưa đủ kết luận invalid.

Không dùng regex đơn lẻ để kết luận một đoạn text là prompt injection. Reference client phải luôn coi toàn bộ free text là untrusted, bất kể semantic validator có cảnh báo hay không.

### Phase 4 — TypeScript types và reference client

Tách type v1.0 khỏi type v0.1. Không dùng một interface có nhiều optional field để đại diện đồng thời hai version.

API mục tiêu:

```ts
const manifest = await discover("https://example.com");

if (manifest.aadp_version !== "1.0") {
  throw new UnsupportedAadpVersionError(manifest.aadp_version);
}
```

Reference client phải:

- Fetch đúng `/.well-known/ai-manifest.json`.
- Giới hạn timeout, redirect và response size.
- Chỉ theo HTTP(S).
- Có URL policy injectable cho server-side crawler.
- Chặn private, loopback và link-local destination theo mặc định trong strict mode.
- Validate schema trước khi dùng URL lấy từ document.
- Validate semantic rule trước discovery traversal.
- Phát hiện cursor cycle.
- Không chèn `usage_guidance` vào system/developer prompt.
- Không tự thực thi interface hoặc tool được manifest quảng bá.

Acceptance:

- Test unsupported version.
- Test malformed JSON/content type.
- Test redirect loop, oversized response và timeout.
- Test private-network URL bị chặn trong strict mode.
- Test cursor cycle.
- Test document invalid không được dùng để tiếp tục traversal.

### Phase 5 — Conformance suite

Mở rộng mock server và conformance test cho v1.0.

Nhóm test:

1. Manifest discovery.
2. Schema validity.
3. Semantic reference integrity.
4. Sitemap index → sitemap → entity traversal.
5. HTTP content type và status.
6. Cache validator cho document có checksum.
7. Dead advertised URL.
8. Redirect và SSRF policy.
9. Oversized document.
10. Prompt-like free text vẫn chỉ được xử lý như data.

Chế độ chạy:

```sh
# Self-test bằng mock server
npm test

# Kiểm tra deployment
AADP_BASE_URL=https://example.com \
  npx vitest run tests/conformance/conformance.test.ts
```

Conformance không được yêu cầu truy cập credential thật. Interface cần auth chỉ được kiểm tra public discovery metadata, trừ khi test environment cung cấp credential riêng.

### Phase 6 — Package và tài liệu

Cập nhật:

- `package.json` export schema theo version.
- `README.md`.
- `CHANGELOG.md`.
- CLI help.
- Hướng dẫn server implementation v1.0.

Export mục tiêu:

```text
ail-aadp/client
ail-aadp/validator
ail-aadp/canonical-json
ail-aadp/schemas/v1.0/*
ail-aadp/schemas/v0.1/*
```

Không đổi đường dẫn export hiện có theo cách âm thầm trỏ từ schema v0.1 sang v1.0. Consumer phải chọn version rõ ràng.

Acceptance:

- `npm run build` pass.
- `npm test` pass.
- Package tarball chứa đủ schema/spec/example cần công bố.
- Test import chạy trên tarball, không chỉ trong source tree.

### Phase 7 — Ailmao adapter và staging

Chỉ bắt đầu sau khi AADP core v1.0 đạt release gate.

Adapter Ailmao chịu trách nhiệm:

- Map application/publisher metadata.
- Map resource type đã deploy.
- Sinh sitemap index, sitemap và entity từ domain data.
- Chỉ allow-list field public.
- Công bố policy URL thực tế.
- Không quảng bá MCP/GraphQL/WebSocket/OAuth khi chưa deploy.

AADP core không import model, service hoặc configuration từ Ailmao.

Staging gate:

- `/.well-known/ai-manifest.json` trả manifest v1.0 hợp lệ.
- Không có advertised URL trả generic 404.
- Conformance suite chạy với staging base URL.
- Security review xác nhận không rò credential, private data hoặc internal URL.
- Payload kiểm tra thủ công không chứa field ngoài public allow-list.

## 7. Test matrix tối thiểu

| Layer | Happy path | Failure bắt buộc |
|---|---|---|
| Schema | Manifest/example v1.0 hợp lệ | Missing required, extra field, URL/token sai |
| Semantic | Reference nhất quán | Security/resource/module reference không tồn tại |
| Client | Discovery traversal hoàn chỉnh | Unsupported version, timeout, oversized response |
| URL policy | Public HTTPS URL | Private/link-local, redirect loop, scheme bị cấm |
| Sitemap | Một và nhiều page | Cursor cycle, type mismatch |
| Entity | ID/type/checksum khớp | ID/type/checksum mismatch |
| Conformance | Mock server và staging | Dead URL, sai content type, invalid JSON |

## 8. Release gate v1.0

Chỉ gắn tag/release AADP v1.0 khi:

- ADR và specification v1.0 đã Accepted.
- Schema v1.0 đã khóa và có fixtures đầy đủ.
- Schema validator và semantic validator xanh.
- Reference client không trust hoặc thực thi free text trong manifest.
- SSRF, redirect, timeout và response-size policy có test.
- Conformance suite xanh với mock server.
- Conformance suite xanh với Ailmao staging nếu adapter nằm trong release scope.
- Package build/tarball/import smoke test xanh.
- README và implementation guide phản ánh đúng v1.0.

Sau khi release, schema v1.0 là immutable. Thay đổi schema validation result phải đi qua version mới theo ADR compatibility.

## 9. Thứ tự issue đề xuất

1. `AADP-V1-001`: Khóa design gate và root required fields.
2. `AADP-V1-002`: ADR Manifest v1.0 và canonical discovery.
3. `AADP-V1-003`: Specification và JSON Schema v1.0.
4. `AADP-V1-004`: Version-aware schema registry và CLI.
5. `AADP-V1-005`: Semantic validator.
6. `AADP-V1-006`: TypeScript types và secure reference client.
7. `AADP-V1-007`: Mock server và conformance suite v1.0.
8. `AADP-V1-008`: Package exports, tarball test và documentation.
9. `AILMAO-AADP-V1-001`: Ailmao adapter inventory và public allow-list.
10. `AILMAO-AADP-V1-002`: Staging adapter và conformance rollout.

## 10. Definition of Done

AADP v1.0 được coi là triển khai xong khi một application độc lập có thể dùng package để:

1. Tạo document theo schema v1.0.
2. Validate schema và semantic rule tại CI.
3. Publish manifest tại well-known URL.
4. Được reference client discovery an toàn.
5. Chạy conformance suite mà không cần code hoặc knowledge riêng của Ailmao.

## 11. Roadmap sau AADP v1.0

> Ghi chú định hướng: roadmap này mô tả thứ tự ưu tiên sau khi core v1.0
> đạt release gate. Đây chưa phải cam kết về wire contract hoặc lịch phát hành.

### Ưu tiên 1 — Conformance runner độc lập

> **Đã triển khai** — `AADP-CONFORMANCE-001` và `AADP-CONFORMANCE-002` nằm ở
> `src/conformance/` (runner, checks, report, CLI `aadp-conformance`), test tại
> `tests/conformance/v1.0/runner.test.ts` và clean-install test tại
> `tests/package/conformance-cli.test.ts`. `AADP-CONFORMANCE-003` (report JUnit
> và GitHub Actions example) chưa làm.

Biến conformance suite thành công cụ người triển khai có thể chạy trực tiếp từ
package đã phát hành, không phụ thuộc source tree hoặc Vitest:

```sh
npx aadp-conformance https://example.com
```

Phạm vi đề xuất:

- Cung cấp API programmatic `runConformance(...)`.
- Cung cấp CLI với output terminal, JSON và exit code ổn định cho CI.
- Hỗ trợ chọn protocol version, timeout, traversal budget và page limit.
- Phân biệt rõ `error`, `warning` và `skipped`.
- Thêm clean-install test để xác nhận CLI chạy từ npm tarball.

Conformance check nằm trong service/module riêng; CLI chỉ parse input, gọi runner
và render report.

### Ưu tiên 2 — Server implementation SDK

Cung cấp builder/serializer trung lập để application tạo document AADP an toàn:

- Manifest, sitemap index, sitemap page, entity và error envelope builder.
- Tự động canonicalize payload và sinh checksum khi phù hợp.
- Helper cho timestamp, `ETag`, conditional GET và cache header.
- Validate schema và semantic rule trước khi document được publish.

SDK không phụ thuộc Next.js, Ailmao hoặc domain model cụ thể. Adapter framework
và adapter application phải là layer mỏng nằm bên ngoài core.

### Ưu tiên 3 — Interoperability và production certification

- Tạo reference server trung lập, không dùng dữ liệu hoặc knowledge riêng của Ailmao.
- Chạy conformance định kỳ với deployment staging/production.
- Cung cấp GitHub Actions example và report JSON/JUnit cho CI.
- Kiểm tra external consumer bằng package clean-install.
- Công bố kết quả conformance có version và thời điểm chạy rõ ràng.

Mục tiêu của phase này là chứng minh một bên thứ ba có thể triển khai AADP chỉ
từ specification và package public.

### Ưu tiên 4 — Module versioning và Relations Module

Trước khi triển khai module mới, phải có ADR chốt:

- Quan hệ giữa protocol core version và module version.
- Module discovery, compatibility và export path.
- Cách module mở rộng entity hoặc định nghĩa document riêng.
- Traversal budget, cycle guard và authorization boundary.

Sau ADR, ưu tiên triển khai Relations Module trước Answer Module và Evidence &
Provenance Module, vì các module đó cần một contract liên kết resource thống nhất.
Không dùng lại ví dụ version `0.2` trong design draft như một quyết định mặc định;
version wire/module chính thức phải được chốt qua ADR.

### Ưu tiên 5 — AI Usage Policy Extension

Chuẩn hóa metadata machine-readable để publisher công bố cách dữ liệu có thể được
sử dụng trong các hệ thống AI, tối thiểu gồm discovery, indexing, inference/RAG,
model training, redistribution và commercial use.

Extension này chỉ truyền tải tuyên bố policy của publisher; nó không tự tạo quyền
pháp lý, không xác minh publisher có quyền cấp phép và không thay thế terms hoặc
content license. Mỗi khai báo cấp quyền hoặc đặt điều kiện phải tham chiếu tới văn
bản pháp lý đầy đủ qua `policies.content_license` hoặc một policy URL tương đương.

Trước khi chuẩn hóa field mới, phải có ADR chốt:

- Vocabulary, trạng thái `allowed`/`disallowed`/`conditional` và semantics khi omit.
- Phạm vi áp dụng ở cấp manifest, resource type và entity.
- Điều kiện attribution, compensation, thời hạn, jurisdiction và khả năng thu hồi.
- Quy tắc xử lý xung đột với terms, content license, `robots.txt`,
  `X-Robots-Tag` và resource metadata; mặc định áp dụng policy hạn chế hơn.
- Cách client phân biệt publisher-declared metadata với quyền pháp lý đã được xác minh.
- Versioning và compatibility giữa extension thử nghiệm với AADP core.

Nên thử nghiệm dưới extension `x_ai_usage` của AADP v1.0. Chỉ đưa `ai_usage` thành
field chuẩn trong một protocol version mới sau khi vocabulary, legal review và
interoperability test đã ổn định. Conformance chỉ kiểm tra shape, reference và
conflict semantics; không được tuyên bố một license có hiệu lực pháp lý.

### Thứ tự issue đề xuất

1. `AADP-CONFORMANCE-001`: Programmatic conformance runner.
2. `AADP-CONFORMANCE-002`: CLI `aadp-conformance`.
3. `AADP-CONFORMANCE-003`: JSON/JUnit report và CI example.
4. `AADP-SERVER-001`: Typed document builders.
5. `AADP-SERVER-002`: HTTP cache, checksum và validation helpers.
6. `AADP-INTEROP-001`: Neutral reference server và clean-install verification.
7. `AADP-MODULE-001`: ADR cho module versioning.
8. `AADP-RELATIONS-001`: Relations schema, validator, conformance và client traversal.
9. `AADP-ANSWER-001`: Answer Module.
10. `AADP-EVIDENCE-001`: Evidence & Provenance Module.
11. `AADP-AI-POLICY-001`: ADR cho AI usage vocabulary, legal boundary và conflict semantics.
12. `AADP-AI-POLICY-002`: Experimental `x_ai_usage` schema, validator và examples.
13. `AADP-AI-POLICY-003`: Interoperability, legal review và đề xuất chuẩn hóa cho protocol version mới.

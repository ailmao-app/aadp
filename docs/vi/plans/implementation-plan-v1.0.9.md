# Kế hoạch triển khai `ail-aadp` 1.0.9

## Thông tin tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Implementation Draft |
| Loại release | Patch — interoperability và compatibility hardening |
| Base dự kiến | `develop` sau khi release `1.0.8` hoàn tất |
| Owner quyết định | AADP maintainers |
| Wire contract | AADP v1.0, không thay đổi validation result |
| Tài liệu liên quan | [`implementation-plan.md`](implementation-plan.md), [`../../records/implementation-record-v1.0.md`](../../records/implementation-record-v1.0.md) |

## Abstract

Release `1.0.9` tập trung chứng minh package có thể được một consumer độc lập sử
dụng từ tarball, khóa các public compatibility contract và tăng độ bền bằng test.
Release này MUST NOT thêm wire field/module chuẩn mới, thay đổi schema v1.0 hoặc
đưa vào default runtime behavior có khả năng làm consumer hiện tại thay đổi số
request, timeout hay network access.

## 1. Mục tiêu

1. Khóa public surface để patch release không vô tình breaking consumer.
2. Cung cấp neutral reference server dùng package như một bên thứ ba.
3. Mở rộng robustness corpus cho URL, cursor, JSON, DNS/redirect và JUnit output.
4. Đưa documentation link audit và package verification vào release gate.
5. Chuẩn hóa evidence cho clean-install, conformance và release artifact.

## 2. Ngoài phạm vi

Các hạng mục sau MUST NOT nằm trong `1.0.9`:

- Thay đổi JSON Schema hoặc validation result của AADP v1.0.
- Relations, Answer, Evidence & Provenance hoặc AI Usage Policy Module.
- Authentication flow mới hoặc tự động thực thi interface được quảng bá.
- Retry mặc định, concurrent traversal mặc định hoặc thay đổi traversal order.
- Public API mới cho `AbortSignal` nếu chưa được phân loại SemVer và review riêng.
- Thay đổi stable CLI exit code, conformance check ID hoặc report field.
- Domain model, dữ liệu hoặc business rule riêng của Ailmao.

Feature runtime/API tương thích ngược nhưng có public surface mới SHOULD được gom
vào `1.1.0`. Thay đổi wire contract phải đi qua protocol/module version và ADR.

## 3. Kiến trúc triển khai

```text
examples/reference-server HTTP entry point
                    │
                    ▼
          defineAADP() composition
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
sample repository      public serializer
          │                   │
          └─────────┬─────────┘
                    ▼
          ail-aadp/server runtime

tarball consumer ──► public exports/CLI ──► compatibility assertions
```

Ranh giới layer:

- HTTP entry point chỉ start server, map request/response và đóng resource.
- Sample repository sở hữu data access mẫu; không đặt data lookup trong route.
- Serializer là allow-list boundary duy nhất chuyển record mẫu thành public data.
- `defineAADP()` composition khai báo application, policy, route và resource.
- Compatibility tests chỉ import public package/tarball, không import `src/`.
- Fuzz/property corpus test helper tại layer đang sở hữu behavior; không kiểm tra
  mọi thứ qua end-to-end nếu unit boundary đã đủ.

Không tạo framework adapter mới trong `1.0.9`. Reference server dùng Fetch
`Request`/`Response` và runtime hiện có để giữ framework boundary trung lập.

## 4. Work package A — Public compatibility contract

Issue: `AADP-COMPAT-001`

### 4.1 Public exports

Khóa bằng clean-install/tarball tests:

- Root export `ail-aadp`.
- `ail-aadp/client`, `/client/v0.1`, `/client/v1.0`.
- `ail-aadp/validator`, `/canonical-json`, `/conformance`, `/server`, `/scaffold`.
- Versioned schema export paths.
- Ba binary: `aadp-validate`, `aadp-conformance`, `aadp`.

Test MUST resolve package từ tarball đã pack, không resolve ngược vào source tree.

### 4.2 Stable machine contracts

Thêm assertions cho:

- CLI flags và exit codes đã công bố.
- Validator issue/error codes.
- Conformance check IDs và status values.
- JSON report envelope/version.
- JUnit `testsuite`/`testcase` mapping, escaping và `failOnWarning` semantics.
- Default Server SDK route, cache và error behavior.

Message dành cho người đọc MAY thay đổi nếu machine code/shape giữ nguyên.
Snapshot không được khóa timestamp, request ID hoặc text không thuộc contract.

### 4.3 Acceptance

- Consumer ESM độc lập import được toàn bộ export path công khai.
- CLI trong tarball trả đúng exit code cho success, failure và invalid option.
- JSON/JUnit report parse được và giữ stable identifiers.
- Test thất bại rõ khi export, code hoặc report field bị xóa/đổi tên.

## 5. Work package B — Neutral reference server

Issue: `AADP-INTEROP-001`

### 5.1 Cấu trúc mục tiêu

```text
examples/reference-server/
├── README.md
├── package.json
├── src/
│   ├── server.ts
│   ├── aadp.ts
│   ├── data/
│   │   └── example-repository.ts
│   └── resources/
│       └── example-resource.ts
└── test/
    └── smoke.test.ts
```

Tên file cuối có thể điều chỉnh theo convention của example, nhưng boundary
HTTP/composition/repository/serializer MUST được giữ.

### 5.2 Yêu cầu

- Cài `ail-aadp` từ tarball của working release candidate.
- Không dùng workspace alias hoặc relative import vào `src/`.
- Dùng `defineAADP()`/`defineResource()` và `handleRequest()` public API.
- Có resource public tối giản với serializer allow-list rõ ràng.
- Demonstrate default route và custom route mà không duplicate document builder.
- Không chứa Ailmao knowledge, model hoặc branding phụ thuộc application.
- README hướng dẫn start, validate và chạy `aadp-conformance`.

### 5.3 Verification

```bash
npm pack
npm install ./ail-aadp-1.0.9.tgz
npm run start
npx aadp-conformance http://localhost:<port> --allow-private-network
```

Test automation SHOULD start server trên port động, đợi readiness có deadline,
chạy conformance và luôn đóng server trong cleanup.

### 5.4 Acceptance

- Reference server start từ clean install.
- Manifest → sitemap index → sitemap → entity traversal hoàn chỉnh.
- `aadp-conformance` trả exit code `0` với target mẫu.
- Không có advertised URL `404`.
- Tarball consumer test không phụ thuộc source tree.

## 6. Work package C — Robustness regression corpus

Issue: `AADP-ROBUSTNESS-001A`

### 6.1 Route và URL

- Unicode, space và reserved character trong literal route.
- Malformed hoặc double percent encoding.
- Dot segment, encoded slash/backslash và ambiguous template collision.
- IPv4-mapped IPv6, loopback/link-local và DNS pinning regression.
- Cross-origin redirect không chuyển sensitive header.

### 6.2 Document và traversal

- Deep nesting trong giới hạn parser/runtime hợp lý.
- Oversized response bị dừng trước khi traversal tiếp tục.
- Cursor cycle, cursor mutation và cursor dùng sai resource type/version.
- Invalid document không cung cấp URL cho bước tiếp theo.
- Shared traversal budget không bị reset giữa các sitemap.

### 6.3 Report và CLI

- XML escaping cho suite/check ID, message và details.
- Warning mapping khi `failOnWarning` bật/tắt.
- File output failure không tạo report thành công giả.
- Numeric option từ chối `NaN`, infinity, số âm hoặc non-integer theo contract.

### 6.4 Giới hạn implementation

Work package này ưu tiên test trước. Khi corpus phát hiện bug, fix MUST:

1. Có regression test tối thiểu tái hiện lỗi.
2. Không thay đổi flow/policy ngoài nguyên nhân trực tiếp.
3. Ghi `ERROR_LOG.md` theo quy định repository.
4. Được phân loại SemVer trước khi merge vào `1.0.9`.

## 7. Work package D — Release và documentation hardening

Issue: `AADP-RELEASE-001`

### 7.1 CI/release gate

- Chạy `npm ci`, `npm run docs:check`, `npm run build`, `npm test`.
- Chạy `npm audit --omit=dev` và review exception có owner/thời hạn.
- Chạy `npm pack --dry-run` và tarball clean-install tests.
- Chạy Node version tối thiểu theo `engines` và Node version CI chính.
- Xác nhận package version, lockfile, tag và changelog khớp.
- Ưu tiên trusted publishing/provenance nếu npm/GitHub configuration đã sẵn sàng.

Trusted publishing là thay đổi vận hành có quyền ghi. Nếu credential, environment
hoặc approval policy chưa được chốt, task MUST dừng ở tài liệu/workflow proposal,
không tự bật publish.

### 7.2 Documentation

- Index reference server trong README và `docs/README.md`.
- Cập nhật implementation record với evidence `1.0.9`.
- Ghi rõ `1.0.9` không đổi AADP wire version `1.0`.
- Giữ `docs:check` xanh sau mọi move/rename.
- Không cập nhật historical snapshot bằng dữ liệu release hiện tại.

## 8. Test matrix

| Layer | Happy path | Failure bắt buộc |
|---|---|---|
| Package exports | Import mọi public path từ tarball | Missing/renamed export |
| CLI contract | Stable flag/output/exit code | Invalid option, write failure |
| JSON/JUnit | Report parse được | Escape, warning/failure mapping sai |
| Reference server | Full conformance traversal | Dead advertised URL, invalid document |
| Route policy | Default và custom route | Unicode/escape/collision/path traversal |
| URL/DNS | Public target hợp lệ | Private/link-local/rebinding/cross-origin header |
| Traversal | Nhiều sitemap/page trong budget | Cycle, oversized, budget reset |
| Documentation | Mọi relative link resolve | Link hỏng hoặc source path cũ |
| Clean install | Consumer chỉ dùng tarball | Import ngược source/workspace |

## 9. Thứ tự triển khai

1. `AADP-109-001`: Public export và machine-contract inventory.
2. `AADP-109-002`: Tarball compatibility tests.
3. `AADP-109-003`: Neutral reference server.
4. `AADP-109-004`: Automated reference-server conformance smoke test.
5. `AADP-109-005`: Robustness/fuzz regression corpus.
6. `AADP-109-006`: CI, docs-check và package verification gate.
7. `AADP-109-007`: Documentation, changelog và release candidate.

Dependency:

```text
109-001 ──► 109-002 ──┐
                      ├──► 109-006 ──► 109-007
109-003 ──► 109-004 ──┤
109-005 ──────────────┘
```

`109-001`, `109-003` và phần test-design của `109-005` có thể làm song song sau
khi inventory public contract được thống nhất.

## 10. Commit boundary đề xuất

1. `test(package): lock public compatibility contracts`
2. `feat(examples): add neutral AADP reference server`
3. `test(interop): verify tarball reference server conformance`
4. `test(robustness): expand protocol regression corpus`
5. `ci: verify docs and package release artifacts`
6. `docs: document 1.0.9 interoperability hardening`
7. `chore(release): prepare 1.0.9`

Nếu robustness corpus phát hiện bug, commit fix và `ERROR_LOG.md` SHOULD tách khỏi
commit thêm corpus để review root cause rõ ràng.

## 11. Release gate 1.0.9

Chỉ tạo tag `1.0.9` khi:

- Không có thay đổi validation result của schema v1.0.
- Public compatibility contract tests xanh từ tarball.
- Neutral reference server đạt conformance bằng CLI đã pack.
- Robustness regression corpus xanh.
- `npm run docs:check`, build, test và audit xanh.
- Tarball chỉ chứa artifact chủ đích và smoke test clean-install xanh.
- Changelog phân biệt rõ fix, test, docs và operational hardening.
- Package version, lockfile, Git tag và release notes khớp nhau.
- Mọi exception bảo mật/release có owner, lý do và thời hạn.

## 12. Definition of Done

`ail-aadp@1.0.9` hoàn tất khi một consumer độc lập có thể cài tarball, chạy
neutral reference server, kiểm tra deployment bằng `aadp-conformance`, parse
JSON/JUnit report trong CI và dựa vào public exports/error/check IDs đã được khóa
bằng regression tests — không cần source tree hoặc knowledge riêng của Ailmao.

## 13. Hạng mục chuyển sang 1.1.0

- Public cancellation/`AbortSignal` API xuyên suốt traversal.
- Configurable concurrency scheduler.
- Retry/backoff/`Retry-After` policy.
- Tổng byte budget cho toàn traversal nếu enforcement có thể làm consumer hiện tại fail.
- Conformance certification profiles có semantics công khai mới.
- Module versioning, Relations, Answer, Evidence và AI Usage Policy.

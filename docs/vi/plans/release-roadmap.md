# Roadmap phát hành package `ail-aadp`

## Thông tin tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Planning Draft |
| Phạm vi | npm package từ `1.0.8` đến `2.0.0` |
| Owner quyết định | AADP maintainers |
| Wire contract hiện hành | AADP `1.0` |
| Plan chi tiết gần nhất | [`implementation-plan-v1.0.9.md`](implementation-plan-v1.0.9.md) |

## 1. Quy tắc versioning

Version npm package và AADP wire contract có lifecycle riêng:

```text
ail-aadp@1.0.9   package version
aadp_version=1.0 wire version
```

Tăng package lên `1.1.0` hoặc `1.2.0` MUST NOT tự động đổi
`aadp_version`. Released schema AADP v1.0 tiếp tục immutable; thay đổi validation
result của wire schema cần protocol/module version và ADR riêng.

Quy tắc SemVer cho package:

- `1.0.x`: bug fix, test, documentation, interoperability và release hardening;
  không thêm default behavior có rủi ro làm consumer thay đổi.
- `1.1.0`: public API/runtime capability mới nhưng tương thích ngược và opt-in.
- `1.1.x`: sửa lỗi và ổn định capability của `1.1.0`.
- `1.2.0`: module infrastructure/extension capability mới sau ADR và
  interoperability gate; vẫn không được âm thầm sửa core schema v1.0.
- `2.0.0`: chỉ dùng khi package API hoặc contract mặc định có breaking change.

Không tạo release rỗng chỉ để đạt số version trong roadmap. Patch milestone chỉ
được mở khi có issue/evidence cụ thể và có thể bị bỏ qua nếu không còn việc hợp lệ.

## 2. Tổng quan roadmap

| Package version | Chủ đề | Trạng thái dự kiến | Wire impact |
|---|---|---|---|
| `1.0.8` | JUnit report và CI example | Release hiện tại | Không |
| `1.0.9` | Compatibility và interoperability hardening | Đã có implementation plan | Không |
| `1.0.10` | Robustness fixes từ corpus/consumer feedback | Có điều kiện | Không |
| `1.0.11` | Production certification và release operations | Có điều kiện | Không |
| `1.1.0` | Bounded traversal controls và conformance profiles | Planned minor | Không đổi core schema |
| `1.1.x` | Stabilization cho public API 1.1 | Có điều kiện | Không |
| `1.2.0` | Module infrastructure và Relations pilot | Chờ ADR | Extension/module riêng |
| `1.3.0` | Answer Module | Chờ Relations ổn định | Module riêng |
| `1.4.0` | Evidence & Provenance Module | Chờ Answer/Relations | Module riêng |
| `1.5.0` | Cross-module graph traversal và composition | Chờ ba module ổn định | Không đổi core schema |
| `1.6.0` | Experimental AI Usage Policy | Chờ ADR và legal review | `x_ai_usage` experimental |
| `1.7.0` | Auth-aware retrieval helpers | Chờ security ADR | Không đổi manifest schema |
| `1.8.0` | Certification và implementation attestations | Chờ nhiều implementation | Report/profile contract |
| `1.9.0` | AADP v2 preview và migration tooling | Chờ v2 design gates | Preview, không claim v2 stable |
| `2.0.0` | Package/API cleanup và AADP v2 support | Chờ migration evidence | Breaking/package + wire v2 |

## 3. Release 1.0.8 — JUnit và CI integration

Trạng thái: release candidate/release hiện tại.

Đã triển khai:

- `renderJUnitReport`.
- `aadp-conformance --junit <file>`.
- JSON và JUnit report dùng song song.
- GitHub Actions example cho deployment conformance.
- Clean-install tests cho CLI/report.

Gate trước release:

- Không đưa thêm feature mới ngoài blocker fix.
- Changelog, package/lockfile và tag phải khớp `1.0.8`.
- Build/test/tarball verification xanh.

## 4. Release 1.0.9 — Compatibility và interoperability

Plan chi tiết:
[`implementation-plan-v1.0.9.md`](implementation-plan-v1.0.9.md).

Scope chính:

- Public export và machine-contract regression tests.
- Neutral reference server.
- Tarball consumer/conformance verification.
- Robustness corpus không đổi policy mặc định.
- Documentation/release gate hardening.

Không thêm retry, concurrency hoặc module mới.

## 5. Release 1.0.10 — Robustness fixes

Trạng thái: conditional patch.

Chỉ mở milestone khi corpus `1.0.9`, reference consumer hoặc production feedback
phát hiện bug tương thích patch. Candidate scope:

- URL/route canonicalization edge cases.
- DNS pinning, redirect hoặc sensitive-header regression.
- Cursor/budget accounting bug.
- Public resource bị phân loại private/no-store chỉ vì `security` reference trỏ
  tới scheme `type: "none"`.
- JSON/JUnit escaping hoặc CLI file-output bug.
- Package export/tarball portability bug trên Node version được support.
- Documentation correction đi kèm behavior đã release.

Mỗi bug fix MUST có:

1. Reproduction test.
2. Root cause.
3. Entry trong `ERROR_LOG.md`.
4. SemVer assessment xác nhận không breaking.

Nếu không có bug phù hợp, bỏ qua `1.0.10` và chuyển thẳng sang `1.1.0`.

## 6. Release 1.0.11 — Production certification

Trạng thái: conditional patch; có thể gộp vào `1.0.10` hoặc bỏ qua.

Candidate scope không đổi runtime contract:

- Neutral reference server chạy định kỳ trên CI/staging.
- Scheduled `aadp-conformance` report có package/protocol version và timestamp.
- JSON/JUnit artifact retention.
- Clean-install verification trên Node matrix được support.
- npm trusted publishing/provenance nếu quyền và environment đã được maintainer chốt.
- Release/deprecation/rollback runbook và audit evidence.

Không đưa observability API, certification profile public mới hoặc credential
workflow mới vào patch này. Nếu cần public API/config mới, chuyển sang `1.1.0`.

## 7. Release 1.1.0 — Bounded traversal controls

Trạng thái: planned minor.

Mục tiêu: bổ sung capability opt-in cho consumer vận hành crawler/reference
client an toàn hơn mà không thay đổi AADP wire v1.0.

Candidate scope:

- Public cancellation bằng `AbortSignal` xuyên suốt request và traversal.
- Configurable concurrency limit; default bảo toàn behavior 1.0.x.
- Retry/backoff/`Retry-After` policy opt-in, có request budget chung.
- Tổng response-byte budget cho toàn traversal.
- Conformance profiles được định nghĩa rõ: `core`, `public-web`,
  `full-traversal`, `authenticated`.
- Report ghi profile và effective limits để CI có thể audit.

Kiến trúc:

```text
CLI/options boundary
       │
       ▼
Traversal policy/service
       │
       ├── request budget
       ├── byte/deadline budget
       ├── concurrency scheduler
       ├── retry policy
       └── cancellation
       │
       ▼
HTTP client + URL/DNS policy
```

CLI chỉ parse/render. Policy, scheduler và budget nằm trong module độc lập để test
không cần HTTP server. Retry MUST không vượt request budget và MUST không gửi lại
credential sang origin khác.

Release gate:

- Default config giữ behavior tương thích 1.0.x.
- Cancellation dừng cả header/body/traversal work.
- Concurrency/retry deterministic trong test.
- Không có unbounded queue/timer/request.
- Public API, CLI và report documentation hoàn chỉnh.
- Clean-install và conformance tests xanh.

## 8. Release 1.1.x — Stabilization

Các patch sau `1.1.0` không được pre-allocate cứng. Chỉ phát hành khi có bug hoặc
portability issue cụ thể, ví dụ:

- Abort/cancellation race.
- Retry budget accounting sai.
- Concurrency starvation hoặc cleanup leak.
- Profile/report compatibility bug.
- Node/runtime portability issue.

Không dùng `1.1.x` để thêm module wire mới.

## 9. Release 1.2.0 — Module infrastructure và Relations pilot

Trạng thái: blocked bởi ADR module versioning.

Dependency bắt buộc:

1. ADR quan hệ giữa core protocol version và module version.
2. Module discovery/compatibility/export-path rules.
3. Extension/document envelope boundary.
4. Authorization, traversal budget và cycle semantics.

Candidate scope sau khi ADR Accepted:

- Module registry theo `{moduleId, moduleVersion, kind}`.
- Version-aware module schema/validator registry.
- Client helper opt-in; core-only client bỏ qua unknown module an toàn.
- Module conformance extension không làm thay đổi core check IDs.
- Relations Module pilot: typed relation, canonical target và paginated
  collection.
- Neutral fixtures/reference implementation cho Relations.

Không mặc định đưa Answer/Evidence vào cùng `1.2.0`. Chỉ thêm khi Relations và
module infrastructure đã đạt interoperability gate; nếu không, chuyển sang minor
sau.

Wire/version rule:

- Package MAY là `ail-aadp@1.2.0` trong khi core vẫn `aadp_version: "1.0"`.
- Relations phải có module ID/version riêng.
- Không thêm field core chuẩn mới vào schema AADP v1.0.
- Experimental metadata chỉ dùng extension point đã được schema cho phép và phải
  được ghi rõ non-normative.

Release gate:

- ADR module versioning Accepted.
- Module schema, types, validator, client và conformance cùng version.
- Unknown module safely ignorable.
- Traversal có depth/request/byte budget và cycle guard.
- Cross-module/core compatibility tests xanh.
- External reference implementation đạt module conformance.

## 10. Release 1.3.0 — Answer Module

Trạng thái: blocked bởi `1.2.0` Relations interoperability gate.

Issue coverage:

- `AADP-MODULE-002`: Answer specification/schema.
- Phần Answer của `AADP-MODULE-004`: semantic validation.
- Phần Answer của `AADP-MODULE-005`: reference client/server và conformance.

Candidate scope:

- Module ID/version và schema riêng cho Answer.
- Resource contract cho question, concise answer, applicability và related entity.
- Phân biệt source-authored answer với generated summary.
- Locale, freshness và canonical URL semantics.
- Semantic validator cho relation/reference integrity.
- Typed client helper opt-in và module conformance checks.
- Neutral fixtures/reference resource; không dùng Ailmao domain.

Không làm:

- Không tự generate answer bằng model trong AADP core.
- Không ranking/search engine optimization score.
- Không coi Answer free text là trusted instruction.
- Không bắt core-only client hiểu Answer Module.

Release gate:

- Relations target resolve và cycle/budget policy xanh.
- Unknown/unsupported Answer version safely ignorable.
- Schema, validator, types, client và conformance cùng module version.
- Generated/source-authored distinction không mơ hồ.
- External consumer clean-install đạt module conformance.

## 11. Release 1.3.x — Answer stabilization

Conditional patches chỉ sửa:

- Answer schema implementation bug không đổi released validation result.
- Locale/freshness/reference helper bug.
- Module conformance false positive/negative.
- Cross-runtime/type/export portability.

Thay đổi Answer wire schema sau release phải bump module version, không âm thầm
sửa artifact đã công bố.

## 12. Release 1.4.0 — Evidence & Provenance Module

Trạng thái: blocked bởi citation/claim ADR và stable Relations target model.

Issue coverage:

- `AADP-MODULE-003`: Evidence specification/schema.
- Phần Evidence của `AADP-MODULE-004/005/006`.

Candidate scope:

- Resource contract cho `claim`, `evidence` và `source`.
- Claim-to-evidence và evidence-to-source reference integrity.
- Canonical citation target, publisher, published/updated/retrieved timestamps.
- Evidence type, support/contradict/neutral stance và confidence provenance.
- Freshness/staleness metadata không tự suy diễn truth.
- Typed client helpers và conformance traversal theo budget.
- Security review cho malicious citation, private source và provenance spoofing.

Không làm:

- Không tuyên bố evidence là đúng chỉ vì schema hợp lệ.
- Không download/execute arbitrary source content ngoài explicit client policy.
- Không biến checksum thành chữ ký/xác thực publisher.

Release gate:

- Claim/evidence/source graph không dangling hoặc cycle ngoài policy.
- Citation URL qua URL/DNS policy.
- Provenance timestamps và canonical target có fixtures đa implementation.
- Answer có thể tham chiếu Evidence mà không duplicate evidence payload vô hạn.
- Module conformance và security review xanh.

## 13. Release 1.4.x — Evidence stabilization

Conditional patches cho graph integrity, citation portability, timestamp parsing,
reporting và conformance correctness. Không thêm vocabulary wire mới trong patch.

## 14. Release 1.5.0 — Cross-module graph traversal

Mục tiêu: cung cấp application service/client orchestration thống nhất sau khi
Relations, Answer và Evidence đều ổn định.

Candidate scope:

- Module registry và capability negotiation qua module ID/version.
- Typed traversal plan: entity → relations → answer → claim/evidence/source.
- Shared depth/request/entity/byte/deadline budget.
- Cross-module cycle guard và deduplication theo canonical target.
- Partial result với issue provenance khi module không support hoặc traversal bị cắt.
- Cross-module conformance profile và stable report IDs.
- Streaming/iterator API không giữ toàn graph trong memory.

Kiến trúc:

```text
consumer command
      │
      ▼
graph traversal service
      ├── module registry
      ├── traversal/budget policy
      ├── dedupe/cycle guard
      └── typed partial result
      │
      ▼
versioned module clients ──► core HTTP/URL policy
```

Business interpretation, ranking và application knowledge MUST nằm ngoài graph
traversal service.

Release gate:

- Không có unbounded traversal/memory accumulation.
- Core-only và single-module consumer không regression.
- Deterministic ordering hoặc ordering semantics được tài liệu hóa.
- Partial/inconclusive result không bị báo thành conformant hoàn chỉnh.
- Interoperability test với ít nhất hai reference data sets trung lập.

## 15. Release 1.5.x — Cross-module stabilization

Conditional patches cho budget accounting, cycle/dedupe, streaming cleanup,
partial-result mapping và module-version compatibility.

## 16. Release 1.6.0 — Experimental AI Usage Policy

Trạng thái: blocked bởi `AADP-AI-POLICY-001` và legal review.

Issue coverage:

- `AADP-AI-POLICY-001`: vocabulary/legal/conflict ADR.
- `AADP-AI-POLICY-002`: experimental `x_ai_usage` schema, validator và examples.
- `AADP-AI-POLICY-003`: interoperability/legal review và chuẩn hóa proposal.

Candidate scope:

- Experimental `x_ai_usage` vocabulary cho discovery, indexing, inference/RAG,
  training, redistribution và commercial use.
- `allowed`/`disallowed`/`conditional`, omit semantics và scope inheritance.
- Attribution, compensation, expiry, jurisdiction và revocation references.
- Conflict evaluation với terms, content license, `robots.txt`, `X-Robots-Tag`;
  policy hạn chế hơn thắng theo ADR.
- Typed parser/validator và conformance shape/reference checks.
- Explicit marker: publisher-declared metadata, không phải verified legal right.

Không chuẩn hóa thành core field trong package 1.x. `ai_usage` không có prefix chỉ
được xem xét trong AADP wire v2 sau legal/interoperability evidence.

Release gate:

- Legal boundary và conflict semantics được ADR Accepted.
- Không có claim “license hợp pháp” từ conformance output.
- Unknown condition safely preserved/ignored theo contract.
- Interoperability fixtures gồm conflict và revocation cases.
- Public docs ghi experimental status rõ ràng.

## 17. Release 1.6.x — AI policy stabilization

Conditional patches cho parser, conflict evaluator, reference validation và
documentation/legal wording. Vocabulary breaking change phải bump extension
version, không sửa cùng version.

## 18. Release 1.7.0 — Auth-aware retrieval helpers

Mục tiêu: hỗ trợ consumer chủ động cung cấp credential cho resource đã khai báo
security metadata, nhưng không auto-login hoặc auto-execute interface.

Blocked bởi security ADR chốt:

- Credential provider boundary.
- Header/query placement và redirect stripping.
- OAuth token acquisition nằm trong hay ngoài package.
- Scope selection, refresh lifecycle và log/report redaction.

Candidate scope an toàn:

- Injectable credential provider theo security scheme ID.
- Request decoration sau schema/semantic validation.
- Credential chỉ gửi tới allowed origin/path và bị loại khi cross-origin redirect.
- Secret redaction trong errors, JSON/JUnit report và debug hooks.
- Explicit unauthenticated/authenticated conformance profile.
- Test credential giả; không yêu cầu credential production.

Khuyến nghị giữ OAuth token acquisition ngoài core; package nhận token/provider
từ application. Nếu muốn SDK tự chạy OAuth flow, cần security review và minor
riêng thay vì scope creep vào `1.7.0`.

Release gate:

- Không credential leakage qua redirect/log/report/error.
- Provider lifecycle/cancellation rõ ràng.
- Default client không gửi credential và giữ behavior 1.6.x.
- Authenticated resource failure phân biệt auth error với protocol invalid.

## 19. Release 1.7.x — Authentication stabilization

Conditional security patches cho origin scoping, redaction, provider cleanup và
auth error mapping. Security fix có breaking implication phải có migration notice
và review riêng.

## 20. Release 1.8.0 — Certification và attestations

Mục tiêu: chuẩn hóa cách ghi nhận một implementation đã chạy conformance, không
tuyên bố nội dung/trust/legal validity vượt quá phạm vi test.

Candidate scope:

- Versioned certification profile registry.
- Machine-readable attestation chứa target, protocol/module/package version,
  profile, effective limits, timestamp và report digest.
- JSON/JUnit report archive conventions và verification helper.
- Scheduled conformance reference workflow.
- Badge/status endpoint example chỉ phản ánh lần chạy và scope cụ thể.
- Revocation/expiry semantics cho attestation cũ.

Không làm:

- Không ký thay publisher nếu chưa có signing ADR/key policy.
- Không coi conformance là chứng nhận accuracy, license hoặc security toàn hệ thống.
- Không công bố production target nếu owner chưa cho phép.

Release gate:

- Có ít nhất hai implementation/deployment độc lập làm input.
- Profile/check IDs và attestation schema versioned.
- Inconclusive/skipped không được chuyển thành pass.
- Privacy và retention review hoàn tất.

## 21. Release 1.8.x — Certification stabilization

Conditional patches cho report digest, expiry/revocation, CI portability và
profile compatibility.

## 22. Release 1.9.0 — AADP v2 preview và migration tooling

Mục tiêu: thử nghiệm v2 mà không claim stable và chuẩn bị consumer cho breaking
package cleanup.

Blocked bởi ADR v2 chốt ít nhất:

- Vấn đề v1 không thể giải quyết bằng module/extension.
- Trường/semantics được thêm, đổi hoặc loại bỏ.
- Quan hệ core version với module versions.
- Security/auth/policy boundary.
- Compatibility window và deprecation timeline.

Candidate scope:

- `experimental/v2` schema/types/validator/client namespace.
- Thử nghiệm `application.profile`, default security và effective-security
  inheritance theo `AADP-PROFILE-001`; không sửa schema v1.0.
- v1 → v2 compatibility analyzer; không silent migration.
- CLI `--version 2.0-preview` yêu cầu opt-in rõ.
- Dual-version neutral fixtures và conformance preview profile.
- Deprecation warnings cho package API dự kiến bị xóa ở 2.0.
- Migration guide và codemod chỉ cho đổi mechanical, không tự quyết business rule.

Không đổi unversioned exports trong `1.9.0`. Preview artifact MUST ghi rõ mutable,
không dùng làm production certification.

Release gate:

- V2 design/ADR Proposed hoặc Accepted theo policy dự án.
- Preview namespace không ảnh hưởng v1 consumer.
- Analyzer phát hiện loss/ambiguity và yêu cầu user quyết định.
- Migration guide có clean consumer example.

## 23. Release 1.9.x — Preview iterations

Preview MAY có breaking change trong namespace experimental nếu status và
changelog ghi rõ, nhưng stable v1/package API vẫn theo SemVer. Khi v2 contract
freeze, ngừng thêm feature và chỉ nhận blocker fixes trước 2.0.

## 24. Release 2.0.0 — Stable v2 và package cleanup

Trạng thái: breaking release; chỉ mở sau migration evidence từ 1.9.x.

Candidate breaking scope đã biết:

- Stable AADP wire v2 schema/spec/types/validator/client/conformance.
- Application profile, default security và resource/interface override chỉ khi
  `AADP-PROFILE-001` đã Accepted và preview có interoperability evidence.
- Chuẩn hóa feature đã chứng minh từ module/extension khi ADR v2 yêu cầu; ví dụ
  `ai_usage` chỉ khi vocabulary/legal/interoperability đã ổn định.
- Đổi unversioned/default client export khỏi legacy v0.1 theo migration policy.
- Loại hoặc deprecate dứt điểm `./schemas/*` alias đang ngầm trỏ v0.1.
- Xóa public API/CLI alias đã deprecate từ 1.9.x.
- Thống nhất error/report contract major mới nếu có finding thực tế.
- Giữ explicit versioned entry points cho version còn trong support window.

Không bắt buộc gom mọi module vào core v2. Module vẫn độc lập nếu không có lý do
interoperability để chuẩn hóa.

Migration requirements:

- Bảng mapping v1/v2 và danh sách non-migratable decisions.
- Codemod/analyzer không làm mất dữ liệu im lặng.
- Parallel validation/conformance trong compatibility window.
- Clean-install examples cho v1 consumer pin version và v2 consumer mới.
- Deprecation timeline, rollback và security support policy.

Release gate:

- V2 specification/ADRs Accepted và schema frozen.
- Ít nhất hai implementation độc lập đạt v2 conformance.
- Module compatibility matrix hoàn chỉnh.
- Security, privacy và legal review cho field/policy mới.
- Migration rehearsal từ real v1 fixtures không có silent data loss.
- Package API diff và breaking-change guide được review.
- Tag/package/spec/schema/changelog/provenance khớp.

## 25. Feature coverage đến 2.0.0

| Feature/issue family | Release đích | Trạng thái coverage |
|---|---|---|
| JUnit/CI conformance | `1.0.8` | Đã triển khai |
| Compatibility/neutral reference server | `1.0.9` | Đã có plan chi tiết |
| Robustness/production operations | `1.0.10–1.0.11` | Conditional patch |
| `AADP-ACCESS-001` explicit `none` cache semantics | `1.0.10` hoặc patch phù hợp gần nhất | Chờ reproduction test |
| Abort/concurrency/retry/byte budget/profiles | `1.1.0` | Planned |
| `AADP-MODULE-001`, `AADP-REL-001..006` | `1.2.0` | Chờ ADR |
| `AADP-MODULE-002` Answer | `1.3.0` | Chờ Relations |
| `AADP-MODULE-003` Evidence & Provenance | `1.4.0` | Chờ citation/claim ADR |
| `AADP-MODULE-004..006` cross-module completion | `1.3.0–1.5.0` | Chia theo module/orchestration |
| Graph traversal/composition | `1.5.0` | Planned |
| `AADP-AI-POLICY-001..003` | `1.6.0` | Chờ legal/ADR |
| Auth-aware retrieval | `1.7.0` | Chờ security ADR |
| Production certification/attestation | `1.8.0` | Chờ external implementations |
| `AADP-PROFILE-001..003` Content Site/default access | `1.9.0` preview → `2.0.0` stable | Chờ ADR và scanner interoperability |
| V2 preview/migration tooling | `1.9.0` | Chờ v2 ADR |
| Stable wire v2/package breaking cleanup | `2.0.0` | Chờ migration evidence |
| `AILMAO-*` adapter/content/HTML/IndexNow/metrics | Ngoài package core | Theo dõi ở project Ailmao |

Bảng trên bao phủ toàn bộ feature family hiện được ghi trong design/implementation
plan của repository. Feature mới phát sinh sau này phải được inventory và phân
loại lại; tài liệu này không tuyên bố backlog tương lai bất biến.

## 26. Promotion rule giữa các release

Một hạng mục được chuyển release khi:

- Từ patch sang minor: có public API/capability mới hoặc default behavior mới.
- Từ minor sang patch: chỉ còn bug fix tương thích và regression test.
- Sang protocol/module version: thay đổi wire validation, semantics hoặc
  interoperability contract.
- Defer: thiếu ADR, external evidence, legal/security decision hoặc owner.

Maintainer MUST review promotion rule trước khi tạo branch release. Không đổi tên
issue hoặc bump version chỉ để né SemVer classification.

## 27. Branch và merge strategy

```text
develop
  ├── feat/<bounded-feature>
  ├── fix/<specific-root-cause>
  └── docs/<document-scope>
          │
          ▼
       develop
          │
          ▼
release/<package-version>
          │
          ├── release gate only
          └── blocker fixes only
```

- Feature/fix branch MUST bắt đầu từ `develop` mới nhất.
- Feature đã merge trước thì docs branch rebase lên `develop` để phản ánh trạng
  thái cuối, tránh phục hồi đường dẫn/nội dung cũ.
- Release branch không nhận scope mới sau freeze.
- Rebase branch cá nhân dùng `--force-with-lease`; không rewrite shared release
  history.

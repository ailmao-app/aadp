# Roadmap phát hành package `ail-aadp`

## Thông tin tài liệu

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Active Planning Record |
| Phạm vi | npm package từ `1.0.8` đến `2.0.0` |
| Owner quyết định | AADP maintainers |
| Wire contract hiện hành | AADP `1.0` |
| Release hiện hành | `ail-aadp@1.4.0`, AADP wire `1.0` |
| Plan đang chuẩn bị | [`implementation-plan-v1.5.0.md`](implementation-plan-v1.5.0.md) |

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
| `1.0.8` | JUnit report và CI example | Đã phát hành | Không |
| `1.0.9` | Compatibility và interoperability hardening | Đã phát hành | Không |
| `1.0.10` | Robustness fixes từ corpus/consumer feedback | Đã phát hành | Không |
| `1.0.11` | Production certification và release operations | Đã phát hành | Không |
| `1.1.0` | Bounded traversal controls và conformance profiles | Đã phát hành | Không đổi core schema |
| `1.1.x` | Stabilization cho public API 1.1 | Có điều kiện | Không |
| `1.2.0` | Module infrastructure và Relations pilot | Đã phát hành (2026-08-06) | Extension/module riêng |
| `1.3.0` | Answer Module | Đã phát hành (2026-08-06); `1.3.1` security patch (2026-08-08) | Module riêng |
| `1.4.0` | Evidence & Provenance Module | Gates closed (2026-08-10); chờ release verification trên commit được tag | Module riêng |
| `1.5.0` | Cross-module graph traversal và composition | Blocked ở ADR-0011 (Proposed) | Không đổi core schema |
| `1.6.0` | Experimental AI Usage Policy | Chờ ADR và legal review | `x_ai_usage` experimental |
| `1.7.0` | Auth-aware retrieval helpers | Chờ security ADR | Không đổi manifest schema |
| `1.8.0` | Certification và implementation attestations | Chờ nhiều implementation | Report/profile contract |
| `1.9.0` | AADP v2 preview và migration tooling | Chờ v2 design gates | Preview, không claim v2 stable |
| `2.0.0` | Package/API cleanup và AADP v2 support | Chờ migration evidence | Breaking/package + wire v2 |

## 3. Release 1.0.8 — JUnit và CI integration

Trạng thái: đã phát hành ngày 2026-07-30.

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

Trạng thái: đã phát hành ngày 2026-08-01.

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

Trạng thái: đã phát hành ngày 2026-08-02. Phần candidate scope bên dưới được giữ
làm implementation record của release.

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

Trạng thái: đã phát hành riêng ngày 2026-08-03. Quyết định lịch sử về khả năng gộp
hoặc bỏ qua không còn áp dụng.

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

Trạng thái: đã phát hành ngày 2026-08-05.

Mục tiêu: bổ sung capability opt-in cho consumer vận hành crawler/reference
client an toàn hơn mà không thay đổi AADP wire v1.0.

Candidate scope:

- Public cancellation bằng `AbortSignal` xuyên suốt request và traversal.
- Configurable concurrency limit; default bảo toàn behavior 1.0.x.
- Retry/backoff/`Retry-After` policy opt-in, bị chặn bởi deadline và traversal
  caps hiện có; `1.1.0` chưa phát hành `maxRequests` tổng quát.
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
       ├── page/entity traversal caps
       ├── byte/deadline budget
       ├── concurrency scheduler
       ├── retry policy
       └── cancellation
       │
       ▼
HTTP client + URL/DNS policy
```

CLI chỉ parse/render. Policy, scheduler và budget nằm trong module độc lập để test
không cần HTTP server. Retry MUST không vượt shared traversal caps/deadline và
MUST không gửi lại credential sang origin khác. Release này không có
`maxRequests` tổng quát.

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

Trạng thái: Implementation Ready sau khi ADR-0007, ADR-0008, Relations Module
v1.0 specification và conformance contract được chấp nhận. Plan authoritative:
[`implementation-plan-v1.2.0.md`](implementation-plan-v1.2.0.md).

Dependency đã chốt:

1. [ADR-0007](../../adr/0007-module-versioning-and-discovery.md): core/module
   version, discovery, envelope, registry và export paths.
2. [ADR-0008](../../adr/0008-module-traversal-and-authorization.md): authorization,
   shared traversal budget, cursor và cycle semantics.
3. [Relations Module v1.0 specification](../../../spec/modules/relations/v1.0/specification.md).
4. [Relations conformance contract](../../../spec/modules/relations/v1.0/conformance.md).

Scope implementation đã chốt:

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

- Package là `ail-aadp@1.2.0`, core vẫn `aadp_version: "1.0"` và Relations là
  `aadp:relations@1.0`.
- Inline relation set dùng `entity.x_relations`; collection dùng module envelope
  đã chốt trong plan chi tiết.
- Document kinds là `relation-set`, `relation-collection` và
  `relation-registry`.
- Public API nằm tại `ail-aadp/modules/relations/v1.0`; schema nằm tại
  `ail-aadp/schemas/modules/relations/v1.0/*`.
- Không thêm field core chuẩn mới vào schema AADP v1.0.
- Không re-export Relations API từ package root.

Release gate:

- ADR module versioning Accepted.
- Module schema, types, validator, client và conformance cùng version.
- Unknown module safely ignorable.
- Traversal có shared depth/node/request/response-byte/deadline budget,
  cross-origin limit và cycle guard.
- Cross-module/core compatibility tests xanh.
- External reference implementation đạt module conformance.

## 10. Release 1.3.0 — Answer Module

Trạng thái: implementation xong; một release gate được **defer có chủ đích** sang
`1.4.0` — xem [Gate deferred](#gate-deferred-external-conformance-trên-reference-deployment)
bên dưới và [implementation record](../../records/implementation-record-v1.3.0.md).

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
- External consumer clean-install đạt module conformance — **deferred, xem bên dưới**.

### Gate deferred: external conformance trên reference deployment

Gate "external consumer clean-install đạt module conformance" được defer sang
`1.4.0`. Đây là quyết định có chủ đích, không phải oversight.

Lý do: `examples/reference-server` không thể publish một Answer entity, vì
`ail-aadp/server` hiện chưa có khả năng nào để làm việc đó — `SerializedEntity`
không có chỗ cho extension field `x_*`, và manifest builder không có field
`modules`. Vì vậy không tồn tại deployment trung tính để chạy
`runAnswerConformance` với `baseUrl` + `sampleEntityUrl` thật.

Khả năng còn thiếu là **generic server capability**, không phải Answer-specific:
Evidence Module `1.4.0` sẽ cần đúng khả năng đó để publish `x_evidence`. Do đó
việc bổ sung nó thuộc `1.4.0` (additive public API → minor bump theo §1), và
hardcode Answer vào example route để lách gate là sai layer boundary.

Phần đã có ở `1.3.0` thay cho gate này:

- `tests/package/module-compatibility-contract.test.ts` — compatibility contract
  qua packed tarball: core-only consumer không register Answer; opt-in consumer
  phân biệt unsupported module/version/kind, không fallback.
- `tests/package/exports.test.ts` — Answer API import được từ clean install,
  self-contained, không đụng `src/**`.

Phần chưa có: chưa có run nào chứng minh toàn bộ required Answer checks cùng
xanh trên một deployment thật. `1.3.0` KHÔNG có end-to-end interoperability
evidence, và điều này phải được nêu rõ khi ký release checklist.

## 11. Release 1.3.x — Answer stabilization

Conditional patches chỉ sửa:

- Answer schema implementation bug không đổi released validation result.
- Locale/freshness/reference helper bug.
- Module conformance false positive/negative.
- Cross-runtime/type/export portability.

Thay đổi Answer wire schema sau release phải bump module version, không âm thầm
sửa artifact đã công bố.

## 12. Release 1.4.0 — Evidence & Provenance Module

Trạng thái: **implementation hoàn tất và toàn bộ gate đã đóng**. ADR-0010 Accepted
(2026-08-09), specification/conformance nay là normative. Gate external
conformance kế thừa từ `1.3.0` (xem §10) **đã đóng ngày 2026-08-10**: run thật
trên deployment HTTPS, clean install từ packed tarball trên Node engine floor,
cả report Answer `1.0` lẫn Evidence `1.0` đều `passed`. Record ghi rõ "Open gates:
None"; việc còn lại trước khi tag là release verification thông thường trên đúng
commit được tag, không phải gate. Bằng chứng ở
[implementation record 1.4.0](../../records/implementation-record-v1.4.0.md),
mục "Closed gates" và "External interoperability evidence (closed 2026-08-10)".

Issue coverage:

- `AADP-MODULE-003`: Evidence specification/schema.
- Phần Evidence của `AADP-MODULE-004/005/006`.

Candidate scope:

- **Generic module support ở server layer (kế thừa từ `1.3.0`, xem §10)**:
  manifest `modules` declaration và extension-field (`x_*`) serialization trong
  `ail-aadp/server`. Generic, không Answer/Evidence-specific. Mở khoá reference
  deployment cho cả Answer `1.0` lẫn Evidence `1.0`, và là điều kiện để đóng
  gate external conformance còn nợ của `1.3.0`.
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
- Reference server publish được cả Answer lẫn Evidence entity qua generic module
  support; external conformance chạy từ packed tarball đạt overall `passed` cho
  Answer `1.0` (gate defer từ `1.3.0`) và Evidence `1.0`.

## 13. Release 1.4.x — Evidence stabilization

Conditional patches cho graph integrity, citation portability, timestamp parsing,
reporting và conformance correctness. Không thêm vocabulary wire mới trong patch.

## 14. Release 1.5.0 — Cross-module graph traversal

Trạng thái: **Blocked Implementation Draft**, chặn ở Phase 0 (ADR-0011). Chi tiết
và toàn bộ contract đề xuất ở
[implementation plan 1.5.0](implementation-plan-v1.5.0.md).

Dependency đã xanh: Relations `1.0`, Answer `1.0`, Evidence `1.0` stable, và gate
external interoperability của `1.4.0` đã đóng ngày 2026-08-10 — xem §12 và
[implementation record 1.4.0](../../records/implementation-record-v1.4.0.md).
Dependency còn đỏ:
[ADR-0011](../../adr/0011-cross-module-graph-traversal.md) đang ở trạng thái
**Proposed** với ba open question chưa chốt; không artifact nào của `1.5.0` được
tạo trước khi ADR đó Accepted.

Mục tiêu: cung cấp application service/client orchestration thống nhất sau khi
Relations, Answer và Evidence đều ổn định.

Candidate scope:

- Traversal adapter registry (tách khỏi module registry validation-only) và
  capability negotiation exact-match qua module ID/version.
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
      ├── traversal adapter registry   (capability + expand)
      ├── traversal/budget policy      (budget do caller sở hữu)
      ├── dedupe/cycle guard           (shared canonical resolution, keyed by budget)
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
- Deterministic ordering không phụ thuộc timing, có test đảo thứ tự hoàn tất.
- Partial/inconclusive result không bị báo thành conformant hoàn chỉnh.
- Interoperability test với ít nhất hai reference data sets trung lập, mỗi data
  set có **tên, URL và owner ghi trong implementation record**; ít nhất một owner
  không phải AADP maintainers.

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
- Request decoration sau khi manifest/security metadata đã qua schema/semantic
  validation, nhưng trước khi fetch protected resource; resource document được
  validate sau fetch và trước khi client tin URL/nội dung của nó.
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
- Verification helper chỉ xác minh schema/digest/scope/time/revocation. Digest
  không chứng minh issuer identity; unsigned issuer phải là `unverified` cho tới
  khi signing ADR và trust policy được chấp nhận.

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
| JUnit/CI conformance | `1.0.8` | Đã phát hành |
| Compatibility/neutral reference server | `1.0.9` | Đã phát hành |
| Robustness/production operations | `1.0.10–1.0.11` | Đã phát hành |
| `AADP-ACCESS-001` explicit `none` cache semantics | `1.0.10` | Đã triển khai |
| Abort/concurrency/retry/byte budget/profiles | `1.1.0` | Đã phát hành |
| `AADP-MODULE-001`, `AADP-REL-001..006` | `1.2.0` | Implementation Ready |
| `AADP-MODULE-002` Answer | `1.3.0` | Chờ Relations |
| `AADP-MODULE-003` Evidence & Provenance | `1.4.0` | ADR-0010 Accepted; implementation xong |
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

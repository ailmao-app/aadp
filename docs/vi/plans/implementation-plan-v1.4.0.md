# Kế hoạch triển khai `ail-aadp` 1.4.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Partially Implementation Ready — chỉ Phase 1 (generic server module support) được phép bắt đầu; toàn bộ Evidence wire/semantic/client bị chặn cho tới khi ADR-0010 Accepted |
| Chủ đề | Evidence & Provenance Module; generic server module support (nợ kế thừa từ `1.3.0`) |
| Dependency | Relations `1.0` stable; Answer `1.0` stable; ADR-0010 (citation/provenance/security) Accepted |
| Wire impact | Module riêng `aadp:evidence@1.0`; generic server capability là additive public API của `ail-aadp/server`; KHÔNG sửa `aadp:answer@1.0` |
| Nợ kế thừa | Hai release gate của `1.3.0` được defer sang release này — xem [roadmap §10](release-roadmap.md) và [implementation record 1.3.0](../../records/implementation-record-v1.3.0.md) |
| Review | [implementation-plan-v1.4.0-review.md](implementation-plan-v1.4.0-review.md) — kế hoạch này được viết lại để đóng finding 3, 4, 5, 6; finding 1 và 2 vẫn là gate ở Phase 0. Vòng review thứ hai chỉnh thêm: extension grammar phải bằng core, model là acyclic (bỏ cycle/self-reference machinery), `source.access` không tham gia authorization, và `retrieved_at` dùng ordering thay vì equality. Vòng thứ ba bổ sung §"Orchestration contract" (thuật toán hai hop, `EvidenceGraph` node/edge ordering) và đồng bộ check `evidence.context` sang ordering. Vòng thứ tư chốt composition API: shared canonical resolution layer khoá theo budget, cache canonical outcome tách khỏi verdict `target_type` theo occurrence, và Evidence không gọi `resolveAnswerTargets`. Vòng thứ năm thêm resolution-context binding (một budget = một security context, fail closed khi mismatch) — **binding này đã được phát hành ở `1.3.1` như một security fix độc lập**, nên phần còn lại của nó trong kế hoạch này chỉ là mang theo khi trích xuất shared layer |
| Owner | AADP maintainers |

## Trạng thái theo work package

Bảng này là per-work-item status bắt buộc theo [document conventions §4](../../document-conventions.md)
cho document có delivery state hỗn hợp.

| # | Work package | Trạng thái | Điều kiện mở khóa |
|---:|---|---|---|
| 0 | ADR-0010 + Evidence specification/conformance | `Draft` — cả ba artifact đã viết xong, ADR ở trạng thái **Proposed**, chờ maintainer | Maintainer accept ADR |
| 1 | Generic server module support (nợ `1.3.0`) | `Implemented` — chờ release ở Phase 6 | — |
| 2 | Evidence schemas/types/fixtures | `Blocked` | Phase 0 Accepted |
| 3 | Registry + graph semantic validator | `Blocked` | Phase 0 + Phase 2 |
| 4 | Client traversal + Answer integration | `Blocked` | Phase 0 + Phase 3 |
| 5 | Reference resources (nợ `1.3.0`) | Item 1 (Answer resource) `Implemented` — chờ release ở Phase 6; item 2-3 phần Evidence `Blocked` | Phase 0 + Phase 2 cho phần Evidence |
| 6 | Conformance + external interoperability | `Blocked` | Phase 1-5 |

Các quyết định contract trong kế hoạch này ở trạng thái **đề xuất, chưa
normative**. Chúng là input cho ADR-0010; module ID, version, field và ví dụ
trong tài liệu này là non-normative theo [document conventions §5](../../document-conventions.md)
cho tới khi ADR-0010 và `spec/modules/evidence/v1.0/specification.md` được
Accepted. Một draft module version KHÔNG được coi là đã allocated chỉ vì xuất
hiện trong ví dụ ở đây.

## Mục tiêu

- Phát hành Evidence & Provenance Module wire contract đầu tiên để mô tả claim,
  evidence và source, cùng quan hệ tham chiếu giữa chúng.
- Cho phép một Answer `1.0` entity liên kết tới evidence **mà không sửa artifact
  bất biến `aadp:answer@1.0`** và không nhân bản payload evidence.
- Định nghĩa deterministic semantic cho stance, confidence, provenance timestamp
  và freshness mà không suy luận factual truth.
- Trả nợ `1.3.0`: generic module support ở `ail-aadp/server` (manifest `modules`
  declaration + `x_*` extension serialization) và external conformance chạy từ
  packed tarball trên reference deployment thật.
- Tái sử dụng nguyên trạng HTTP/URL/DNS policy, authorization behavior và shared
  traversal budget của Relations `1.0`; KHÔNG tạo network stack riêng cho Evidence.

## Ngoài phạm vi

- Không đánh giá factual truth, authenticity hoặc legal validity. Schema validity
  MUST NOT được diễn giải thành bất kỳ nghĩa nào trong ba nghĩa đó.
- Không fact-checking, ranking, trust score hoặc reputation của publisher.
- Không tự fetch URL nằm trong free text hoặc trong citation metadata ngoài
  traversal opt-in đã khai báo.
- Không thêm field vào core entity/manifest schema v1.0, Relations `1.0` hoặc
  Answer `1.0`.
- Không đưa business/semantic rule của Evidence vào `ail-aadp/server` runtime
  hoặc example route.
- Không hardcode `x_answer`/`x_evidence` trong generic server layer.
- Không cross-module graph composition tổng quát (thuộc `1.5.0`).
- Không chữ ký số, PKI hoặc verification identity của publisher.

## Dependency bắt buộc

Implementation của Phase 2 trở đi chỉ bắt đầu sau khi các điều kiện sau xanh:

1. `ail-aadp@1.3.0` và `aadp:answer@1.0` đã phát hành, schema immutable.
2. [ADR-0007](../../adr/0007-module-versioning-and-discovery.md) và
   [ADR-0008](../../adr/0008-module-traversal-and-authorization.md) vẫn Accepted.
3. **ADR-0010 citation/provenance/security** được tạo ở Phase 0 và Accepted.
   [ADR-0010](../../adr/0010-evidence-citation-provenance-and-security.md) nay đã
   tồn tại nhưng ở trạng thái **Proposed** — nó vẫn là blocker thực sự cho tới
   khi maintainer chuyển sang Accepted. Developer/reviewer KHÔNG được tự chuyển
   trạng thái đó.
4. Phase 1 (generic server module support) đã merge, vì reference deployment của
   Evidence phụ thuộc nó.

ADR-0010 MUST khóa tối thiểu các quyết định sau; mỗi mục dưới đây có một đề xuất
tương ứng trong §"Quyết định contract đề xuất":

- `claim`, `evidence`, `source` là document kind, resource type hay object lồng;
- ownership, cardinality và integrity của reference giữa ba khái niệm;
- canonical identity và quy tắc deduplicate;
- publisher identity và precedence của provenance timestamp;
- confidence scale, nguồn tạo confidence và ý nghĩa từng stance;
- xử lý private, authenticated và cross-origin source;
- có tồn tại reverse edge evidence → claim hay không; nếu ADR-0010 quyết định
  thêm thì mới phát sinh cycle policy, còn model đề xuất trong tài liệu này là
  acyclic by construction;
- composition API giữa Answer và Evidence: tầng nào sở hữu canonical outcome
  cache theo budget, và tầng đó public hay internal;
- resolution context: `1.3.1` đã khóa câu trả lời cho Answer (xem
  §"Resolution context"); ADR-0010 chỉ cần ratify rằng shared layer kế thừa
  nguyên contract đó, không định nghĩa lại.

Nếu ADR-0010 đổi bất kỳ quyết định nào bên dưới thì phải cập nhật kế hoạch này
**trước khi** tạo wire artifact. Released schema là immutable theo
[ADR-0004](../../adr/0004-backward-compatibility.md) và
[ADR-0007](../../adr/0007-module-versioning-and-discovery.md); không tạo schema
trước ADR.

## Quyết định contract đề xuất

### Version matrix

| Artifact | Version phát hành |
|---|---|
| npm package | `ail-aadp@1.4.0` |
| Core protocol | `aadp_version: "1.0"` |
| Relations Module | `aadp:relations@1.0` (không đổi) |
| Answer Module | `aadp:answer@1.0` (không đổi) |
| Evidence Module | `aadp:evidence@1.0` |

Evidence `1.0` là normative wire version đầu tiên; không phát hành `0.1`. Bump
rule theo ADR-0007 giống Answer: patch chỉ sửa doc/implementation bug, minor chỉ
thêm optional contract tương thích ngược, major cho thay đổi không tương thích.
Client KHÔNG fallback sang Evidence version khác khi exact version không hỗ trợ.

### Document kind và wire boundary

Đề xuất: `claim` và `evidence` là **document kind của module**, mang trên entity
extension `x_evidence`; `source` là **object lồng bên trong evidence**, không có
document kind riêng.

| Khái niệm | Hình thức | Lý do |
|---|---|---|
| `claim` | Document kind `claim`, entity `type: "claim"` | Được nhiều answer/evidence tham chiếu → cần identity và URL riêng |
| `evidence` | Document kind `evidence`, entity `type: "evidence"` | Được nhiều claim tham chiếu; cần fetch độc lập để tránh duplicate payload |
| `source` | Object lồng trong evidence | Không có consumer nào cần resolve source độc lập ở `1.0`; tách ra sẽ tạo thêm một hop traversal không cần thiết |

Registry dispatch bằng khóa `{aadp:evidence, 1.0, claim}` và
`{aadp:evidence, 1.0, evidence}`, đúng cơ chế đã phát hành ở ADR-0007. Không có
standalone collection kind hoặc registry kind ở `1.0`; listing tiếp tục dùng core
sitemap/resource flow.

Ví dụ **non-normative** (digest phải được sinh bằng `checksumOf()`, không copy tay):

```json
{
  "aadp_version": "1.0",
  "id": "claim:orbit-uptime-2026",
  "type": "claim",
  "checksum": "sha256:<generated>",
  "updated_at": "2026-08-06T09:00:00Z",
  "canonical_url": "https://example.com/claims/orbit-uptime-2026",
  "data": {},
  "x_evidence": {
    "module": "aadp:evidence",
    "version": "1.0",
    "kind": "claim",
    "statement": "Orbit reported 99.9% uptime in 2026.",
    "locale": "en",
    "evidence_refs": [
      {
        "target_type": "evidence",
        "target": {
          "id": "evidence:orbit-status-report-2026",
          "url": "https://example.com/ai/v1.0/entities/evidence/orbit-status-report-2026.json"
        },
        "stance": "support",
        "confidence": 0.8
      }
    ],
    "content_checksum": "sha256:<generated>"
  }
}
```

```json
{
  "module": "aadp:evidence",
  "version": "1.0",
  "kind": "evidence",
  "summary": "Annual status report published by Example Orbit.",
  "locale": "en",
  "source": {
    "title": "Orbit 2026 Status Report",
    "url": "https://example.com/reports/2026-status",
    "publisher": { "name": "Example Orbit" },
    "access": "public"
  },
  "provenance": {
    "published_at": "2026-01-15T00:00:00Z",
    "retrieved_at": "2026-08-01T09:00:00Z"
  },
  "content_checksum": "sha256:<generated>"
}
```

### Field contract

Schema đóng với `additionalProperties: false` ở mọi object do Evidence định
nghĩa. `target` được `$ref` từ Relations `1.0` và giữ nguyên extension point
`x_*` của Relations. Evidence wrapper KHÔNG hỗ trợ vendor extension ở `1.0`.

Claim document:

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module` | Có | Hằng `aadp:evidence` |
| `version` | Có | Hằng `1.0` |
| `kind` | Có | Hằng `claim` |
| `statement` | Có | String đã trim, 1-1.000 Unicode code points |
| `locale` | Có | Cùng deterministic BCP 47 profile với Answer `1.0` |
| `evidence_refs` | Có | 1-50 evidence reference (`target_type` hằng `evidence`), không trùng canonical target |
| `content_checksum` | Có | `sha256:<64 hex>` theo Content checksum contract |
| `notes` | Không | Untrusted text 1-1.000 code points, không có normative effect |

Evidence document:

| Field | Bắt buộc | Contract |
|---|---:|---|
| `module`/`version` | Có | Hằng `aadp:evidence` / `1.0` |
| `kind` | Có | Hằng `evidence` |
| `summary` | Có | String đã trim, 1-1.000 Unicode code points |
| `locale` | Có | Cùng profile với Answer `1.0` |
| `source` | Có | Source object (bảng dưới) |
| `provenance` | Có | Timestamp provenance |
| `content_checksum` | Có | `sha256:<64 hex>` |
| `excerpt` | Không | Trích dẫn nguyên văn, 1-2.000 code points |

Source object:

| Field | Bắt buộc | Contract |
|---|---:|---|
| `title` | Có | 1-500 code points |
| `url` | Có | Absolute HTTPS, không userinfo, không fragment |
| `publisher.name` | Có | 1-200 code points |
| `publisher.url` | Không | Absolute HTTPS, không userinfo, không fragment |
| `access` | Có | Enum `public` \| `authenticated` \| `restricted` |

`access` là **assertion của producer về source URL**, không phải kết quả kiểm
tra, và **không tham gia bất kỳ quyết định traversal hay conformance nào**. Nó
mô tả source nằm ngoài AADP — thứ mà `1.0` không bao giờ fetch — chứ không mô tả
security của evidence resource; giá trị hợp lệ duy nhất của nó là presentation
(hiển thị cho người đọc biết source có paywall/đăng nhập hay không). Authorization
của chính evidence entity do core/Relations authorization và manifest `security`
declaration quyết định. Nếu sau này có API retrieval cho source thì `access` mới
có thêm vai trò, và phải do ADR-0010 hoặc một module version mới định nghĩa.

### Reference identity và deduplicate

- Evidence reference dùng component `evidence-reference.schema.json` với đúng
  bốn field: `target_type`, `target`, `stance`, `confidence` (`confidence`
  optional).
- `target_type` là **hằng `evidence`**, không phải free token. Đây là thứ giữ cho
  graph acyclic by construction (xem §"Acyclic by construction"): claim chỉ trỏ
  được tới evidence, không trỏ được tới claim khác hay tới chính nó.
- Canonical identity của một target tái sử dụng nguyên trạng Relations semantic
  identity `{id, normalizedUrl}` — không định nghĩa identity rule mới.
- Trong một `evidence_refs`, hai phần tử không được cùng canonical identity, kể
  cả khi `stance` khác nhau. Muốn diễn đạt hai stance cho cùng evidence thì tách
  thành hai claim.
- Dedup trên toàn bộ walk dùng cùng canonical key `{id, normalizedUrl}` ở hai
  tầng: `RelationsTraversalBudgetState.visitedTargets` cho **kế toán budget** và
  shared canonical outcome cache (khoá theo budget) cho **tái dùng entity đã fetch**
  (§"Orchestration contract"). Không dedup riêng theo URL hoặc riêng theo entity ID.

### Stance và confidence

- `stance` là enum đóng: `support` | `contradict` | `neutral`. Ba giá trị là
  **assertion của producer về quan hệ giữa evidence và claim**, không phải kết
  luận về truth value của claim.
- `neutral` nghĩa "evidence liên quan nhưng producer không khẳng định hướng", KHÁC
  với vắng mặt reference.
- `confidence` là number trong `[0, 1]`, tối đa 2 chữ số thập phân, do producer
  khai báo. Không có đơn vị thống kê, không so sánh được giữa hai publisher, và
  KHÔNG được client tính lại hoặc tổng hợp thành score trong package này.
- Vắng `confidence` nghĩa "không khai báo", không phải `0` và không phải `1`.
- Validator không suy luận stance từ free text và không language-detect.

### Provenance timestamp và precedence

```json
{
  "published_at": "2026-01-15T00:00:00Z",
  "retrieved_at": "2026-08-01T09:00:00Z",
  "modified_at": "2026-03-02T00:00:00Z"
}
```

- RFC 3339 UTC dạng `Z`, precision tối đa milliseconds — cùng rule với Answer `1.0`.
- `published_at` và `retrieved_at` bắt buộc; `modified_at` optional.
- Invariant: `published_at <= retrieved_at`; nếu có `modified_at` thì
  `published_at <= modified_at <= retrieved_at`.
- Precedence khi hiển thị "thời điểm của evidence": `modified_at` nếu có, ngược
  lại `published_at`. `retrieved_at` chỉ mô tả thời điểm producer lấy về, không
  bao giờ được dùng làm ngày của nội dung.
- Với entity `type: "evidence"`, invariant là **ordering, không phải equality**:
  `x_evidence.provenance.retrieved_at <= entity.updated_at`. Hai timestamp mô tả
  hai sự kiện độc lập — `retrieved_at` là lúc producer lấy source về,
  `entity.updated_at` là lúc entity được publish/sửa. Yêu cầu bằng nhau sẽ khiến
  mọi correction không kèm re-retrieval (sửa `summary`, `locale`, `excerpt`,
  `publisher.name`) tạo ra entity invalid, ép producer khai man provenance hoặc
  để `updated_at` cũ. Đây là khác biệt có chủ ý so với Answer `1.0`, nơi
  `freshness.updated_at === entity.updated_at` đúng vì cả hai cùng mô tả một sự
  kiện. Invariant thuộc entity-context validator, không thuộc registry wrapper
  validator. ADR-0010 chốt lại lần cuối liệu có thêm ràng buộc equality riêng cho
  lần publish đầu tiên hay không.

### Freshness

Freshness là **client-computed classification**, không phải publisher metadata.
Evidence `1.0` không có field `expires_at` và không có field `freshness`.
`classifyEvidenceFreshness(evidence, now, maxAgeMs)` là pure helper dùng injected
clock, phân loại `fresh` | `stale` dựa trên timestamp precedence ở trên. Không
dùng wall clock trong pure validator.

### Content checksum

`content_checksum` tái sử dụng nguyên trạng contract đã phát hành ở
[ADR-0001](../../adr/0001-checksum-algorithm.md) và public
`ail-aadp/canonical-json`: `checksumOf(wrapper_minus_content_checksum)`, RFC 8785
JCS, sort key theo UTF-16 code unit value. Evidence KHÔNG định nghĩa
canonicalization rule mới; chỉ khác phạm vi input (`x_evidence`).

Phạm vi hash bao phủ toàn bộ field normative của wrapper, kể cả Relations
`target.x_*` lồng bên trong `evidence_refs`. Core checksum vẫn chỉ bao phủ
`data`; một Evidence entity hợp lệ phải pass cả hai.

### Answer integration — không sửa `aadp:answer@1.0`

Answer `1.0` là released immutable contract và wrapper của nó không hỗ trợ vendor
extension. Vì vậy:

- Answer liên kết tới claim/evidence **chỉ qua `related_entities`** đã có sẵn,
  dùng `target_type` là `claim` hoặc `evidence`. KHÔNG dùng
  `authorship.source_targets` — field đó có nghĩa hẹp là input source của một
  generated summary và ép nó mang nghĩa citation sẽ làm sai provenance.
- `target_type` canonical: `claim` cho claim entity, `evidence` cho evidence
  entity. Cả hai khớp core entity type grammar `^[a-z][a-z0-9_-]*$` nên không cần
  đổi schema Answer.
- Integration **chỉ thêm helper và conformance check ở Evidence module layer**;
  không thay đổi `AnswerValidationResult`, `AnswerEntityValidationResult` hoặc
  tập payload hợp lệ của Answer `1.0`.
- Helper mới `resolveAnswerEvidenceV1(answer, options)` lọc `related_entities`
  theo `target_type`, resolve qua **shared canonical resolution layer**, validate
  từng entity bằng Evidence entity validator, **rồi expand `evidence_refs` của
  mọi claim đã resolve** trên cùng budget. Helper **không gọi
  `resolveAnswerTargets`** — hàm đó luôn kéo theo cả `authorship.source_targets`,
  nằm ngoài phạm vi Evidence. Không tự viết network stack, không tạo budget con.
  Thuật toán đầy đủ và kết quả `EvidenceGraph` được định nghĩa ở §"Orchestration
  contract" — bước expand là bắt buộc, nếu bỏ thì helper chỉ validate link trực
  tiếp và âm thầm bỏ qua toàn bộ evidence của claim.
- Duplicate payload được tránh bằng chính mô hình reference: evidence nằm ở entity
  riêng, answer chỉ giữ target. Không inline evidence vào `x_answer`.

Nếu về sau cần thêm field vào Answer để mô tả citation thì phải phát hành
`aadp:answer@1.1` (minor, optional, tương thích ngược) hoặc `2.0`, KHÔNG sửa
artifact `aadp:answer@1.0`.

## Graph và traversal policy

Đây là phần đóng finding 4 của review: các gate "không dangling reference",
"không unbounded graph", "cycle ngoài policy" được cụ thể hóa thành rule
deterministic. Kết luận về cycle: wire model `1.0` **không biểu diễn được cycle
nào**, nên không có cycle policy để thực thi — xem §"Acyclic by construction".

### Reference resolution requirement

| Loại reference | Bắt buộc resolve? | Ghi chú |
|---|---|---|
| `claim.evidence_refs[]` | Có, khi caller opt in traversal | Unresolved → entry có status tương ứng, không throw |
| `answer.related_entities[]` có `target_type` claim/evidence | Chỉ khi caller gọi helper Evidence | Giữ nguyên behavior Answer `1.0` khi không gọi |
| `evidence.source.url` | KHÔNG | Là metadata; validator/client KHÔNG tự fetch |
| `evidence.source.publisher.url` | KHÔNG | Metadata |

### Dangling định nghĩa như thế nào

Một reference chỉ được tính là **dangling** khi target không tồn tại hoặc không
phải AADP document hợp lệ:

| Kết quả | Status | Có phải dangling? |
|---|---|---|
| 200 + entity hợp lệ | `resolved` | Không |
| 404/410 | `not-found` | **Có** |
| 200 nhưng schema/semantic invalid, hoặc sai `target_type` | `invalid` | **Có** |
| 401/403 | `forbidden` | Không — access control, không phải broken graph |
| URL bị URL/DNS policy chặn (private, link-local, reserved, cross-origin denial) | `forbidden` | Không |
| Budget cạn hoặc abort | `budget-exhausted` | Không — partial result |

Vocabulary status tái sử dụng nguyên `AnswerTargetResolutionStatus`
(`resolved` | `forbidden` | `not-found` | `invalid` | `budget-exhausted`); không
tạo enum mới.

`source.access` **KHÔNG tham gia** phân loại này. Hai lý do: (a) nó mô tả source
URL lồng bên trong evidence, không mô tả security của chính AADP evidence
resource; (b) khi target trả 401/403 thì client không hề có body `x_evidence` để
đọc `source.access` — giá trị đó không tồn tại đúng lúc cần phân loại. Mọi 401/403
trên target đều là `forbidden` và là kết quả **không dangling**, độc lập với
`source.access`. Nếu cần đối chiếu "resource này lẽ ra có được bảo vệ không", căn
cứ duy nhất là `security` declaration của resource trong core manifest, không phải
metadata trong payload.

Release gate "không dangling reference" nghĩa là: conformance run trên reference
deployment không có entry `not-found` hoặc `invalid`. Entry `forbidden` luôn là
kết quả hợp lệ, không fail gate.

### Budget và limits

Traversal Evidence dùng nguyên `RelationsTraversalBudgetState` do caller sở hữu —
depth, nodes, requests, total bytes, deadline, cross-origin requests đều là sáu
dimension đã phát hành ở ADR-0008, với reference default hiện có
(`maxDepth: 3`, `maxNodes: 1000`, `maxRequests: 2000`, `maxTotalBytes: 64 MiB`,
`maxCrossOriginRequests: 100`). Evidence:

- KHÔNG tạo budget con, KHÔNG nới default, KHÔNG thêm dimension mới;
- charge depth theo cạnh answer → claim → evidence (evidence là leaf, độ sâu tối
  đa 2 cạnh từ answer);
- charge node qua `chargeNode` để dedup dùng chung `visitedTargets` state.

### Acyclic by construction — không có cycle policy

Evidence `1.0` là **directed acyclic graph một chiều, tối đa một hop từ claim**,
và điều đó được bảo đảm bởi chính wire model chứ không bởi runtime guard:

- cạnh duy nhất là `claim.evidence_refs[]`;
- `evidence_refs[].target_type` là **hằng `evidence`**, nên một claim không thể
  trỏ tới claim khác hoặc tới chính nó — vi phạm bị schema bắt, và entity-context
  validation cũng reject khi entity fetch về không đúng `type: "evidence"`;
- evidence document **không có field nào trỏ ngược về claim**; `source.url` là
  metadata và không bao giờ được traverse.

Do đó KHÔNG có cycle nào biểu diễn được trên wire. Nhiều claim cùng trỏ tới một
evidence là **fan-in và dedup**, không phải cycle: `chargeNode` trên
`visitedTargets` chặn charge lần hai, còn shared canonical outcome cache giữ
entity đã fetch để lần gặp sau tái dùng thay vì fetch lại — cùng canonical key
`{id, normalizedUrl}`, và cả hai đều cần thiết (§"Orchestration contract").

Vì vậy kế hoạch này KHÔNG yêu cầu:

- cycle guard qua `expandedTargets` — không có node nào cần "expand" ngoài claim gốc;
- semantic rule `evidence.semantic.self_reference` — không reachable, pure wrapper
  validator cũng không có entity context để biết id của chính claim;
- cycle fixture hoặc cycle conformance check.

Nếu ADR-0010 quyết định thêm reverse edge (evidence → claim) thì lúc đó mới định
nghĩa ownership của cạnh đó cùng cycle policy tương ứng, và phải cập nhật kế
hoạch này trước khi tạo schema. Duplicate-target check và shared-budget check vẫn
giữ nguyên trong mọi trường hợp.

### Orchestration contract

`resolveClaimEvidenceV1` (một hop) và `resolveAnswerEvidenceV1` (hai hop) dùng
chung một state object và cùng trả `EvidenceGraph`.

#### Budget không phải result cache

`RelationsTraversalBudgetState.visitedTargets` là **cấu trúc kế toán budget, KHÔNG
phải cache kết quả**: `chargeNode` chỉ trả `{ alreadyVisited: true }` và không giữ
lại entity đã validate, nên một resolver gặp `alreadyVisited` không có gì để replay
— nó không được refetch (vi phạm dedup) và cũng không được coi target đó là
`invalid`.

Answer `1.0` đã giải bài này và lời giải đó là **shared infrastructure, không phải
chi tiết riêng của Answer**: `src/modules/answer/v1.0/client/resolve.ts` giữ một
`WeakMap<RelationsTraversalBudgetState, BudgetResolutionState>` với `outcomes`
(canonical outcome), `pending` (join fetch đang bay) và `globalStops` (budget stop
theo key), sống lâu hơn một call và race-safe giữa các call dùng chung budget.

Điều này bắt buộc một quyết định composition, vì docstring của
`resolveAnswerTargets` nói rõ: một canonical key mà Answer resolver **chưa từng
chạm tới** — ví dụ được charge bởi một raw Relations traversal step trên cùng
budget — sẽ bị report là `invalid`, không phải `resolved`. Nếu Evidence tự resolve
bằng Relations resolver trên budget dùng chung với Answer thì chính nó tạo ra
false `invalid` cho Answer.

**Quyết định (ADR-0010 phải ratify):** trích xuất tầng canonical resolution này
thành **shared internal layer khoá theo budget**, rồi cho cả Answer lẫn Evidence
dùng chung:

- Layer mới nằm ở `src/modules/shared/canonical-resolution.ts`, sở hữu
  `WeakMap<budget, BudgetResolutionState>`, `resolveCanonicalTarget` và replay
  semantics (`pending`, `globalStops`).
- Layer này **KHÔNG được export** từ bất kỳ public subpath nào — cùng lý do
  `releaseNode` của Relations được giữ module-internal: precondition của nó không
  kiểm tra được từ ngoài.
- Answer refactor để consume layer này. Đây là **pure refactor**: public API, wire
  contract và normative semantic result của `aadp:answer@1.0` không đổi, đúng
  định nghĩa patch-level của ADR-0007. Bằng chứng regression là **toàn bộ test
  Answer hiện có phải pass mà không sửa một dòng nào**.
- Evidence dùng đúng layer đó cho mọi fetch, nên hai module chia sẻ **một** bản đồ
  canonical outcome trên mỗi budget.

Nhờ vậy không cần một resolve-state do call sở hữu, không còn precondition
"budget phải đi kèm cache" và không còn câu hỏi ownership khi gọi lồng/đồng thời:
state gắn với budget, giống hệt mô hình Answer đang chạy.

#### Resolution context — đã phát hành ở `1.3.1`, phần còn lại chỉ là mang theo

> **Trạng thái: đã ship.** Hazard mô tả ở đây từng là bug thật của Answer `1.0`
> đã phát hành, và nó **đã được sửa và phát hành ở `1.3.1`** như một security
> patch độc lập, trước khi Phase 4 bắt đầu — xem
> [implementation plan 1.3.1](implementation-plan-v1.3.1.md), mục **Security**
> của `CHANGELOG.md` 1.3.1, `src/modules/answer/v1.0/client/resolution-context.ts`
> và `tests/modules/answer/v1.0/client/resolution-context.test.ts`.
> Kế hoạch này KHÔNG còn phải thiết kế hay implement binding đó; việc còn lại của
> Phase 4 là **mang nguyên nó theo** khi trích xuất shared canonical resolution
> layer, và mở rộng test sang đường Evidence.

Per-budget cache chỉ an toàn khi **một budget = một request context bất biến**.
`BudgetResolutionState` khoá theo `{budget, canonical key}`, trong khi `headers`,
`urlPolicy`, `maxResponseBytes`… là **option theo từng call**
(`FetchJsonOptions` → `RelationsClientOptions`). Trước `1.3.1`:

```text
1. resolveAnswerTargets(E, { budget: B, headers: { Authorization: A } })
   -> E resolved, cache theo key của E trên budget B.
2. resolveAnswerTargets(answer, { budget: B })                // KHÔNG credential
3. Cache hit theo {B, key(E)} -> caller thứ hai nhận E
   mà chưa từng phát request lẽ ra phải trả 401/403.
```

Biến thể concurrent còn tệ hơn: call nào tạo `pending` trước sẽ quyết định
headers/URL policy cho **một** request dùng chung, và cả hai caller thừa hưởng kết
quả đó — kết quả phụ thuộc thứ tự chạy.

**Contract đã phát hành** (`1.3.1`, normative — không phải đề xuất): resolution
state của một budget được **bind vào context ở lần dùng đầu tiên**; một call sau
với context khác **throw `AadpClientError` với `code: "resolution_context_mismatch"`
trước mọi cache replay, pending join, budget charge hoặc request**, nên call bị từ
chối để lại budget nguyên vẹn.

Tập option tạo nên context identity — lưu ý **rộng hơn** đề xuất ban đầu của kế
hoạch này, và bản đã ship mới là bản đúng:

| Option | Vai trò |
|---|---|
| `headers` (tên lower-case **và** giá trị) | Authorization/tenant/session — biên principal |
| `crossOriginSafeHeaders` | Header nào còn được gửi khi vượt origin |
| `urlPolicy` (reference identity) | URL/địa chỉ nào được phép fetch |
| `rootOrigin` | Cross-origin accounting |
| `timeoutMs`, `maxRedirects`, `retry` | Chia sẻ một request giữa hai cấu hình là order-dependent |
| `maxResponseBytes` | Replay một response lớn hơn cap của chính call là **bypass safety limit**, không chỉ là liveness |
| `onBeforeAttempt` (reference identity) | Observer của request thật |

`signal` là thứ duy nhất **ngoài** context identity: nó là caller-local waiting
state, không bao giờ được forward vào shared fetch, nên hai call chỉ khác `signal`
dùng chung context một cách hợp lệ.

Cách so khớp mà **không lưu secret** (đã implement): chỉ giữ digest HMAC-SHA-256
trên encoding length-prefixed đã chuẩn hoá của các option trên, key ngẫu nhiên
theo process. Không lưu giá trị header thô, không đưa digest hay tên/giá trị
header vào message lỗi, không log.

**Việc còn lại của Phase 4:** khi `BudgetResolutionState` chuyển sang
`src/modules/shared/canonical-resolution.ts`, binding này đi cùng nó và trở thành
bất biến của tầng dùng chung — Evidence không được có đường vòng nào bỏ qua nó.
Không có quyết định compatibility nào phải ra thêm ở đây: version bump, mục
Security trong CHANGELOG và test Answer-level cho các case tuần tự/concurrent đều
đã hoàn tất ở `1.3.1`.

#### Cache canonical outcome, KHÔNG cache verdict theo reference

Cache lưu `EvidenceCanonicalOutcome` — **kết quả fetch/schema/checksum của một
canonical target** (entity đã validate, hoặc canonical failure) — chứ KHÔNG lưu
`EvidenceGraphNode`. Verdict `target_type` được tính **lại cho từng occurrence**
bằng expected type của chính occurrence đó, đúng như `entryFor` của Answer `1.0`.

Lý do là một canonical target có thể được hai reference khai báo hai `target_type`
khác nhau:

```text
1. answer.related_entities[0] -> E, khai báo target_type: claim  (SAI, E là evidence)
2. claim C.evidence_refs[0]   -> E, khai báo target_type: evidence (ĐÚNG)
```

Nếu cache lưu cả status thì reference (1) sẽ đầu độc reference (2): edge C → E
thành `invalid` chỉ vì Answer khai sai type ở chỗ khác, và đảo thứ tự input lại
cho kết quả ngược — phá đúng cái mixed-order equivalence vừa cam kết, đồng thời
tạo dangling-reference giả.

Quy tắc: reference (1) vẫn `invalid` **cho riêng nó**, reference (2) vẫn
`resolved` bằng chính entity đã fetch, và E chỉ được fetch một lần.

#### Thuật toán `resolveAnswerEvidenceV1`

| Bước | Hành động | Ordering |
|---:|---|---|
| 1 | Lọc `answer.related_entities` có `target_type` ∈ {`claim`, `evidence`}, giữ nguyên input order | Input order |
| 2 | Resolve từng reference đã lọc qua **shared canonical resolver** trên `options.budget` | Như bước 1 |
| 3 | Với mỗi canonical outcome: kiểm `target_type` của **chính reference đó**, rồi validate bằng `validateEvidenceEntityV1`; tạo node | Như bước 1 |
| 4 | Với mỗi **claim** đã resolve, theo đúng thứ tự ở bước 1, duyệt `evidence_refs` theo input order | (claim index, ref index) |
| 5 | Mỗi ref: tra canonical cache. **Hit** → tái dùng entity đã fetch, kiểm `target_type` riêng cho ref này, thêm edge, KHÔNG fetch lần hai. **Miss** → resolve qua cùng shared resolver | Như bước 4 |
| 6 | Dừng. Evidence là leaf, không expand tiếp | — |

`resolveClaimEvidenceV1` là đúng bước 4-6 với một claim đã có sẵn.

Bước 2 **KHÔNG được gọi `resolveAnswerTargets`**. Hàm đó nhận nguyên
`AnswerDocumentV1` chứ không nhận subset, và nó luôn collect cả
`related_entities` **lẫn** `authorship.source_targets` — gọi nó sẽ fetch và charge
budget cho những generated-summary source nằm ngoài phạm vi Evidence, thậm chí làm
cạn budget trước khi walk claim → evidence bắt đầu. Ba đường thoát đều bị loại:
thêm selector vào `resolveAnswerTargets` là đổi public API của Answer (vi phạm
gate); dựng synthetic Answer để lách collection sẽ tạo document sai
schema/checksum; tự viết lại orchestration là duplicate network stack. Đường còn
lại — và là lý do tầng shared canonical resolution phải tồn tại — là Evidence tự
collect reference của mình rồi resolve qua **cùng** tầng dùng chung.

Hệ quả kiểm chứng được: một generated-summary Answer đi qua
`resolveAnswerEvidenceV1` phải **không phát sinh request nào** tới
`authorship.source_targets`. Đây là test bắt buộc, không phải ghi chú.

Hệ quả trực tiếp:

- **Fan-in**: C1 và C2 cùng trỏ tới E → E được fetch đúng một lần (bước 5 hit),
  và graph có hai edge tới cùng một node.
- **Mixed order**: nếu Answer trỏ thẳng tới E *và* tới C1 (C1 → E), thì E đã có
  canonical outcome từ bước 2; bước 5 tái dùng entity đã fetch. Kết quả phải
  **giống hệt nhau ở cả hai thứ tự** (E trước C1, hoặc C1 trước E) — đây là test
  case bắt buộc, không phải chi tiết implementation.
- **Mixed type**: cùng canonical target nhưng hai reference khai báo `target_type`
  khác nhau → verdict tính riêng cho từng reference, cả hai chiều (reference sai
  type đi trước, và reference đúng type đi trước) đều phải cho cùng kết quả.
- `markExpanded`/`expandedTargets` KHÔNG được dùng: claim chỉ được duyệt một lần
  do chính ordering ở bước 4, và evidence không bao giờ được expand.

#### `EvidenceGraph`

```ts
export type EvidenceNodeKindV1 = "claim" | "evidence";

/**
 * Node = MỘT canonical target. `status` chỉ mô tả kết quả fetch/schema/checksum
 * của chính target đó — KHÔNG mang verdict `target_type` của bất kỳ reference nào.
 */
export interface EvidenceGraphNode<T = unknown> {
  /** Canonical `{id, normalizedUrl}` key — cùng identity rule với Relations. */
  key: string;
  /** Suy ra từ document đã validate, không phải từ khai báo của reference. Vắng khi chưa resolve được. */
  kind?: EvidenceNodeKindV1;
  status: AnswerTargetResolutionStatus;
  /** Chỉ có khi status === "resolved". */
  entity?: EntityV1<T>;
  document?: EvidenceClaimDocumentV1 | EvidenceDocumentV1;
  /** Có với mọi status khác "resolved". */
  message?: string;
}

/** Một occurrence trong `answer.related_entities` (bước 1-3), có verdict riêng. */
export interface EvidenceGraphReference {
  /** Index trong `related_entities` gốc của Answer, không phải index sau khi lọc. */
  index: number;
  reference: AnswerEntityReferenceV1;
  /** Canonical key của node tương ứng. */
  key: string;
  /** Verdict của RIÊNG reference này, gồm cả sai `target_type` → "invalid". */
  status: AnswerTargetResolutionStatus;
  message?: string;
}

/** Một occurrence trong `claim.evidence_refs`, cũng có verdict riêng. */
export interface EvidenceGraphEdge {
  /** `key` của claim node. */
  from: string;
  /** `key` của evidence node. */
  to: string;
  /** Index trong `claim.evidence_refs`, để truy vết về wire. */
  index: number;
  stance: EvidenceStanceV1;
  confidence?: number;
  status: AnswerTargetResolutionStatus;
  message?: string;
}

export interface EvidenceGraph<T = unknown> {
  /** Mỗi canonical target đúng một node. Discovery order: bước 2 trước, rồi bước 5. Không sort lại. */
  nodes: EvidenceGraphNode<T>[];
  /** Direct Answer references theo input order. Rỗng với `resolveClaimEvidenceV1`. */
  references: EvidenceGraphReference[];
  /** Sắp theo (claim discovery index, ref index). */
  edges: EvidenceGraphEdge[];
  /** True khi walk dừng trước khi thử hết reference (budget/abort). */
  partial: boolean;
}
```

Tách `status` thành hai tầng chính là thứ chặn bug đầu độc cache ở trên: node giữ
**canonical outcome dùng chung**, còn `references[]`/`edges[]` giữ **verdict theo
từng occurrence**. Một node `resolved` vẫn có thể bị một reference khai sai
`target_type` báo `invalid`, mà không kéo theo reference khác.

Node không resolve được vẫn xuất hiện với status tương ứng, không bị bỏ khỏi
`nodes`. Edge và reference entry luôn tồn tại nếu wire có ref, kể cả khi node đích
không resolve — để consumer phân biệt "không có ref" với "có ref nhưng fetch hỏng".

### Partial result, cancellation và retry

- Kết quả traversal giữ thứ tự input và có cờ `partial`. Mọi reference sau điểm
  dừng vẫn xuất hiện với status `budget-exhausted`, không bị âm thầm bỏ — giống
  hợp đồng `AnswerResolvedTargets` đã phát hành.
- `AbortSignal` do caller truyền; abort tạo partial result, không throw ra ngoài
  dưới dạng lỗi ẩn danh.
- KHÔNG retry ngoài policy HTTP hiện có; Evidence không thêm retry layer.
- Issue/check ID ổn định, prefix `evidence.semantic.*` và `evidence.*` cho
  conformance; message text không phải API ổn định.

## Generic server module support

Phần này độc lập với Evidence và là work package duy nhất được phép bắt đầu ngay.

### Hiện trạng

Core contract đã có: `ManifestV1.modules` (typed
`Array<{ id, version, schema } & ExtensionFields>`), `EntityV1` cho phép root
extension field `x_*`, và manifest JSON Schema đã định nghĩa module declaration.

Server boundary còn thiếu (xác nhận trên `src/server/types.ts` và
`src/server/runtime.ts`):

- `AadpServerConfig` chưa nhận module declarations; manifest builder không phát
  `modules`;
- `SerializedEntity` chỉ có `id`/`updatedAt`/`canonicalUrl`/`locale`/`data`,
  không có đường trả extension fields;
- `entity()` build document từ đúng năm field trên, nên `x_*` không bao giờ tới
  được response.

### Public API đề xuất

```ts
export interface SerializedEntity<T = unknown> {
  id: string;
  updatedAt: string | Date;
  canonicalUrl?: string;
  locale?: string;
  data: T;
  /** Root-level `x_*` extension fields (module payloads). Keys MUST match the released core entity grammar `^x_[a-zA-Z0-9_]*$`. */
  extensions?: Record<string, unknown>;
}

export interface AadpServerConfig {
  // ...existing fields
  /** Module declarations published in the manifest's `modules[]`. */
  modules?: ManifestV1["modules"];
}
```

Dùng một field `extensions` có tên rõ nghĩa thay vì cho phép arbitrary property
trên `SerializedEntity` — arbitrary property sẽ làm mọi typo trở thành wire field
và khóa chặt khả năng thêm core field trong tương lai.

### Runtime contract

```text
Resource/repository
    -> serialize(record)
    -> SerializedEntity { core fields, extensions }
    -> generic server runtime validates and emits x_*
    -> AADP entity response
```

Runtime MUST:

- dùng **đúng grammar đã phát hành của core entity schema** `^x_[a-zA-Z0-9_]*$`
  ([`schemas/v1.0/entity.schema.json`](../../../schemas/v1.0/entity.schema.json)),
  không tự định nghĩa grammar hẹp hơn ở server layer. Grammar này chấp nhận chữ
  hoa (`x_Foo`), ký tự số ngay sau prefix (`x_1`) và cả key trần `x_`; một server
  helper từ chối các key đó sẽ không serialize được entity mà chính core schema
  coi là hợp lệ, phá vỡ tuyên bố additive compatibility và làm hỏng vendor
  extension name có sẵn khi user chuyển từ generate entity thủ công sang
  `ail-aadp/server`;
- key sai grammar làm `defineAADP()`/`entity()` fail rõ ràng, không silently drop;
- từ chối key trùng tên core field (defence in depth — prefix `x_` đã loại trừ,
  nhưng check phải tồn tại để một thay đổi grammar sau này không mở lỗ hổng);
- chạy `assertJsonSafe` trên extension values trước `structuredClone`/
  `JSON.stringify`, giống đường manifest hiện tại;
- KHÔNG mutate object do consumer cung cấp;
- giữ core `checksum` **chỉ bao phủ `data`** — thêm extension KHÔNG được đổi giá
  trị checksum của một entity vốn đã publish;
- giữ nguyên hoàn toàn behavior hiện tại khi `modules` và `extensions` bị omit
  (đây là compatibility gate, phải có test riêng);
- validate `modules` theo core manifest schema và semantic rule hiện có, cùng
  đường với các field manifest khác.

Grammar này phải được export **một lần duy nhất** dưới dạng predicate dùng chung
(ví dụ `isExtensionKey(key: string): boolean` ở core layer), rồi tái sử dụng cho
manifest validation, entity validation và server serialization. Không tạo bản
sao regex thứ hai trong `src/server/**`; hiện tại repo chưa có predicate nào như
vậy nên Phase 1 phải tạo nó thay vì inline regex.

Server runtime MUST NOT import hoặc register Answer/Evidence module, và MUST NOT
chứa branch theo tên module cụ thể.

## Validation boundary

### JSON Schema

Schema chịu trách nhiệm: required fields, constants, closed objects, enum
`stance`/`access`, string/array bounds, URL/timestamp shape, confidence range và
evidence reference shape (target qua Relations `$ref`).

Schema KHÔNG kiểm tra: timestamp ordering, duplicate semantic target,
`content_checksum` và quan hệ thứ tự với core entity `updated_at`.

### Pure wrapper semantic validator

Registry giữ nguyên public contract đã phát hành
`ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[]`. Validator
đăng ký cho `{aadp:evidence, 1.0, claim}` và `{aadp:evidence, 1.0, evidence}` chỉ
nhận wrapper; không nhận core entity context, không fetch network, không đọc
clock hệ thống, không mutate input. Kiểm tra:

- module/version/kind nhất quán;
- Unicode code-point bounds sau trim;
- locale đúng profile;
- timestamp ordering và precedence;
- confidence range/precision;
- duplicate target theo Relations semantic identity;
- `content_checksum` khớp digest tính lại.

Validator KHÔNG có rule self-reference: `target_type` hằng `evidence` đã loại trừ
claim→claim ở tầng schema, và pure wrapper validator không có entity context để
biết id của chính document.

### Entity-context validator

`validateEvidenceEntityV1(entity)`:

1. Validate core entity v1.0 trước.
2. Yêu cầu `entity.type` khớp kind (`claim` hoặc `evidence`), có `x_evidence` và
   có `entity.canonical_url`.
3. Validate `entity.canonical_url` bằng URL-policy helper dùng chung với
   `source.url` (absolute HTTPS, không userinfo, không fragment).
4. Dispatch `x_evidence` qua exact registry key.
5. Với kind `evidence`: yêu cầu `provenance.retrieved_at <= entity.updated_at`.
6. Trả typed validated entity hoặc structured validation result.

Không mở rộng generic module registry để truyền context; không thêm
Evidence-specific branch vào core validator.

## Typed API contract

```ts
export type EvidenceClaimDocumentV1;
export type EvidenceDocumentV1;
export type EvidenceSourceV1;
export type EvidenceProvenanceV1;
export type EvidenceReferenceV1;
export type EvidenceStanceV1 = "support" | "contradict" | "neutral";
export type EvidenceAccessV1 = "public" | "authenticated" | "restricted";
export type ValidatedEvidenceEntityV1;
export type EvidenceValidationIssue;
export type EvidenceValidationResult;
export type EvidenceEntityValidationResult;
export type EvidenceClientOptions;
export type EvidenceResolveOptions;
export type EvidenceNodeKindV1 = "claim" | "evidence";
export type EvidenceGraphNode;
export type EvidenceGraphReference;
export type EvidenceGraphEdge;
export type EvidenceGraph;
export type EvidenceFreshnessState = "fresh" | "stale";
export type EvidenceConformanceOptions;
export type EvidenceConformanceReport;

export function registerEvidenceModule(): void;
export function validateEvidenceV1(document: unknown): EvidenceValidationResult;
export function validateEvidenceEntityV1(entity: unknown): EvidenceEntityValidationResult;
export function parseEvidenceEntityV1(entity: unknown): ValidatedEvidenceEntityV1;
export function fetchEvidenceEntityV1(
  url: string,
  options: EvidenceClientOptions,
  budget: RelationsTraversalBudgetState,
): Promise<ValidatedEvidenceEntityV1>;
export function resolveClaimEvidenceV1(
  claim: EvidenceClaimDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function resolveAnswerEvidenceV1(
  answer: AnswerDocumentV1,
  options: EvidenceResolveOptions,
): Promise<EvidenceGraph>;
export function classifyEvidenceFreshness(
  evidence: EvidenceDocumentV1,
  now: Date,
  maxAgeMs: number,
): EvidenceFreshnessState;
export function runEvidenceConformance(
  options: EvidenceConformanceOptions,
): Promise<EvidenceConformanceReport>;
```

Tên type có suffix `V1` hoặc nằm trong versioned subpath. Public function không
nhận implementation-private type. `fetchEvidenceEntityV1` dùng core `fetchEntity`
rồi `parseEvidenceEntityV1`; không trust target URL trước khi entity hợp lệ.

Hai resolver nhận `options.budget` giống hệt Answer `1.0` — **không có tham số
state riêng**. Canonical outcome cache khoá theo chính budget ở tầng shared
internal (§"Orchestration contract"), nên không có gì để caller quên truyền và
cũng không phát sinh câu hỏi ownership khi gọi lồng nhau hoặc đồng thời.

`EvidenceCanonicalOutcome` và toàn bộ tầng canonical resolution là **internal**:
không xuất hiện trong bất kỳ public subpath nào của Answer, Relations hay
Evidence.

Package/schema export paths:

```text
ail-aadp/modules/evidence/v1.0
ail-aadp/schemas/modules/evidence/v1.0/*
```

Không re-export Evidence API từ package root; tarball consumer không import `src/**`.

## Schema và artifact inventory

```text
schemas/modules/evidence/v1.0/
├── module.schema.json
├── claim.schema.json
├── evidence.schema.json
├── evidence-reference.schema.json
├── source.schema.json
└── provenance.schema.json

spec/modules/evidence/v1.0/
├── specification.md
└── conformance.md

src/modules/evidence/v1.0/
├── types.ts
├── schemas.ts
├── semantic.ts
├── register.ts
├── index.ts
├── client/
│   ├── types.ts
│   ├── errors.ts
│   ├── fetch.ts
│   ├── freshness.ts
│   ├── resolve.ts
│   └── index.ts
└── conformance/
    ├── types.ts
    ├── checks.ts
    ├── report.ts
    ├── runner.ts
    └── index.ts
```

Nếu một file chỉ re-export một symbol và không tăng khả năng test/reuse thì có
thể gộp trong cùng layer; KHÔNG gộp pure semantic, network resolution hoặc
conformance vào route/reference fixture.

## Fixture inventory

Valid fixtures tối thiểu:

- claim tối thiểu với một evidence ref `support`;
- claim với `contradict` và `neutral` ref, có/không `confidence`;
- evidence với `access: public`, provenance đủ ba timestamp;
- evidence với `access: authenticated` (chứng minh `access` chỉ là presentation
  metadata và không đổi kết quả validation hay traversal);
- evidence entity nằm sau resource `security` declaration, để test 401/403 cho ra
  `forbidden` và không bị tính là dangling — phân loại này không đọc `source.access`;
- evidence có `retrieved_at` **sớm hơn** `entity.updated_at` (correction không
  kèm re-retrieval);
- evidence có `excerpt` và Unicode cross-plane key trong Relations `target.x_*`
  (`U+E000` và `U+10000`) với `content_checksum` tính bằng `checksumOf()`;
- answer entity tham chiếu claim qua `related_entities` mà không sửa `x_answer` schema;
- hai claim khác nhau cùng trỏ tới một evidence (fan-in) — evidence chỉ được fetch
  một lần trong một walk nhờ outcome cache;
- answer → claim → evidence hai hop đầy đủ, để test bước expand ở
  §"Orchestration contract";
- answer trỏ **đồng thời** tới evidence E và tới claim C1 (C1 → E), có hai bản
  đảo thứ tự `related_entities` (E trước C1, và C1 trước E) — cả hai phải cho ra
  `EvidenceGraph` tương đương và đúng một lần fetch E;
- answer khai `target_type: claim` cho một canonical target thực chất là evidence,
  trong khi claim C hợp lệ trỏ tới đúng target đó với `target_type: evidence` —
  hai bản đảo thứ tự, để chứng minh verdict theo occurrence không đầu độc lẫn nhau;
- generated-summary answer có `authorship.source_targets` không rỗng, để chứng
  minh `resolveAnswerEvidenceV1` không chạm tới chúng.

Invalid fixtures tối thiểu:

- sai module/version/kind, hoặc wrapper có unknown field;
- thiếu statement/summary/locale/source/provenance/content checksum/canonical URL;
- `content_checksum` sai sau khi mutate từng nhóm field normative
  (`statement`, `evidence_refs`, `source`, `provenance`, `excerpt`);
- `content_checksum` tính theo Unicode code-point ordering thay vì UTF-16 code
  unit ordering;
- `confidence` ngoài `[0,1]`, quá 2 chữ số thập phân, hoặc là string;
- `stance`/`access` ngoài enum;
- timestamp sai format, sai thứ tự, hoặc `retrieved_at` muộn hơn core `updated_at`;
- `evidence_refs[].target_type` khác hằng `evidence` (gồm cả trỏ tới `claim`);
- duplicate canonical target trong `evidence_refs` (kể cả khác `stance`);
- `evidence_refs` rỗng hoặc vượt 50;
- `source.url`/`publisher.url` dùng HTTP, userinfo, fragment, hoặc malformed;
- source URL trỏ private/link-local/reserved address (phải bị URL/DNS policy chặn);
- prompt-injection/HTML/script trong `statement`/`summary`/`excerpt`/`title` vẫn
  inert;
- redirect chain từ evidence URL sang private address.

Fixtures dùng domain `example.com`, tên trung tính, deterministic timestamp. Mỗi
invalid fixture chỉ nên có một primary failure.

## Conformance contract

| Check ID | Nội dung |
|---|---|
| `evidence.discovery` | Manifest quảng bá đúng `{id, version, schema}` |
| `evidence.resource` | Fetch neutral claim và evidence resource qua core flow |
| `evidence.schema` | Wrapper đúng Evidence `1.0` schema |
| `evidence.semantic` | Pure semantic invariants (gồm `content_checksum`) xanh |
| `evidence.context` | Entity type, `x_evidence` presence, canonical URL policy, ordering `provenance.retrieved_at <= entity.updated_at` (KHÔNG phải equality) |
| `evidence.graph` | Claim→evidence resolve, không `not-found`/`invalid`, fan-in dedup đúng (một evidence chỉ fetch một lần) |
| `evidence.stance` | Stance/confidence semantics và vắng-confidence không bị suy diễn |
| `evidence.provenance` | Timestamp ordering, precedence và freshness classification |
| `evidence.answer_link` | Answer `related_entities` tới claim/evidence resolve được, claim được expand tới evidence (hai hop), `x_answer` không đổi |
| `evidence.security` | Free text inert; URL/DNS/redirect policy; `access` không cấp quyền |

Runner hỗ trợ server có auth theo cùng option boundary với Relations/Answer.
Report phân biệt failed check, unsupported module và traversal/budget failure.
External consumer clean-install chỉ dùng public exports phải đạt toàn bộ required
checks.

Unsupported Evidence version không phải remote deployment check; kiểm bằng
synthetic manifest/entity trong package compatibility suite: core-only consumer
bỏ qua `x_evidence`; opt-in consumer trả `unsupported_module_version` và không
fallback.

## Security và privacy contract

- Mọi free text (`statement`, `summary`, `excerpt`, `title`, `publisher.name`,
  `notes`) là untrusted data; package không nối vào system prompt, shell, HTML
  hoặc executable template.
- `source.url`, `publisher.url` và `entity.canonical_url` là metadata, KHÔNG được
  validator/client tự fetch. Chỉ target trong `evidence_refs`/`related_entities`
  được fetch, và chỉ qua Relations URL/DNS policy khi caller opt in.
- `content_checksum` chỉ phát hiện tampering trong phạm vi hash; nó KHÔNG phải
  chữ ký, không chứng minh producer trung thực, không thay thế TLS.
- Redirect, DNS rebinding, private/link-local/reserved address và credential leak
  behavior kế thừa policy hiện có; Evidence không có networking bypass.
- Authorization được kiểm tra trước khi trả claim/evidence/target.
  `source.access` là metadata, KHÔNG cấp quyền truy cập.
- Một budget = một resolution context bất biến, theo đúng contract đã phát hành ở
  `1.3.1`: canonical outcome cache và in-flight request KHÔNG bao giờ được dùng
  chung giữa hai call khác nhau ở bất kỳ option request-affecting nào; mismatch
  fail closed bằng `AadpClientError` (`code: "resolution_context_mismatch"`),
  không phải bằng cache hit. Evidence kế thừa check này qua shared layer và không
  có đường vòng.
- Conformance output không log toàn bộ private payload hoặc auth header mặc định.
- Stance/confidence/publisher là assertion của producer; schema validity không
  chứng minh assertion trung thực, cũng không chứng minh factual truth,
  authenticity hay legal validity.

## Work packages

### Phase 0 — ADR và normative specification

> **Trạng thái: draft đã viết xong, chờ maintainer.**
> [`docs/adr/0010-evidence-citation-provenance-and-security.md`](../../adr/0010-evidence-citation-provenance-and-security.md)
> (**Proposed**), [`spec/modules/evidence/v1.0/specification.md`](../../../spec/modules/evidence/v1.0/specification.md)
> và [`conformance.md`](../../../spec/modules/evidence/v1.0/conformance.md) (cả
> hai **Draft — non-normative**) đã bao phủ đủ các quyết định liệt kê ở
> §"Dependency bắt buộc". Bước tiếp theo là **quyết định của maintainer**, không
> phải việc code: chỉ khi ADR chuyển sang Accepted thì Phase 2 mới mở. Không
> artifact nào dưới `schemas/modules/evidence/v1.0/` được tạo trước mốc đó.

1. Tạo ADR-0010 citation/provenance/security, Accepted trước mọi wire code, phủ
   đủ bảy quyết định ở §"Dependency bắt buộc".
2. Viết `spec/modules/evidence/v1.0/specification.md` từ contract đã khóa.
3. Viết `conformance.md`, stable check IDs, ranh giới normative/advisory.
4. Ghi rõ trong ADR quyết định "Answer integration không sửa `aadp:answer@1.0`"
   và quyết định freshness là client-computed.
5. Ratify **composition API** giữa các module: trích xuất tầng canonical
   resolution khoá theo budget thành shared internal layer (§"Orchestration
   contract"), thay vì thêm selector vào `resolveAnswerTargets` hay để Evidence
   tự resolve bằng raw Relations trên budget dùng chung. Ghi kèm lý do
   compatibility: đây là refactor patch-level của Answer theo ADR-0007.
6. Ghi nhận **resolution context** như contract đã phát hành ở `1.3.1` (tập
   option tạo nên context identity, digest không lưu secret, fail-closed khi
   mismatch) và ratify rằng shared canonical resolution layer kế thừa nguyên nó,
   không định nghĩa lại và không có đường vòng cho Evidence. Không còn quyết định
   compatibility nào phải ra ở bước này.

Gate: maintainer review ADR/spec; không còn TODO ảnh hưởng schema hoặc semantics.

### Phase 1 — Generic server module support (nợ `1.3.0`, không phụ thuộc Phase 0)

> **Trạng thái: đã implement.** `src/validator/extension-keys.ts`
> (`isExtensionKey`/`EXTENSION_KEY_GRAMMAR`, export qua `ail-aadp/validator`),
> `AadpServerConfig.modules`, `SerializedEntity.extensions` và emission/validation
> tương ứng trong `src/server/runtime.ts`; test ở `tests/server/modules.test.ts`.
> Gate "không có tên module cụ thể trong `src/server/**`" được thực thi bằng test
> chứ không chỉ bằng review. Toàn bộ suite hiện có xanh không sửa test nào.

1. Export shared extension-key predicate từ grammar core đã phát hành
   (`^x_[a-zA-Z0-9_]*$`); không inline regex mới ở server layer.
2. Thêm `AadpServerConfig.modules` và phát `modules[]` trong manifest builder.
3. Thêm `SerializedEntity.extensions` và emit `x_*` trong `entity()`.
4. Validate grammar bằng predicate dùng chung, core-field collision, JSON-safety;
   không mutate input.
5. Test boundary theo đúng released regex: `x_Foo` (uppercase), `x_1`
   (digit-leading) và `x_` (empty suffix) đều phải **được chấp nhận**; `y_foo`,
   `xfoo`, `X_foo` phải bị từ chối. Test này là hàng rào chống việc vô tình siết
   grammar hẹp hơn core.
6. Test compatibility: config không có `modules`/`extensions` cho ra manifest và
   entity byte-identical với `1.3.0`.
7. Test checksum ổn định: thêm `extensions` không đổi core `checksum`.

Gate: server/core/Relations/Answer regression suite xanh; không có tên module cụ
thể trong `src/server/**`.

### Phase 2 — Schema, types và fixtures

1. Tạo schema inventory, `$id` ổn định, cross-module `$ref` tới Relations target.
2. Tạo TypeScript types khớp schema; compile-time public surface tests.
3. Tạo valid/invalid fixtures theo inventory; digest sinh bằng `checksumOf()`,
   không copy tay.
4. Thêm checksum/release consistency coverage cho Evidence schema artifacts.

Gate: schema/fixture/type tests xanh; schema và types không lệch nhau.

### Phase 3 — Registry và semantic validation

1. Implement pure helpers: locale, timestamp ordering/precedence, confidence,
   target uniqueness, `content_checksum`.
2. Đăng ký exact keys `{aadp:evidence, 1.0, claim}` và `{aadp:evidence, 1.0, evidence}`.
3. Test unsupported module/version/kind và không fallback.
4. Implement/test `validateEvidenceEntityV1`/`parseEvidenceEntityV1` mà không đổi
   generic registry signature.
5. Test core-only validation vẫn bỏ qua `x_evidence` an toàn.
6. Test tamper fixtures cho từng nhóm field normative.

Gate: deterministic semantic results; không network, không wall clock.

### Phase 4 — Client, traversal và Answer integration

1. **Trích xuất shared canonical resolution layer** từ
   `src/modules/answer/v1.0/client/resolve.ts` sang
   `src/modules/shared/canonical-resolution.ts`: `WeakMap` theo budget,
   `resolveCanonicalTarget`, `pending`, `globalStops`. Refactor Answer để consume
   nó, **mang theo nguyên resolution context binding đã phát hành ở `1.3.1`**
   (`resolution-context.ts` chuyển cùng, không fork bản thứ hai). **Bằng chứng
   bắt buộc: toàn bộ test Answer hiện có pass mà không sửa test nào** — kể cả
   `tests/modules/answer/v1.0/client/resolution-context.test.ts` — và layer mới
   không xuất hiện trong bất kỳ public export nào.
2. Không phải làm lại: context binding, digest HMAC theo process, hành vi
   fail-closed và mã lỗi `resolution_context_mismatch` đã ship ở `1.3.1`. Bước
   duy nhất còn lại là bảo đảm **mọi** đường vào tầng dùng chung đi qua cùng một
   check — không có entry point nào của Evidence bỏ qua nó.
3. Mở rộng test context sang đường Evidence: `resolveAnswerEvidenceV1` và
   `resolveAnswerTargets` trên **cùng budget nhưng khác context** phải throw, ở
   cả hướng tuần tự lẫn concurrent race, và message lỗi vẫn không rò
   header/digest.
4. Implement `fetchEvidenceEntityV1` bằng core fetch rồi Evidence validation.
5. Implement `EvidenceGraph` builder: node theo canonical target,
   `references[]`/`edges[]` theo occurrence, ordering theo §"Orchestration
   contract".
6. Implement `resolveClaimEvidenceV1` (bước 4-6) trên shared canonical resolver.
7. Implement `resolveAnswerEvidenceV1` (bước 1-6), **gồm bước expand
   `evidence_refs` của claim đã resolve**; tự collect `related_entities` đã lọc,
   **KHÔNG gọi `resolveAnswerTargets`**; không sửa public API của Answer.
8. Implement injected-clock freshness classifier.
9. Test abort, ordering, authorization, partial result, budget exhaustion, URL
   policy và dangling classification theo bảng ở §"Graph và traversal policy" —
   gồm case 401/403 được phân loại `forbidden` mà không cần đọc `source.access`.
10. Test riêng cho orchestration: hai hop đầy đủ; fan-in C1/C2 → E fetch một lần;
    **cả hai thứ tự** (E trực tiếp trước C1, và C1 trước E trực tiếp) cho graph
    tương đương; node/edge ordering deterministic; edge vẫn tồn tại khi node đích
    không resolve.
11. Test composition boundary: generated-summary Answer đi qua
    `resolveAnswerEvidenceV1` **không phát sinh request nào** tới
    `authorship.source_targets`; và mixed-type cả hai chiều (reference sai
    `target_type` trước/sau reference đúng) cho verdict độc lập, đúng một lần fetch.
12. Test cross-module: một walk trộn `resolveAnswerTargets` và
    `resolveAnswerEvidenceV1` trên **cùng budget và cùng context** không sinh
    `invalid` giả cho canonical target mà module kia đã fetch.

Gate: không duplicate HTTP/DNS/budget implementation; Answer public API, wire
contract và test suite hiện có không đổi.

### Phase 5 — Reference resources (nợ `1.3.0`)

> **Trạng thái item 1: đã implement.** `examples/reference-server` publish
> resource `answer` (`src/data/answer-repository.js`,
> `src/resources/answer-resource.js`) qua `SerializedEntity.extensions`, khai
> báo `aadp:answer@1.0` trong manifest `modules[]`, chỉ dùng public subpath
> (`ail-aadp/server`, `ail-aadp/canonical-json`). Test interop ở
> `tests/package/reference-server.test.ts` chứng minh entity đã publish pass
> `validateAnswerEntityV1` end-to-end và mọi `related_entities` target resolve
> được. Answer `1.0` bắt buộc `canonical_url` HTTPS tuyệt đối, nên example
> phải chạy dưới `AADP_BASE_URL` HTTPS để answer entity hợp lệ — đúng môi
> trường mà §"External conformance environment" yêu cầu.

1. Dựa trên Phase 1, thêm neutral Answer repository/resource vào
   `examples/reference-server` (khoản nợ Phase 3 item 4 của `1.3.0`).
2. Thêm neutral claim và evidence resource, gồm: một answer → claim → evidence
   hai hop, một evidence được hai claim dùng chung (fan-in), một evidence có
   `retrieved_at` **sớm hơn** `updated_at` (để `evidence.context` chạy đúng
   ordering invariant chứ không phải equality), và một evidence resource có
   `security` declaration để sinh `forbidden` hợp lệ.
3. Khai báo `aadp:answer@1.0` và `aadp:evidence@1.0` trong manifest `modules`,
   chỉ sau khi artifacts và endpoint đã sẵn sàng. (`aadp:answer@1.0` đã khai
   báo cùng item 1; `aadp:evidence@1.0` chờ item 2.)
4. Reference server không chứa reusable protocol logic hoặc business rule.

Gate: reference server publish được cả ba entity type qua generic support duy nhất.

### Phase 6 — Conformance, package exports và release hardening

1. Implement Evidence checks/report/runner theo conformance contract.
2. Export versioned module/schema subpaths; đưa artifacts vào npm tarball.
3. Clean-install external consumer test không import internals.
4. Chạy `runAnswerConformance` **và** `runEvidenceConformance` từ packed tarball
   trên reference deployment thật, với `baseUrl`/`sampleEntityUrl` thật qua HTTP
   (khoản nợ Phase 5 item 3 của `1.3.0`).
5. Chạy malicious-citation/security fixtures và synthetic unsupported-version suite.
6. Review immutable wire artifacts, record schema checksums, cập nhật README,
   CHANGELOG, docs index/roadmap và implementation record.

Gate: release checklist được hai maintainer duyệt, gồm một reviewer không viết
schema implementation chính.

## External conformance environment

Gate external conformance đã defer từ `1.3.0` không được đóng bằng mock server
hoặc unit test. Điều kiện tối thiểu:

| Thuộc tính | Yêu cầu |
|---|---|
| Owner | Một maintainer được nêu tên trong implementation record |
| Môi trường | Reference server deploy tại một origin HTTPS thật, reachable từ CI |
| Client | `ail-aadp` cài từ packed tarball, clean install, chỉ public exports |
| Transport | HTTP thật, không in-process handler, không fetch mock |
| Bằng chứng | Report JSON của cả Answer và Evidence với overall `passed`, lưu trong implementation record |
| Node floor | Chạy trên supported Node engine floor khai báo trong `package.json` |

## File map dự kiến

Ngoài inventory mới, các file hiện có dự kiến thay đổi:

- `src/validator/*` hoặc core shared module: export extension-key predicate dùng
  chung từ grammar `^x_[a-zA-Z0-9_]*$` (chưa tồn tại trong repo hiện tại).
- `src/server/types.ts`: `SerializedEntity.extensions`, `AadpServerConfig.modules`.
- `src/server/runtime.ts`: manifest `modules` emission, entity `x_*` emission,
  extension validation.
- `src/server/index.ts`: export type mới nếu cần.
- `package.json`: package version, Evidence exports và schema export path.
- `src/modules/shared/canonical-resolution.ts` (mới, internal): per-budget
  canonical outcome state trích từ Answer resolver, dùng chung cho Answer và
  Evidence. Không export từ public subpath nào.
- `src/modules/answer/v1.0/client/resolve.ts`: refactor để consume layer trên.
  Public API và wire contract không đổi; toàn bộ test Answer hiện có là
  regression proof và **không được sửa** (không còn ngoại lệ nào — hành vi
  fail-closed xuyên resolution context đã ship và đã có test ở `1.3.1`).
- `src/modules/answer/v1.0/client/resolution-context.ts` (đã tồn tại từ `1.3.1`):
  di chuyển sang cùng shared layer, giữ nguyên contract; không tạo bản sao thứ hai.
- `src/module-registry/*`: chỉ sửa nếu Evidence làm lộ bug generic; không thêm
  Evidence-specific branch.
- `examples/reference-server/*`: Answer, claim và evidence resource + manifest
  module declaration.
- `tests/server/*`: module declaration, extension emission, compatibility và
  checksum stability.
- `tests/modules/evidence/v1.0/*`: registration, schema, semantic, client,
  conformance.
- `tests/package/*`: exports, tarball, compatibility, external clean install.
- `README.md`, `CHANGELOG.md`, docs index/roadmap, implementation record 1.4.0.

Không sửa released files dưới `schemas/modules/relations/v1.0`,
`schemas/modules/answer/v1.0` hoặc core schemas v1.0 để làm Evidence tests pass.

## Verification matrix

| Layer | Verification bắt buộc |
|---|---|
| Specification | Doc links, no unresolved normative TODO, examples schema-valid |
| Server (generic) | Module declaration, `x_*` grammar **đúng bằng core** (uppercase `x_Foo`, digit-leading `x_1`, bare `x_`), collision, JSON-safety, no-mutation, checksum stability, omit-behavior identical với `1.3.0` |
| Schema | Valid/invalid fixtures, exact `$id`, closed objects, cross-module `$ref`, immutability digest |
| Semantic | Locale, code points, timestamp order/precedence, confidence, duplicates, content checksum |
| Registry | Exact dispatch cho hai kind; unsupported module/version/kind; no fallback |
| Client | Resolution order, abort, auth, shared budget, hai-hop expand, fan-in dedup, mixed-order và mixed-type equivalence, `EvidenceGraph` node/reference/edge ordering, partial result, injected-clock freshness |
| Composition | Shared canonical layer không rò ra public export; Answer test suite pass không sửa; `source_targets` không bị fetch; trộn Answer/Evidence trên cùng budget/context không sinh `invalid` giả |
| Resolution context | Test `1.3.1` pass nguyên trạng sau refactor; thêm chiều Evidence (Answer↔Evidence cùng budget, khác context) fail closed ở cả tuần tự lẫn concurrent; error message không rò header hay digest |
| Answer integration | `x_answer` schema/validation result không đổi; helper resolve claim/evidence đúng |
| Security | Inert malicious text, URL/DNS/redirect policy, `access` không cấp quyền, no sensitive logging |
| Conformance | Stable check IDs, required/optional behavior, external implementation |
| Package | TypeScript build, exports, packed tarball, clean install, Node engine floor |
| Regression | Core, server, Relations, Answer và toàn bộ suite hiện có xanh |

Lệnh release verification tối thiểu:

```bash
npm run build
npm test
npm run docs:check
npm run check:release-consistency
npm pack --dry-run
```

Ngoài các lệnh trên phải chạy clean-install/tarball suite và external conformance
theo §"External conformance environment"; `npm pack --dry-run` đơn lẻ không phải
bằng chứng public exports hoạt động.

## Release gate

Release `1.4.0` chỉ được phép khi:

- ADR-0010 và specification/conformance Evidence `1.0` Accepted, không còn
  normative TODO.
- Package/core/Relations/Answer/Evidence version matrix nhất quán.
- Generic server module support là generic: không có tên module cụ thể trong
  `src/server/**`, và config omit `modules`/`extensions` cho output không đổi so
  với `1.3.0`.
- Core entity `checksum` không đổi khi entity mang extension.
- Không có reference `not-found`/`invalid` trong conformance run; `forbidden` do
  authorization/URL policy là kết quả hợp lệ.
- Graph traversal dùng shared Relations budget, fan-in dedup và partial-result
  model; không có network stack riêng cho Evidence.
- `resolveAnswerEvidenceV1` expand claim tới evidence (hai hop) và cho kết quả
  tương đương ở mọi thứ tự `related_entities`; mỗi evidence fetch đúng một lần
  trong một walk.
- Canonical outcome được cache dùng chung theo budget, còn verdict `target_type`
  tính riêng cho từng occurrence; không reference nào đầu độc verdict của
  reference khác.
- Shared canonical resolution layer là internal, Answer chỉ bị refactor và toàn
  bộ test Answer hiện có pass không sửa; `authorship.source_targets` không bị
  Evidence helper fetch.
- Resolution context binding (`1.3.1`) vẫn fail closed sau refactor, ở cả đường
  tuần tự lẫn concurrent và ở cả entry point Evidence; không có kết quả protected
  nào rò sang call có context khác.
- Generic server dùng đúng extension grammar của core v1.0 qua predicate dùng
  chung; boundary test `x_Foo`/`x_1`/`x_` xanh.
- Stance/confidence/provenance semantics deterministic, có invalid fixture cho
  từng invariant normative.
- Answer `1.0` artifact không bị sửa; Answer public API và validation result
  không đổi; không duplicate evidence payload trong `x_answer`.
- Core-only consumer bỏ qua `x_evidence` an toàn; opt-in consumer báo
  `unsupported_module_version` cho version không hỗ trợ.
- **(Nợ `1.3.0`)** Reference server publish được Answer, claim và evidence entity
  qua generic module support ở server layer.
- **(Nợ `1.3.0`)** External conformance chạy từ packed tarball trên reference
  deployment đạt overall `passed` cho Answer `1.0` VÀ Evidence `1.0`. Gate này
  không được đóng bằng mock server hay unit test.
- Released wire schema có checksum record và immutable theo module version.

## Điều kiện chuyển toàn bộ kế hoạch sang Implementation Ready

- [ ] ADR-0010 citation/provenance/security Accepted.
- [ ] Wire model cho claim/evidence/source được khóa trong specification.
- [ ] Answer integration contract xác nhận không sửa `aadp:answer@1.0`.
- [x] Graph integrity, acyclicity và traversal budget semantics đã cụ thể (§"Graph và traversal policy").
- [x] Generic server public API đã chọn và ghi compatibility contract.
- [x] File map và phase ordering đã bổ sung.
- [x] Test/conformance matrix có stable expected outcomes.
- [x] Reference deployment và packed-tarball execution flow đã mô tả.
- [ ] External interoperability evidence có owner và môi trường chạy xác định.
- [x] Release checklist gồm docs, exports, digests và implementation record.

## Definition of Done

- Tất cả work package và gate hoàn tất, không chỉ schema/type implementation.
- Reference server quảng bá module chỉ khi resource và artifacts đã deploy.
- Documentation tiếng Việt/Anh nhất quán thuật ngữ `claim`/`evidence`/`source`;
  không còn normative example dùng Evidence `v0.1`.
- Không có fact-checking, truth scoring hoặc trust score bị kéo vào package.
- Không có Ailmao-specific fixture hoặc import `src/**` trong consumer path.
- Implementation record ghi quyết định, artifact checksum, verification commands
  và kết quả external conformance trước khi tag `ail-aadp@1.4.0`.

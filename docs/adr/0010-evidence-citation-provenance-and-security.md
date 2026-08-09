# ADR-0010: Evidence Module — citation, provenance và security boundary

## Status

**Proposed** — draft cho Evidence & Provenance Module `1.0` và package
`ail-aadp@1.4.0`. Chưa Accepted.

Chừng nào ADR này chưa Accepted thì **KHÔNG được tạo bất kỳ wire artifact nào**
của Evidence: không schema dưới `schemas/modules/evidence/v1.0/`, không public
type, không registry key. Released schema là immutable theo
[ADR-0004](0004-backward-compatibility.md) và
[ADR-0007](0007-module-versioning-and-discovery.md), nên một quyết định sai
được đóng băng vào wire sẽ phải trả bằng một major version trước cả lần release
đầu tiên. Một module version xuất hiện trong ví dụ ở đây KHÔNG được coi là đã
allocated.

Acceptance là quyết định của maintainer. Developer/reviewer không được tự
chuyển trạng thái này.

## Context

Answer Module `1.0` ([ADR-0009](0009-answer-module-terminology-and-security.md))
cố ý **không** có field `evidence`, `claims` hay `citations`: nó mô tả câu trả
lời, không mô tả căn cứ của câu trả lời. Khoảng trống đó là mục tiêu của
`1.4.0`.

Mô tả căn cứ đòi hỏi ba khái niệm mới — claim (điều được khẳng định), evidence
(thứ được viện dẫn), source (nơi evidence đến từ) — và mỗi khái niệm kéo theo
một quyết định contract mà schema không tự trả lời được:

- ba khái niệm đó là document kind riêng, resource type, hay object lồng;
- cạnh giữa chúng thuộc về ai, cardinality bao nhiêu, và điều gì xảy ra khi một
  cạnh không resolve được;
- identity nào để dedup, khi cùng một evidence được nhiều claim viện dẫn;
- timestamp nào mô tả "thời điểm của evidence" khi có tới ba mốc thời gian;
- `confidence` và `stance` mang nghĩa gì, và ai được phép tính lại chúng;
- source private/authenticated/cross-origin được xử lý ra sao — đây là chỗ dễ
  nhất để một metadata field vô tình trở thành cơ chế authorization;
- Answer liên kết tới evidence bằng đường nào mà **không** sửa artifact
  `aadp:answer@1.0` đã phát hành;
- tầng nào sở hữu canonical resolution cache khi hai module cùng đi trên một
  traversal budget.

Nguồn của các đề xuất dưới đây là
[implementation plan 1.4.0](../vi/plans/implementation-plan-v1.4.0.md) §"Quyết
định contract đề xuất" và §"Graph và traversal policy", sau năm vòng review.

## Decision

### 1. Document kind: `claim` và `evidence` là document kind, `source` là object lồng

| Khái niệm | Hình thức | Lý do |
|---|---|---|
| `claim` | Document kind `claim` trên entity `type: "claim"`, mang ở `x_evidence` | Nhiều answer/claim tham chiếu tới → cần identity và URL riêng |
| `evidence` | Document kind `evidence` trên entity `type: "evidence"` | Nhiều claim cùng viện dẫn → fetch độc lập để không nhân bản payload |
| `source` | Object lồng trong evidence | Không consumer nào cần resolve source độc lập ở `1.0`; tách ra chỉ thêm một hop traversal |

Registry dispatch bằng exact key `{aadp:evidence, 1.0, claim}` và
`{aadp:evidence, 1.0, evidence}`, đúng cơ chế ADR-0007. Không có standalone
collection kind hay registry kind ở `1.0`; listing tiếp tục dùng core
sitemap/resource flow.

### 2. Cạnh, cardinality và integrity

- Cạnh duy nhất là `claim.evidence_refs[]` — **claim sở hữu cạnh**, evidence
  không biết claim nào viện dẫn mình.
- 1-50 reference cho mỗi claim. Không cho phép mảng rỗng: một claim không có
  căn cứ nào thì không phải claim trong module này.
- `evidence_refs[].target_type` là **hằng `evidence`**, không phải free token.
- Reference không resolve được KHÔNG làm claim invalid. Nó tạo một entry có
  status, theo đúng vocabulary `AnswerTargetResolutionStatus` đã phát hành
  (`resolved` | `forbidden` | `not-found` | `invalid` | `budget-exhausted`) —
  không tạo enum mới.
- Chỉ `not-found` và `invalid` là **dangling**. `forbidden` (401/403 hoặc bị
  URL/DNS policy chặn) là kết quả hợp lệ của một graph lành mạnh, không phải
  graph gãy.

### 3. Không có reverse edge — acyclic by construction

Evidence `1.0` KHÔNG định nghĩa cạnh evidence → claim. Hệ quả: wire model
**không biểu diễn được cycle nào**, nên module này KHÔNG có cycle policy, cycle
guard, rule self-reference, hay cycle fixture — không phải vì cycle được cho
phép, mà vì nó không tồn tại.

Nhiều claim cùng trỏ tới một evidence là **fan-in**, không phải cycle.

Nếu một version sau thêm reverse edge thì version đó phải định nghĩa ownership
của cạnh mới cùng cycle policy tương ứng, trong một ADR riêng.

### 4. Canonical identity và dedup

Canonical identity của một target tái sử dụng nguyên trạng Relations semantic
identity `{id, normalizedUrl}`. Evidence KHÔNG định nghĩa identity rule mới.

Dedup xảy ra ở hai tầng khác nhau và cả hai đều cần thiết:

- `RelationsTraversalBudgetState.visitedTargets` cho **kế toán budget**;
- shared canonical outcome cache (khoá theo budget) cho **tái dùng entity đã
  fetch**.

Trong một `evidence_refs`, hai phần tử MUST NOT có cùng canonical identity, kể
cả khi `stance` khác nhau — hai stance cho cùng một evidence phải tách thành hai
claim.

### 5. Provenance: ba timestamp, một quy tắc precedence

`published_at` và `retrieved_at` bắt buộc, `modified_at` optional; RFC 3339 UTC
dạng `Z`, precision tối đa milliseconds, cùng profile với Answer `1.0`.

Invariant: `published_at <= retrieved_at`, và khi có `modified_at` thì
`published_at <= modified_at <= retrieved_at`.

"Thời điểm của evidence" = `modified_at` nếu có, ngược lại `published_at`.
`retrieved_at` mô tả thời điểm producer lấy source về và MUST NOT được dùng làm
ngày của nội dung.

Với entity `type: "evidence"`, quan hệ với core `updated_at` là **ordering, không
phải equality**: `provenance.retrieved_at <= entity.updated_at`. Đây là khác
biệt có chủ ý so với Answer `1.0` (nơi `freshness.updated_at === entity.updated_at`
đúng vì cả hai mô tả cùng một sự kiện). Ở Evidence, hai timestamp mô tả hai sự
kiện độc lập; ép chúng bằng nhau sẽ khiến mọi correction không kèm re-retrieval
(sửa `summary`, `locale`, `excerpt`, `publisher.name`) tạo ra entity invalid, ép
producer khai man provenance.

`publisher` là assertion của producer về nơi xuất bản source, KHÔNG phải
verified identity, KHÔNG phải chữ ký, và không tham gia bất kỳ quyết định
authorization nào.

### 6. Freshness là client-computed, không phải publisher metadata

Evidence `1.0` KHÔNG có field `expires_at` và KHÔNG có field `freshness`.
Phân loại `fresh`/`stale` là hàm thuần với injected clock ở client
(`classifyEvidenceFreshness`), dựa trên precedence ở §5. Pure validator MUST NOT
đọc wall clock.

### 7. `stance` và `confidence` là assertion, không phải kết luận

- `stance` là enum đóng `support` | `contradict` | `neutral`, mô tả **quan hệ
  producer khẳng định giữa evidence và claim**, không phải truth value của claim.
- `neutral` nghĩa "liên quan nhưng producer không khẳng định hướng" — KHÁC với
  vắng mặt reference.
- `confidence` là number trong `[0, 1]`, tối đa 2 chữ số thập phân, do producer
  khai báo. Không có đơn vị thống kê, không so sánh được giữa hai publisher, và
  client trong package này MUST NOT tính lại hay tổng hợp nó thành score.
- Vắng `confidence` nghĩa "không khai báo" — không phải `0`, không phải `1`.
- Validator MUST NOT suy luận stance từ free text và MUST NOT language-detect.

Schema validity của một Evidence document MUST NOT được diễn giải thành factual
truth, authenticity hay legal validity. Module này không fact-check, không
ranking, không trust score, không reputation của publisher.

### 8. `source.access` là presentation metadata, KHÔNG phải authorization

`source.access` (`public` | `authenticated` | `restricted`) là assertion của
producer về **source nằm ngoài AADP** — thứ mà `1.0` không bao giờ fetch. Nó
MUST NOT tham gia bất kỳ quyết định traversal, authorization hay conformance
nào. Giá trị hợp lệ duy nhất của nó là hiển thị cho người đọc biết source có
paywall/đăng nhập hay không.

Hai lý do khiến nó không thể là input authorization:

1. nó mô tả source URL lồng bên trong evidence, không mô tả security của chính
   AADP evidence resource;
2. khi target trả 401/403 thì client **không có** body để đọc `source.access` —
   giá trị đó không tồn tại đúng lúc cần phân loại.

Authorization của evidence resource do core/Relations authorization và manifest
`security` declaration quyết định. Mọi 401/403 đều là `forbidden`, độc lập với
`source.access`.

### 9. Answer integration không sửa `aadp:answer@1.0`

Answer `1.0` là released immutable contract và wrapper của nó không có extension
point. Vì vậy:

- Answer liên kết tới claim/evidence **chỉ qua `related_entities`** đã có sẵn,
  với `target_type` là `claim` hoặc `evidence`.
- KHÔNG dùng `authorship.source_targets`: field đó có nghĩa hẹp là input source
  của một generated summary; ép nó mang nghĩa citation sẽ làm sai provenance.
- Integration chỉ thêm helper và conformance check **ở tầng Evidence**;
  `AnswerValidationResult`, `AnswerEntityValidationResult` và tập payload hợp lệ
  của Answer `1.0` không đổi.
- Muốn thêm field citation vào Answer thì phải phát hành `aadp:answer@1.1` hoặc
  `2.0` — KHÔNG sửa artifact `1.0`.

### 10. Composition: shared canonical resolution layer, internal

`resolveAnswerTargets` giữ per-budget resolution state
(`WeakMap<budget, BudgetResolutionState>`) với canonical outcome, in-flight join
và budget-stop replay. State đó là **shared infrastructure, không phải chi tiết
riêng của Answer**: một canonical key mà Answer resolver chưa từng chạm tới —
ví dụ được charge bởi một raw Relations step trên cùng budget — bị report là
`invalid`. Nếu Evidence tự resolve bằng Relations resolver trên budget dùng
chung, chính nó tạo ra false `invalid` cho Answer.

Quyết định: **trích xuất tầng này thành shared internal layer khoá theo budget**
(`src/modules/shared/canonical-resolution.ts`), Answer refactor để consume nó,
Evidence dùng đúng nó cho mọi fetch.

- Layer này MUST NOT được export từ bất kỳ public subpath nào — cùng lý do
  `releaseNode` của Relations được giữ module-internal: precondition của nó
  không kiểm tra được từ ngoài.
- Với Answer đây là **pure refactor**, patch-level theo ADR-0007: public API,
  wire contract và normative semantic result không đổi. Bằng chứng regression là
  toàn bộ test Answer hiện có pass mà không sửa một dòng nào.
- Cache lưu **canonical outcome** (kết quả fetch/schema/checksum của một target),
  KHÔNG lưu verdict theo reference. Verdict `target_type` được tính lại cho từng
  occurrence, để một reference khai sai type không đầu độc reference khác trỏ
  tới cùng target.

Ba đường thay thế đều bị loại: thêm selector vào `resolveAnswerTargets` là đổi
public API của Answer; dựng synthetic Answer document để lách collection sẽ tạo
document sai schema/checksum; tự viết lại orchestration là duplicate network
stack.

### 11. Resolution context: kế thừa nguyên contract đã phát hành ở `1.3.1`

Ràng buộc "một budget = một request context bất biến, mismatch fail closed bằng
`AadpClientError` với `code: "resolution_context_mismatch"`" **đã được phát hành
ở `1.3.1`** như một security fix của Answer client. ADR này KHÔNG định nghĩa lại
nó; nó chỉ chốt rằng shared canonical resolution layer kế thừa nguyên contract
đó, và Evidence KHÔNG có entry point nào bỏ qua check này.

## Consequences

- Evidence có thể release mà không chạm vào artifact `aadp:answer@1.0` hay
  `aadp:relations@1.0`; Answer consumer hiện tại không thấy khác biệt nào.
- Không có cycle machinery nào phải viết, test hay audit — vì model không biểu
  diễn được cycle. Đổi lại, thêm reverse edge sau này là một quyết định lớn cần
  ADR riêng, không phải một minor bump.
- Producer phải tính thêm một digest (`content_checksum`) cho `x_evidence`,
  nhưng tái sử dụng 100% `checksumOf()` đã released — không thêm thuật toán mới
  cần audit.
- Answer client bị refactor để consume shared layer. Blast radius lớn dù public
  API không đổi, nên test suite Answer hiện có trở thành gate regression bắt
  buộc, không được sửa để làm refactor pass.
- `source.access` sẽ trông như một security field với người đọc lướt qua. Rủi ro
  đó được nhận diện và trả bằng tài liệu: spec, schema description và
  conformance check `evidence.security` đều phải nói rõ nó không cấp quyền.
- Nếu một version sau có API retrieval cho source thì `access` mới có thêm vai
  trò, và vai trò đó phải do ADR mới định nghĩa.

## References

- [ADR-0001](0001-checksum-algorithm.md) (checksum và canonical JSON),
  [ADR-0004](0004-backward-compatibility.md) (immutability),
  [ADR-0007](0007-module-versioning-and-discovery.md) (module versioning),
  [ADR-0008](0008-module-traversal-and-authorization.md) (traversal budget và
  authorization),
  [ADR-0009](0009-answer-module-terminology-and-security.md) (Answer/Evidence
  boundary).
- [`docs/vi/plans/implementation-plan-v1.4.0.md`](../vi/plans/implementation-plan-v1.4.0.md)
  — kế hoạch triển khai và nguồn của mọi quyết định ở trên.
- [`docs/vi/plans/implementation-plan-v1.3.1.md`](../vi/plans/implementation-plan-v1.3.1.md)
  — resolution context binding đã phát hành.
- `spec/modules/evidence/v1.0/specification.md`,
  `spec/modules/evidence/v1.0/conformance.md` (draft, chờ ADR này Accepted).

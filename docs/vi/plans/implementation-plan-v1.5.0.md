# Kế hoạch triển khai `ail-aadp` 1.5.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Implementation Draft — Phase 0 **Complete** ([ADR-0011](../../adr/0011-cross-module-graph-traversal.md) **Accepted** 2026-08-12, type gate `npm run test:types` pass); Phase 1-2 `Ready`, Phase 3-6 vẫn chặn theo dependency riêng |
| Chủ đề | Cross-module graph traversal và composition |
| Dependency | Relations `1.0`, Answer `1.0`, Evidence `1.0` stable — bằng chứng ở [implementation record 1.4.0](../../records/implementation-record-v1.4.0.md), mục "Closed gates" và "External interoperability evidence (closed 2026-08-10)" |
| Wire impact | KHÔNG đổi core schema, KHÔNG đổi `aadp:relations@1.0`, `aadp:answer@1.0`, `aadp:evidence@1.0`. Chỉ thêm package API mới (minor bump theo [roadmap §1](release-roadmap.md)) |
| Review | [review-20260811-194300](../../../.claude/review/review-20260811-194300.md) — bản này được viết lại để đóng finding P1-1..P1-4 và P2-5; P2-6 được đóng bằng cập nhật roadmap §2/§12 |
| Owner | AADP maintainers |

Tài liệu này là **kế hoạch, không phải nguồn normative**. Nguồn binding là
[ADR-0011](../../adr/0011-cross-module-graph-traversal.md); nếu plan và ADR lệch
nhau, **ADR thắng**.

Cố ý KHÔNG viện dẫn `spec/traversal/v1.0/specification.md`: cross-module traversal
là **client-side capability, không phải wire contract**. [ADR-0011 §12.3](../../adr/0011-cross-module-graph-traversal.md)
đã chốt là `1.5.0` KHÔNG publish specification nào — ADR là binding source. Trích
dẫn một "nguồn normative" không tồn tại sẽ khiến release gate có thể được đóng
dựa trên tài liệu không có thật, nên không tài liệu nào của release này được
viện dẫn spec đó.

## Trạng thái theo work package

Bảng per-work-item bắt buộc theo [document conventions §4](../../document-conventions.md).

| # | Work package | Trạng thái | Điều kiện mở khóa |
|---:|---|---|---|
| 0 | [ADR-0011](../../adr/0011-cross-module-graph-traversal.md) cross-module traversal | **`Complete`** (2026-08-12) | Đã đóng: ba open question chốt ở [ADR §12](../../adr/0011-cross-module-graph-traversal.md), type gate `npm run test:types` pass, ADR `Accepted` |
| 1 | Traversal adapter registry + capability negotiation | **`Ready`** | Phase 0 ✓ |
| 2 | Edge matrix + traversal state machine | **`Ready`** | Phase 0 ✓ |
| 3 | Streaming API + deterministic ordering | `Blocked` | Phase 2 (Phase 0 ✓) |
| 4 | Shared budget/accounting contract | `Blocked` | Phase 2 (Phase 0 ✓) |
| 5 | Conformance profile `aadp:graph-traversal@1.0` | `Blocked` | Phase 1-4 |
| 6 | Two neutral data sets + interoperability run | `Blocked` | Phase 5 + owner/deployment được định danh (§"Release gate") |

## Mục tiêu

- Cung cấp **một** traversal service duyệt được graph trải qua nhiều module đã
  phát hành, dùng chung budget, dedupe và security context.
- Giữ nguyên trạng mọi invariant đã phát hành của Relations/Answer/Evidence `1.0`:
  không module client nào bị đổi public API, đổi kết quả semantic, hoặc phát sinh
  request mà version của nó chưa từng phát.
- Cho consumer chỉ dùng core hoặc chỉ dùng một module **không thấy bất kỳ thay đổi
  behavior nào** (compatibility gate).
- Streaming để graph lớn không phải nằm hết trong memory, với ordering không phụ
  thuộc timing.

## Ngoài phạm vi

- Business interpretation, ranking, trust score, dedupe theo nội dung.
- Bất kỳ field mới nào trên core entity/manifest schema hoặc trên ba module `1.0`.
- Fetch URL nằm trong metadata mà module version tương ứng không traverse
  (`evidence.source.url`, `evidence.source.publisher.url`, free text).
- Retry/HTTP policy riêng: traversal service dùng nguyên core HTTP/URL/DNS policy.
- Auth-aware retrieval (thuộc `1.7.0`), attestation/certification (thuộc `1.8.0`).

## Dependency bắt buộc

1. `ail-aadp@1.4.0` đã phát hành; `aadp:relations@1.0`, `aadp:answer@1.0`,
   `aadp:evidence@1.0` immutable.
2. [ADR-0007](../../adr/0007-module-versioning-and-discovery.md),
   [ADR-0008](../../adr/0008-module-traversal-and-authorization.md),
   [ADR-0010](../../adr/0010-evidence-citation-provenance-and-security.md) vẫn Accepted.
3. Gate external interoperability của `1.4.0` **đã đóng ngày 2026-08-10** —
   xem [implementation record 1.4.0 §"External interoperability evidence"](../../records/implementation-record-v1.4.0.md)
   (real HTTPS deployment, packed-tarball clean install, cả hai report `passed`)
   và §"Open gates" của cùng record ("None"). Roadmap §12 đã được đồng bộ theo
   record này.
4. [ADR-0011](../../adr/0011-cross-module-graph-traversal.md) Accepted **trước**
   khi tạo bất kỳ artifact nào của Phase 1-6 — **đã Accepted ngày 2026-08-12**,
   nên dependency này xanh. Ngoại lệ duy
   nhất được phép trước acceptance là **type gate của Phase 0**, gồm đúng ba thứ:
   fixture `tests/types/traversal-api.test-d.ts`, config `tests/types/tsconfig.json`,
   và script `test:types` trong `package.json` (root `tsconfig.json` chỉ include
   `src` nên fixture không tự compile được). Tất cả chỉ khai declaration hoặc cấu
   hình build, không chứa runtime code, không nằm dưới `src/traversal/**` hay
   `spec/traversal/**`, và tồn tại chính để chứng minh public API block compile
   được **trước** khi ADR chốt. Không có chúng thì gate "block phải compile trước
   khi Accepted" và gate "không artifact trước khi Accepted" khóa lẫn nhau. Bài học
   của `1.4.0` (implementation đi trước acceptance theo chỉ đạo trực tiếp, xem
   ghi chú §"Trạng thái theo work package" của [plan 1.4.0](implementation-plan-v1.4.0.md))
   KHÔNG lặp lại ở release này.

ADR-0011 khóa tối thiểu các mục sau, và bản `Accepted` có đủ cả sáu
(§1-2 registry, §3-4 edge matrix/state machine, §5-6 negotiation/cycle, §8-9
ordering/streaming, §10 budget, §11 conformance, cùng §12 ba quyết định cuối): ranh giới registry (§"Registry boundary"), edge
matrix (§"Edge matrix"), streaming/ordering contract (§"Streaming contract"),
budget ownership và accounting (§"Budget contract"), capability negotiation
(§"Capability negotiation"), và conformance surface (§"Conformance contract").

## Architecture

```text
consumer
   │
   ▼
graph traversal service          (mới, ail-aadp/traversal/v1.0)
   ├── traversal adapter registry  (mới — capability + expand, KHÔNG validation)
   ├── scheduler (BFS, deterministic order)
   ├── expansion guard (expandedKeys walk-local, ancestor chain, depth)
   └── event emitter (streaming, buffered)
         │
         ▼
shared canonical resolution      (đã có, internal, keyed by budget)
         │
         ▼
versioned module clients ──► core HTTP/URL/DNS policy
         │
         ▼
module registry                  (đã có — schema + pure semantic validator, KHÔNG đổi)
```

Dependency direction là một chiều: traversal → module clients → module registry.
Không có mũi tên ngược. Module registry MUST NOT biết traversal service tồn tại.

## Registry boundary

Đây là phần đóng finding P1-2.

`src/module-registry` đã phát hành với contract hẹp và **giữ nguyên**:

- key exact-match `{moduleId, moduleVersion, kind}` (`ModuleRegistryKey`);
- entry chỉ có `schema`, `validateSemantics?`, `schemaDependencies?`;
- `ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[]` là **pure**:
  docstring hiện tại nói rõ MUST NOT fetch target/collection/schema URL.

Vì vậy `1.5.0` **KHÔNG mở rộng** registry đó. Network orchestration và capability
negotiation nằm ở một registry thứ hai, độc lập:

```ts
/** ail-aadp/traversal/v1.0 — public. */
export interface TraversalAdapterKey {
  /** Namespaced module id, cùng grammar `MODULE_ID_PATTERN` của module registry. */
  moduleId: string;
  /** Module wire version, exact match. Không range, không fallback. */
  moduleVersion: string;
  /** Extension field trên entity mà adapter này đọc, ví dụ "x_evidence". */
  extensionField: `x_${string}`;
}

export interface TraversalAdapterCapabilities {
  /** Entity `type` mà adapter nhận làm nguồn của một edge. */
  sourceKinds: readonly string[];
  /** Edge group adapter này phát ra — dùng cho ordering, xem §"Streaming contract". */
  edgeGroups: readonly string[];
  /** Adapter có bao giờ phát request không. Adapter leaf-only (không) vẫn hợp lệ. */
  fetchesTargets: boolean;
}

export interface TraversalAdapter<TDoc = unknown> {
  readonly key: TraversalAdapterKey;
  readonly capabilities: TraversalAdapterCapabilities;
  /**
   * Bước BẮT BUỘC trước `planEdges`. Validate extension payload của entity bằng
   * ĐÚNG validator đã phát hành của module version đó (`validateEvidenceEntityV1`,
   * `validateAnswerEntityV1`, …) và trả typed document, hoặc trả issue list.
   * Pure: KHÔNG fetch, KHÔNG charge, KHÔNG đọc clock.
   *
   * Adapter MUST NOT tự viết validation behavior — nó gọi validator public của
   * module client, để traversal không bao giờ chấp nhận payload mà module client
   * đơn lẻ sẽ từ chối.
   */
  parseExtension(entity: EntityV1): TraversalParseResult<TDoc>;
  /**
   * Chỉ được gọi khi `parseExtension` trả `ok: true`, và nhận **document đã
   * validate**, không phải `unknown`. Trả danh sách edge ứng viên theo input
   * order. Pure: KHÔNG fetch, KHÔNG charge budget, KHÔNG đọc clock.
   */
  planEdges(document: TDoc, entity: EntityV1, context: TraversalPlanContext): TraversalEdgePlan[];
}

/**
 * Giữ NGUYÊN hai channel của validator đã phát hành
 * (`AnswerEntityValidationResult`, `EvidenceEntityValidationResult` đều là
 * `{ valid, errors: unknown[], semanticIssues }`). Gộp về một mảng semantic
 * issue sẽ làm một lỗi schema-only biến thành `issues: []`, tức là
 * `invalid-extension` không kèm lý do nào.
 */
export type TraversalParseResult<TDoc> =
  | { ok: true; document: TDoc }
  | { ok: false; errors: unknown[]; semanticIssues: ModuleSemanticIssue[] };

/**
 * Context read-only mà scheduler truyền vào `planEdges`. Chỉ mang những gì
 * adapter cần để quyết định plan cạnh nào — hai flag dưới đây chính là điều kiện
 * của hàng 2 và hàng 4 trong edge matrix. KHÔNG mang budget, không mang state
 * của walk, không mang gì cho phép adapter fetch hay charge.
 */
export interface TraversalPlanContext {
  /** Depth của node nguồn. Landing depth của cạnh là `depth + 1`. */
  depth: number;
  /** Canonical key của node nguồn. */
  nodeKey: string;
  /** Giá trị hiệu lực của `options.followCollections` (default `false`). */
  followCollections: boolean;
  /** Giá trị hiệu lực của `options.includeGeneratedSummarySources` (default `false`). */
  includeGeneratedSummarySources: boolean;
}

export interface TraversalEdgePlan {
  edgeGroup: string;
  /** Index trong mảng wire gốc, để truy vết. */
  index: number;
  target: RelationTargetV1;
  /** `target_type` mà chính occurrence này khai báo. */
  declaredTargetType: string;
  /** false = target là leaf theo định nghĩa của module (không bao giờ expand). */
  expandable: boolean;
}
```

Bốn hệ quả bắt buộc:

- `parseExtension`/`planEdges` đều pure ⇒ adapter không thể tự phát request, nên
  không thể vượt URL/DNS policy hay bypass budget. Đây là lý do tách chúng khỏi
  việc fetch.
- **Scheduler MUST NOT gọi `planEdges` trên extension chưa validate.** Shared
  canonical resolution chỉ bảo đảm entity **core-valid** (`EntityV1`) — nó không
  biết adapter nào sắp đọc `x_*` nào, nên nó không thể validate module payload
  hộ. Thiếu bước này thì một entity core-valid mang `x_answer`/`x_evidence` hỏng
  sẽ đi thẳng vào adapter dưới dạng `unknown`, và adapter hoặc throw ngoài
  taxonomy, hoặc dựng edge từ dữ liệu chưa hợp lệ.
- Adapter MUST NOT import `src/module-registry` để dispatch; nó gọi validator
  public của module client (`validateEvidenceEntityV1`, …), nên traversal và
  module client đơn lẻ luôn chấp nhận đúng một tập payload.
- Adapter cho ba module `1.0` nằm trong package, nhưng **không tự đăng ký**:
  consumer gọi `registerBuiltinTraversalAdapters()` hoặc truyền
  `options.adapters`. Core-only consumer không chạm tới file nào của traversal.

Registry lifetime và collision:

- Key là bộ ba `{moduleId, moduleVersion, extensionField}`. Đăng ký **trùng key**
  với một adapter khác ⇒ **throw**; đăng ký lại đúng cùng reference ⇒ no-op.
  Silent overwrite bị cấm: nó sẽ khiến kết quả traversal phụ thuộc thứ tự import.
- `registerBuiltinTraversalAdapters()` idempotent, gọi nhiều lần vẫn an toàn.
- `options.adapters` **thay thế** registry toàn cục cho riêng call đó (không
  merge), để một walk chạy được với đúng tập adapter tường minh mà không phụ
  thuộc trạng thái toàn cục.

### Validation phase

**Outcome là per-extension, KHÔNG phải per-node.** Một entity core-valid được
phép mang nhiều `x_*` cùng lúc — edge matrix hàng 1 và hàng 3 đã cho phép một
Answer vừa có `x_relations` vừa có `x_answer`, và core v1.0 cho phép vendor
extension tuỳ ý (`x_vendor`). Nếu một extension không hỗ trợ hoặc hỏng mà làm
dừng cả node thì `x_vendor` không liên quan sẽ giết luôn Relations/Answer edges
hợp lệ, và kết quả phụ thuộc thứ tự property trong JSON.

Thứ tự bắt buộc cho mỗi node đã `resolved`:

```text
1. đọc tập x_* thực có trên entity
2. sắp các extension theo TÊN FIELD (code-point), KHÔNG theo thứ tự property
   trong payload
3. với mỗi extension, độc lập nhau:
     a. lookup adapter theo {payload.module, payload.version, field}
          miss     → expansion record `unsupported-module` CHO RIÊNG field này,
                     không đọc payload, tiếp tục extension kế tiếp
     b. adapter.parseExtension(entity)
          ok:false → expansion record `invalid-extension` CHO RIÊNG field này,
                     KHÔNG phát edge nào của adapter này, tiếp tục field kế tiếp
     c. adapter.planEdges(document, entity, context)
4. node dừng toàn bộ CHỈ khi budget cạn hoặc abort
```

Bước 2 sắp theo **tên field**, không theo adapter key rank. Lý do: chính bước 3a
cho phép một extension **không có module envelope hợp lệ** (không phải object,
thiếu `module`/`version`) — những field đó không có `moduleId`/`moduleVersion` để
xếp hạng, nên adapter key rank không phải total order trên tập `x_*`. Tên field
thì luôn tồn tại và luôn duy nhất trong một JSON object, nên nó là total order cho
**mọi** trường hợp, kể cả `x_vendor_a: 1` và `x_vendor_b: {}` đứng cạnh
`x_answer`.

Thứ tự này chỉ quyết định thứ tự **expansion record**; thứ tự **edge** vẫn do
`edgeGroupRank` trong schedule key quyết định (§"Ordering"), nên hai cơ chế không
xung đột.

Một extension không có module envelope hợp lệ được ghi `unsupported-module` cho
field đó và bỏ qua — nó không phải lỗi của entity, chỉ là dữ liệu traversal không
hiểu.

Edge của nhiều adapter trên cùng một node được lên lịch theo `edgeGroupRank`
(§"Ordering"), nên thứ tự cuối cùng vẫn deterministic và độc lập với thứ tự
property.

`invalid-extension` giữ node ở status `resolved` — core entity vẫn hợp lệ, chỉ
extension đó hỏng. Đây đúng mô hình hai tầng: canonical outcome của node không
đổi, vấn đề nằm ở expansion của riêng một adapter. `errors` và `semanticIssues`
của validator được mang nguyên trong expansion record để consumer chẩn đoán được,
và **không** edge con nào của adapter đó được lên lịch.

Fixture bắt buộc:

- `x_relations`, `x_answer`, `x_evidence` malformed (sai schema, sai
  `content_checksum`, sai `version`), mỗi cái kèm assert "không request nào được
  phát cho edge con";
- `x_vendor` + `x_answer` trên cùng entity ⇒ Answer edges vẫn được plan đầy đủ;
- `x_relations` + `x_answer` trên cùng entity ⇒ cả hai nhóm edge đều xuất hiện;
- một extension invalid + một extension valid ⇒ chỉ adapter hỏng bị chặn;
- đảo thứ tự property của các `x_*` ⇒ **cùng chuỗi event**, kể cả khi có ít nhất
  hai field không có module envelope (`x_vendor_a: 1`, `x_vendor_b: {}`);
- một `x_relations` plan ba edge với outcome khác nhau (expanded + cycle +
  depth-limit) ⇒ ba edge record riêng, extension record vẫn là `planned`.

## Edge matrix

Đây là phần đóng finding P1-1. Bảng dưới là **normative cho traversal service**;
nó KHÔNG định nghĩa lại wire contract của bất kỳ module nào.

| # | Source kind | Edge group | Nguồn edge trên wire | Target kind kỳ vọng | Depth delta | Expand tiếp? | Điều kiện |
|---:|---|---|---|---|---:|---|---|
| 1 | entity bất kỳ có `x_relations` | `relations.item` | `x_relations.items[].target` / `targets[]` | tuỳ `target_type` (free token) | +1 | Có, nếu entity fetch về có adapter khớp | Luôn (mặc định bật) |
| 2 | entity bất kỳ có `x_relations` | `relations.collection` | `x_relations.items[].collection` | như trên | +1 cho mỗi item của page | Có | **`options.followCollections`, default `false`**; paging chỉ bị chặn bởi sáu dimension của budget, không có `maxPages` ([ADR-0011 §12.1](../../adr/0011-cross-module-graph-traversal.md)) |
| 3 | `answer` | `answer.related_entity` | `x_answer.related_entities[]` | tuỳ `target_type` | +1 | Có | Luôn |
| 4 | `answer` | `answer.source_target` | `x_answer.authorship.source_targets[]` | tuỳ `target_type` | +1 | Có | **`options.includeGeneratedSummarySources`, default `false`** |
| 5 | `claim` | `evidence.evidence_ref` | `x_evidence.evidence_refs[]` | hằng `evidence` | +1 | Không (leaf) | Luôn |
| 6 | `evidence` | — | không có edge | — | — | — | Evidence là leaf; `source.url`/`publisher.url` **KHÔNG BAO GIỜ** được fetch |

Ghi chú bắt buộc về hàng 4: Evidence `1.0` cố ý **không** fetch
`authorship.source_targets` (xem [plan 1.4.0](implementation-plan-v1.4.0.md)
§"Thuật toán `resolveAnswerEvidenceV1`" và test "không phát sinh request nào tới
`authorship.source_targets`"). Traversal service là consumer mới, không phải
Evidence, nên nó **được phép** đi cạnh đó — nhưng chỉ khi caller opt in tường
minh, và mặc định `false` để không release nào âm thầm mở rộng surface fetch của
một generated-summary Answer. `resolveAnswerEvidenceV1` không đổi.

### Root

Root của một traversal là **một entity URL hoặc một entity đã validate**, depth 0.
Không có root kind nào khác ở `1.0`; standalone module document
(`relation-collection`, `relation-registry`) chỉ xuất hiện như trung gian của
hàng 2, không làm root.

### Traversal state machine

Mỗi canonical target `{id, normalizedUrl}` đi qua đúng một trong các chuỗi sau:

```text
NODE      discovered ─► resolving ─► resolved ─► validating (mỗi x_* độc lập)
                            │
                            └─► forbidden | not-found | invalid | budget-exhausted

EXTENSION           validating ─► planned | no-edges
                            ├─► unsupported-module
                            └─► invalid-extension

EDGE      (mỗi edge do adapter plan, kể cả edge không bao giờ fetch)
                    scheduled ─► expanded | leaf
                            ├─► depth-limit | cycle | already-expanded
                            ├─► not-expanded        (target không resolve được)
                            └─► budget-exhausted
```

Có **ba** vocabulary, ở ba cấp khác nhau. Gộp chúng lại là sai: một `x_relations`
hợp lệ có thể plan ba edge mà edge 0 expand bình thường, edge 1 quay lại ancestor,
edge 2 vượt depth — không tồn tại một outcome đúng cho cả extension.

**1. Node — canonical resolution.** Dùng nguyên `AnswerTargetResolutionStatus`
đã phát hành (`resolved` | `forbidden` | `not-found` | `invalid` |
`budget-exhausted`). Không thêm giá trị nào.

**2. Extension — adapter có chạy được không** (`ExtensionExpansionOutcomeV1`):

| Outcome | Nghĩa | Có phát request? |
|---|---|---|
| `planned` | Adapter khớp, payload valid, đã plan ≥1 edge | Không |
| `no-edges` | Adapter khớp, payload valid, nhưng không có edge nào (hàng 6, hoặc mảng rỗng) | Không |
| `unsupported-module` | Không adapter nào khớp `{moduleId, moduleVersion, extensionField}` | Không |
| `invalid-extension` | Adapter khớp nhưng module validator reject payload | Không |

**3. Edge occurrence — điều gì xảy ra với chính cạnh đó**
(`EdgeExpansionOutcomeV1`). **Mọi edge được plan đều sinh một occurrence result,
kể cả khi không hề fetch target** — nếu không, consumer không phân biệt được
"không có ref" với "có ref nhưng bị chặn vì depth/cycle":

| Outcome | Nghĩa | Có phát request? | Có charge node? |
|---|---|---|---|
| `expanded` | Target resolve xong và đã được expand qua cạnh này | Có (hoặc cache hit) | Có ở lần fetch đầu |
| `leaf` | Target resolve xong, không expand tiếp (hàng 6 hoặc `expandable: false`) | Có (hoặc cache hit) | Có ở lần fetch đầu |
| `depth-limit` | Landing depth **> `maxDepth`** | **Không** | Không |
| `cycle` | Target **nằm trên ancestor path của chính occurrence này** | Không (target đã là node) | Không |
| `already-expanded` | Target đã expand ở nhánh khác không phải ancestor (fan-in/diamond) | Không | Không |
| `not-expanded` | Target không resolve được (`status` ≠ `resolved`) | Có (đã thử) | Tuỳ |
| `budget-exhausted` | Budget cạn / abort trước khi thử cạnh này | Không | Không |

Edge bị chặn **trước khi fetch** (`depth-limit`, `cycle`, `already-expanded`,
`budget-exhausted`) vẫn được phát đúng vị trí schedule key của nó và vẫn tính vào
`summary.edges` — nó là reference có thật trên wire. Nó **không** có
`status`, vì chưa từng có lần resolve nào để phán xét (xem `GraphEdgeV1.status`
optional ở §"Typed API contract"); thêm một giá trị mới vào
`AnswerTargetResolutionStatus` để mô tả tình huống này là chạm vào vocabulary đã
phát hành, nên không làm.

Quy tắc bắt buộc:

- **Expansion state là WALK-LOCAL, không phải budget-scoped.** Traversal service
  giữ `expandedKeys` trong `GraphTraversalState` do chính call `traverseGraphV1`
  sở hữu, và **KHÔNG** đọc/ghi `budget.expandedTargets`.
  - Lý do: budget được thiết kế sống qua nhiều call (shared canonical cache cố ý
    hỗ trợ nhiều resolver tuần tự/đồng thời trên một budget). Nếu expansion state
    nằm trên budget thì `traverseGraphV1(rootA, {budget})` rồi
    `traverseGraphV1(rootB, {budget})` sẽ khiến walk thứ hai thấy `D` "đã
    expanded" từ walk thứ nhất và bỏ mất toàn bộ outgoing edge của `D`, dù trong
    walk thứ hai `D` chưa từng được expand. Kết quả phụ thuộc lịch sử call ⇒ mất
    tính reproducible.
  - Phân chia dứt khoát: **node/request/byte/cross-origin accounting và canonical
    outcome cache vẫn budget-scoped** (đó là mục đích của budget, và walk thứ hai
    tái dùng entity đã fetch mà không tốn request); **expansion và ancestor state
    thì walk-local**.
  - Hệ quả: walk thứ hai được phép expand lại `D` từ cache, không phát request
    mới, và vẫn bị chặn bởi đúng các dimension của budget.
  - Traversal service cũng KHÔNG ghi vào `budget.expandedTargets` để một
    `traverseRelations` thô chạy trên cùng budget không bị nhiễm ngược lại — hai
    cơ chế sống song song, không dùng chung set.
- **Expand-at-most-once vs cycle là hai chuyện khác nhau.** `expandedKeys` chỉ
  chứng minh "đã expand rồi trong walk này", KHÔNG chứng minh có cycle: trong
  diamond DAG `A→B→D`, `A→C→D`, nhánh `C→D` gặp `D` đã expanded mà không hề có
  đường quay lại ancestor. Báo đó là `cycle` là sai topology.
  - Phân loại: scheduler đi ngược **parent-occurrence chain** của chính edge đang
    xét. Nếu canonical key của target xuất hiện trên chain đó ⇒ `cycle`; nếu
    không ⇒ `already-expanded`.
  - Chi phí: chain dài tối đa `maxDepth` (default 3), nên đây là O(depth) trên
    mỗi edge, không phải state toàn cục mới. Parent-occurrence link vốn đã cần cho
    `parentDiscoveryIndex` của schedule key.
  - Hai outcome **hành xử giống hệt nhau**: dừng nhánh, không throw, không charge
    thêm. Khác nhau duy nhất ở nhãn báo cáo — nhưng đó chính là thứ consumer và
    check `graph.traversal.cycle_contained` dùng để đọc topology.
- **Depth boundary**: dùng nguyên `chargeDepth`, vốn chỉ vượt budget khi
  `depth > maxDepth`. Node **ở đúng** `depth == maxDepth` vẫn được fetch và emit;
  chỉ edge có landing depth `> maxDepth` mới cho `depth-limit`. Viết sai chỗ này
  sẽ làm effective depth ít hơn Relations `1.0` đúng một cấp với cùng limits.
- **Type mismatch**: verdict tính **theo từng occurrence**, đúng mô hình hai tầng
  của `EvidenceGraph` (node giữ canonical outcome dùng chung; reference/edge giữ
  verdict riêng). Một reference khai sai `target_type` là `invalid` **cho riêng
  nó** và MUST NOT làm hỏng reference khác trỏ cùng canonical target.
- **Unsupported module** và **invalid extension**: đều là kết quả hợp lệ, KHÔNG
  fail traversal, KHÔNG fail conformance. Đây là điều kiện sống còn cho
  core-only/single-module consumer và cho deployment có một entity hỏng.
- Một node chỉ được expand **một lần trong một walk**, kể cả khi được nhiều cạnh
  trỏ tới (fan-in) — do `expandedKeys` walk-local. Hai walk khác nhau trên cùng
  budget là hai lần expand hợp lệ, và đó là hành vi đúng.

## Streaming contract

Đây là phần đóng finding P1-3.

### Public API

```ts
/** ail-aadp/traversal/v1.0 */
export type GraphTraversalEventV1 =
  | { type: "node"; node: GraphNodeV1 }
  | { type: "reference"; reference: GraphReferenceV1 }
  | { type: "edge"; edge: GraphEdgeV1 }
  | { type: "expansion"; expansion: GraphExtensionExpansionV1 }
  | { type: "complete"; summary: GraphTraversalSummaryV1 };

/**
 * Kết quả expansion của MỘT extension trên MỘT node — xem §"Validation phase".
 * KHÔNG mang outcome cấp edge: một extension có thể plan nhiều edge với outcome
 * khác nhau, và chúng nằm trên `GraphEdgeV1.outcome`.
 */
export interface GraphExtensionExpansionV1 {
  /** Canonical key của node. */
  key: string;
  /** Extension field cụ thể, ví dụ "x_answer". */
  extensionField: `x_${string}`;
  /** Adapter đã xử lý field này. Vắng khi outcome là `unsupported-module`. */
  adapter?: TraversalAdapterKey;
  outcome: ExtensionExpansionOutcomeV1;
  /** Số edge adapter này đã plan. 0 khi outcome ≠ "planned". */
  plannedEdges: number;
  /** Chỉ có khi outcome === "invalid-extension" — giữ nguyên hai channel của validator. */
  errors?: unknown[];
  semanticIssues?: ModuleSemanticIssue[];
  message?: string;
}

/** Một occurrence reference cấp root (edge matrix hàng 3-4), verdict riêng theo occurrence. */
export interface GraphReferenceV1 {
  /** Index trong mảng wire gốc của root entity. */
  index: number;
  edgeGroup: string;
  /** Canonical key của node đích. */
  key: string;
  declaredTargetType: string;
  status: GraphNodeStatusV1;
  message?: string;
}

/** Kết quả của `collectGraphV1` — cùng nội dung, cùng ordering với chuỗi event. */
export interface CrossModuleGraphV1<T = unknown> {
  /** Theo discovery order, không sort lại. */
  nodes: GraphNodeV1<T>[];
  references: GraphReferenceV1[];
  /** Theo schedule key. */
  edges: GraphEdgeV1[];
  expansions: GraphExtensionExpansionV1[];
  summary: GraphTraversalSummaryV1;
}

export interface GraphTraversalSummaryV1 {
  /** Lý do dừng. `"exhausted"` = đã thử hết mọi edge đã lên lịch. */
  stopReason: "exhausted" | "budget" | "aborted";
  /** true với mọi `stopReason` khác `"exhausted"`. */
  partial: boolean;
  nodes: number;
  /** Gồm CẢ edge bị chặn trước fetch (depth-limit/cycle/already-expanded/budget). */
  edges: number;
  requests: number;
  /** Số expansion record `unsupported-module`, theo module id khai trong payload. */
  unsupportedModules: Record<string, number>;
}

export function traverseGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): AsyncIterableIterator<GraphTraversalEventV1>;

/** Tiện ích: drain iterator ở trên thành một graph đầy đủ. Cùng ordering. */
export function collectGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): Promise<CrossModuleGraphV1>;
```

### Ordering

Ordering MUST độc lập với timing. Scheduler là **BFS trên một hàng đợi có khóa
sắp xếp toàn phần**:

```text
scheduleKey = (depth, parentDiscoveryIndex, edgeGroupRank, edgeIndex)
```

- `parentDiscoveryIndex`: thứ tự node cha được **discover**, không phải thứ tự
  fetch xong.
- `edgeGroupRank`: hằng số cố định, không phụ thuộc thứ tự đăng ký adapter:

  | Rank | Edge group |
  |---:|---|
  | 0 | `relations.item` |
  | 1 | `relations.collection` |
  | 2 | `answer.related_entity` |
  | 3 | `answer.source_target` |
  | 4 | `evidence.evidence_ref` |

  Edge group của adapter bên thứ ba xếp sau toàn bộ built-in, thứ tự giữa chúng
  theo `moduleId` rồi `edgeGroup` (so sánh code-point), để hai deployment cùng
  tập adapter luôn cho cùng ordering.
- `edgeIndex`: index trên wire, giữ nguyên input order.

Fetch MAY chạy đồng thời (hằng số nội bộ, hiện là 4 — **không** public ở `1.0`,
xem [ADR-0011 §12.2](../../adr/0011-cross-module-graph-traversal.md)), nhưng
**emit thì không**: kết quả được buffer và phát ra đúng thứ tự `scheduleKey`. Hệ quả kiểm
chứng được — cùng input + cùng option ⇒ cùng chuỗi event, bất kể nhánh nào về
trước. Đây là test bắt buộc (chạy với fetch trả về theo thứ tự đảo ngược).

Trong một node: `node` luôn phát trước mọi `edge` xuất phát từ nó; `expansion`
của một node luôn phát sau `node` đó và sau mọi `edge` con đã lên lịch.

### Backpressure và terminal

- `options.maxBufferedEvents` (default 256): khi buffer đầy, scheduler ngừng lên
  lịch fetch mới cho tới khi consumer tiêu thụ. Iterator không bao giờ tích luỹ
  toàn bộ graph.
- **Không có tổng-số-event limit**, nên `stopReason` không có giá trị
  `max-events`. `maxBufferedEvents` là **sức chứa buffer**, không phải hạn mức
  tổng — memory đã bị chặn bởi chính buffer đó, còn tổng khối lượng công việc đã
  bị chặn bởi sáu dimension của budget. Thêm một hạn mức thứ ba chỉ tạo thêm một
  đường partial-stop nữa phải kế toán và test, mà không chặn thêm tài nguyên nào.
  Consumer muốn dừng sớm thì `break` khỏi iterator.
- `complete` được phát **đúng một lần và luôn luôn**, kể cả khi budget cạn hoặc
  abort. Consumer phân biệt "đi hết" với "dừng giữa chừng" bằng
  `summary.stopReason`/`summary.partial`, không bằng việc iterator kết thúc.
- Nếu consumer `break`/`return` sớm, iterator chạy `finally`: huỷ mọi wait của
  chính nó, KHÔNG huỷ fetch dùng chung, và KHÔNG phát `complete` (consumer đã tự
  bỏ cuộc — không có kết quả nào để tuyên bố).

### Error vs result

| Tình huống | Cách biểu diễn |
|---|---|
| 401/403, 404, schema/checksum sai, URL bị chặn | status trên node/edge, không throw |
| Budget cạn | `expansion`/edge status `budget-exhausted`, rồi `complete` với `stopReason: "budget"` |
| `AbortSignal` fired | `complete` với `stopReason: "aborted"`, `partial: true` |
| `resolution_context_mismatch` (1.3.1) | **throw** `AadpClientError` — đây là lỗi lập trình/security, không phải kết quả traversal |
| Option không hợp lệ | throw trước khi phát request đầu tiên |

### Sequence example (non-normative)

```text
root A (answer) ─ related_entities[0] → C1 (claim) ─ evidence_refs[0] → E
                 └ related_entities[1] → E

node A
edge A→C1 (answer.related_entity, index 0)
edge A→E  (answer.related_entity, index 1)
node C1
node E                       ← fetch một lần duy nhất
expansion C1 = expanded
expansion E  = leaf
edge C1→E (evidence.evidence_ref, index 0)   ← replay canonical outcome, không fetch
complete { stopReason: "exhausted", partial: false, nodes: 3, edges: 3 }
```

Đảo thứ tự hai `related_entities` phải cho cùng tập node/edge và cùng số request
(mixed-order equivalence — test bắt buộc, kế thừa nguyên tắc đã có ở Evidence `1.0`).

## Budget contract

Đây là phần đóng finding P1-4.

### Ownership

- **Caller sở hữu budget**, tạo bằng `createRelationsTraversalBudget(limits)`.
  Traversal service **mượn**, KHÔNG tạo budget con, KHÔNG nới default, KHÔNG thêm
  dimension mới ngoài sáu dimension của ADR-0008.
- **Canonical outcome cache thuộc `src/modules/shared/canonical-resolution.ts`**,
  khoá theo chính budget (`WeakMap<budget, BudgetResolutionState>`), vẫn
  **internal**, không export từ subpath công khai nào. Traversal service dùng
  đúng layer đó — nếu nó tự cache thì hai cache trên một budget sẽ chế ra
  `invalid` giả cho nhau, đúng hazard mà layer này ra đời để chặn.
- **Invariant: một budget = một resolution context.** Binding đã phát hành ở
  `1.3.1` (`resolution_context_mismatch`, fail closed trước mọi replay/charge/
  request) áp dụng nguyên vẹn. Traversal service MUST NOT có đường vòng nào bỏ
  qua nó, và MUST NOT trộn hai option set khác nhau vào một walk.

### Accounting

| Operation | depth | node (`chargeNode`) | request | bytes | cross-origin |
|---|---|---|---|---|---|
| Lên lịch một edge | check `chargeDepth` | — | — | — | — |
| Fetch lần đầu một canonical target | — | +1 | +1/hop (http.ts) | +len | +1/hop nếu khác root origin |
| Cache hit (canonical outcome đã có) | — | **0** | 0 | 0 | 0 |
| Join một fetch đang bay (`pending`) | — | 0 | 0 | 0 | 0 |
| Retry / redirect hop | — | 0 | +1 | +len | +1 nếu hop cross-origin |
| Expand một node | — | 0 (chỉ `expandedKeys` walk-local) | 0 | 0 | 0 |
| Walk thứ hai trên cùng budget gặp lại node cũ | — | 0 (`chargeNode` đã dedupe) | 0 (cache hit) | 0 | 0 |
| Một waiter abort, còn waiter khác | — | 0 | 0 | 0 | 0 |
| Fetch bị huỷ vì **không còn waiter nào** | — | `releaseNode` (−1) | đã charge, không hoàn | đã charge | đã charge |
| Collection page tiếp theo (hàng 2) | — | theo từng target của page | +1 | +len | theo origin |

Ba invariant kiểm chứng được:

1. **Không double-charge**: fan-in N cạnh tới cùng canonical target ⇒ đúng 1 node
   charge và đúng 1 request.
2. **Không rò request sau abort**: sau `complete{stopReason:"aborted"}`, số
   request của budget không tăng thêm. `releaseNode` chỉ được gọi cho target mà
   chính shared layer đã charge và **chưa** cho ra outcome nào caller quan sát
   được — precondition này giữ nguyên như docstring hiện tại, và traversal
   service không được gọi `releaseNode` trực tiếp (nó không export ra ngoài).
3. **Không đầu độc chéo**: hai caller dùng chung một budget phải cùng resolution
   context, nếu không thì call thứ hai bị từ chối và budget nguyên vẹn.

## Capability negotiation

Đây là phần đóng nửa đầu finding P2-5.

**Traversal service KHÔNG fetch manifest.** Đây là quyết định có chủ đích, không
phải thiếu sót — lý do ở §"Tại sao không đọc manifest" bên dưới.

Thuật toán, chạy cho mỗi entity đã resolve:

1. Lấy tập extension field `x_*` thực có trên chính entity đó. **Entity là nguồn
   duy nhất**: adapter được chọn theo `{payload.module, payload.version,
   extensionField}` đọc từ payload.
2. Tra adapter registry bằng **exact match** ba thành phần. KHÔNG range, KHÔNG
   fallback sang version khác — giống hệt rule đã phát hành cho module registry
   (ADR-0007) và cho Evidence client.
3. Miss ⇒ expansion outcome `unsupported-module`, node vẫn là node hợp lệ, walk
   tiếp. **KHÔNG throw, KHÔNG fail.**
4. Hit ⇒ sang §"Validation phase" bước 3.
5. Nếu consumer truyền `options.capabilities` (allowlist `{moduleId, version}[]`),
   adapter ngoài allowlist bị coi như không tồn tại (cùng outcome
   `unsupported-module`), để consumer thu hẹp surface một cách tường minh.
6. Deployment khai nhiều version của cùng `moduleId`: negotiation **không chọn giúp**
   — mỗi entity payload tự khai version của nó, và bước 2 quyết định. Không có
   "preference order" nào vì không có tình huống nào phải chọn.

Hệ quả bắt buộc: một deployment khai module mà consumer không hỗ trợ **không bao
giờ** làm hỏng traversal của consumer đó. Đây là compatibility gate, có test riêng.

### Tại sao không đọc manifest

Bản trước của kế hoạch này bắt traversal đọc `.well-known/ai-manifest.json` một
lần mỗi origin. Bỏ hẳn, vì manifest **không quyết định gì**: adapter đã được chọn
từ payload của entity, nên request manifest là chi phí thuần tuý kèm theo ba vấn
đề không có lời giải rẻ:

- **Ngoài accounting**: request/byte/cross-origin của manifest không nằm trong
  bảng accounting nào, nên một walk chạm N origin sẽ phát N request không ai đếm
  — chính xác là loại rò rỉ mà release gate "không unbounded request" cấm.
- **Không có failure state**: manifest 404, invalid, bị URL policy chặn, hay làm
  cạn budget sẽ rơi vào đâu? Không phải node status (nó không phải node), không
  phải edge. Trả lời được câu này đòi thêm một nhánh taxonomy chỉ để phục vụ một
  hint không ai dùng.
- **Root origin không phải lúc nào cũng có**: root dạng `EntityV1` in-memory có
  thể không có `canonical_url`, nên "origin của root" không xác định được, và
  cùng một graph sẽ cho kết quả khác nhau giữa root-là-URL và root-là-entity.

Nếu consumer muốn dữ liệu manifest cho mục đích báo cáo, họ tự fetch bằng core
discovery đã có và truyền vào `options.declaredModules` — traversal chỉ **đọc**
nó cho summary, không bao giờ tự tạo request và không bao giờ để nó đổi kết quả
negotiation.

### Root identity

Root cần một **URL**, không phải chỉ một origin. Thứ tự lấy:

1. URL của root, nếu root được truyền dưới dạng URL;
2. ngược lại `entity.canonical_url` của root entity;
3. ngược lại `options.rootUrl` do caller truyền.

Không có cả ba ⇒ **throw invalid-options trước request đầu tiên**.

Phải là URL chứ không phải origin vì graph dùng canonical key
`{id, normalizedUrl}` xuyên suốt: `GraphNodeV1.key`, `GraphEdgeV1.from` và
expansion record đều cần key đó cho root. Một `rootOrigin` trần không tạo được
canonical identity, và ghép origin với `entity.id` sẽ **phát minh một URL không
tồn tại trên wire** — sai ngay khi một edge trỏ ngược về chính root, vì key tự chế
sẽ không khớp canonical key của reference đó và cycle về root không được nhận ra.

Một URL thì phục vụ cả hai mục đích: canonical identity của root node, và
`rootOrigin` cho cross-origin accounting (`new URL(rootUrl).origin`). Không đoán,
không mặc định "same-origin với mọi thứ" — đoán sai ở đây làm
`maxCrossOriginRequests` mất tác dụng.

`options.rootUrl` phải qua đúng URL policy của call như mọi URL khác; nó **không**
được fetch (root entity đã có trong tay), chỉ dùng làm identity.

**Quan hệ với `rootOrigin` đã phát hành.** `GraphTraversalOptions` kế thừa
`RelationsClientOptions`, vốn đã có `rootOrigin?: string` (và `rootOrigin` là một
thành phần của resolution-context identity ở `1.3.1`). Hai field cùng tồn tại nên
precedence phải tường minh:

- root URL (theo ba bước trên) **luôn** quyết định canonical key của root;
- `rootOrigin` hiệu lực = `new URL(rootUrl).origin`;
- nếu caller truyền `rootOrigin` **khác** origin đó ⇒ **throw invalid-options**,
  không âm thầm chọn một bên. Truyền trùng thì hợp lệ và là no-op;
- `rootOrigin` một mình, không kèm nguồn root URL nào, **không đủ** — nó không tạo
  được identity, nên vẫn là invalid-options.

Giá trị `rootOrigin` truyền xuống module client phải là giá trị hiệu lực này, để
resolution-context digest của mọi fetch trong walk nhất quán.

## Conformance contract

Đây là phần đóng nửa sau finding P2-5.

- Profile ID: `aadp:graph-traversal@1.0`. Report shape tái sử dụng
  `CheckResult`/`CheckStatus`/`ConformanceSummary` của core runner, giống
  Answer/Evidence — không tạo report format thứ tư.
- `GraphTraversalConformanceReport` giữ đúng field của
  `EvidenceConformanceReport`, thay `module` bằng `profile: { id, version }`.
- Check ID ổn định (message text không phải API):

  | Check ID | Nội dung | Trạng thái fail |
  |---|---|---|
  | `graph.capability.no_manifest_request` | Traversal KHÔNG tự phát request tới `.well-known/ai-manifest.json` | error |
  | `graph.capability.unsupported_is_not_error` | Module/version lạ cho outcome `unsupported-module`, không throw | error |
  | `graph.capability.exact_match` | Không có fallback sang version khác | error |
  | `graph.traversal.extension_validated` | Extension hỏng ⇒ `invalid-extension` kèm `errors`/`semanticIssues`, không edge con nào được phát | error |
  | `graph.traversal.extension_scoped` | Một extension unsupported/invalid KHÔNG chặn adapter khác trên cùng entity | error |
  | `graph.ordering.property_order_independent` | Đảo thứ tự property `x_*` ⇒ cùng chuỗi event | error |
  | `graph.budget.walk_local_expansion` | Hai walk tuần tự trên cùng budget: walk sau vẫn expand đủ, không tốn request mới | error |
  | `graph.traversal.edge_matrix` | Mọi edge quan sát được thuộc đúng một hàng của edge matrix | error |
  | `graph.traversal.source_targets_opt_in` | Mặc định KHÔNG request tới `authorship.source_targets` | error |
  | `graph.traversal.metadata_not_fetched` | Không request tới `evidence.source.url`/`publisher.url` | error |
  | `graph.traversal.cycle_contained` | Cycle thật (ancestor re-entry) ⇒ edge outcome `cycle`, không lỗi, không lặp vô hạn | error |
  | `graph.traversal.fanin_not_cycle` | Diamond DAG ⇒ `already-expanded`, **KHÔNG** phải `cycle` | error |
  | `graph.traversal.depth_boundary` | Node ở đúng `depth == maxDepth` được resolve; chỉ landing `> maxDepth` mới `depth-limit` | error |
  | `graph.traversal.edge_outcome_per_occurrence` | Một extension plan nhiều edge với outcome khác nhau ⇒ mỗi edge có outcome riêng, không bị gộp | error |
  | `graph.traversal.blocked_edge_emitted` | Edge bị chặn trước fetch vẫn được emit, không có `status`, vẫn tính vào `summary.edges` | error |
  | `graph.traversal.root_identity` | Root entity thiếu `canonical_url` và thiếu `rootUrl` ⇒ throw invalid-options trước request đầu tiên | error |
  | `graph.traversal.type_mismatch_scoped` | Verdict sai type không lan sang occurrence khác | error |
  | `graph.ordering.deterministic` | Hai run với thứ tự hoàn tất khác nhau cho cùng chuỗi event | error |
  | `graph.ordering.mixed_order_equivalence` | Đảo thứ tự reference cho cùng graph và cùng số request | error |
  | `graph.budget.no_double_charge` | Fan-in ⇒ 1 node charge, 1 request | error |
  | `graph.budget.partial_not_complete` | Dừng vì budget ⇒ `partial: true`, `stopReason: "budget"` | error |
  | `graph.budget.no_request_after_abort` | Sau abort, request count không tăng | error |
  | `graph.streaming.terminal_event` | `complete` phát đúng một lần | error |
  | `graph.streaming.bounded_memory` | Buffer không vượt `maxBufferedEvents` | warning |
  | `graph.compat.core_only_unchanged` | Consumer core-only/single-module không đổi behavior | error |

- Field cố ý **không** có trong `GraphTraversalConformanceOptions`, kèm lý do:
  `maxPages` (ADR-0011 §12.1 — không có page limit nào), `concurrency` (§12.2 —
  internal), sáu traversal limit field rời (đi qua `budget`, xem docstring của
  type), `now`/`freshnessMaxAgeMs` (clock của Answer/Evidence freshness, không có
  check nào của profile này dùng), `profile` (biến thể riêng của Relations), và
  `sampleRegistryUrl`/`negativeTargetUrl`/`crossOriginProbeUrl` (sample riêng của
  Relations, không nằm trong intersection ba module).
- Check ID là **package API** (ổn định theo SemVer của `ail-aadp`), không phải wire
  contract — profile này không có artifact nào trên đường truyền.
- Fixture matrix (local, chạy trong CI, không cần deployment): fan-in/diamond,
  cycle thật, mixed order, mixed type, malformed `x_relations`/`x_answer`/
  `x_evidence`, depth boundary (`maxDepth=0`, landing `== maxDepth`, landing
  `> maxDepth`), unsupported module, unsupported version, budget stop, abort,
  collection paging.
- Hai neutral data set (Phase 6) phải có **tên, URL và owner cụ thể ghi trong
  implementation record** trước khi gate được coi là đóng; "hai data set" không có
  định danh thì không tái lập và không audit được. Data set MUST do hai bên khác
  nhau vận hành, và ít nhất một bên không phải AADP maintainers.

## Typed API contract

```ts
/** Cấp EXTENSION: adapter có chạy được không. */
export type ExtensionExpansionOutcomeV1 =
  | "planned" | "no-edges" | "unsupported-module" | "invalid-extension";

/** Cấp EDGE: điều gì xảy ra với chính cạnh đó. */
export type EdgeExpansionOutcomeV1 =
  | "expanded" | "leaf" | "depth-limit" | "cycle"
  | "already-expanded" | "not-expanded" | "budget-exhausted";

/** Cấp NODE: canonical resolution — vocabulary đã phát hành, không thêm giá trị. */
export type GraphNodeStatusV1 = AnswerTargetResolutionStatus;

export interface GraphNodeV1<T = unknown> {
  key: string;                    // canonical {id, normalizedUrl}
  depth: number;
  status: GraphNodeStatusV1;      // canonical outcome, dùng chung
  entity?: EntityV1<T>;
  /** Mọi `x_*` traversal nhìn thấy trên entity này, theo adapter key rank. */
  modules?: Array<{ id: string; version: string; extensionField: `x_${string}` }>;
  /**
   * MỘT record cho MỖI extension — không phải một outcome cho cả node. Một entity
   * có `x_vendor` không hỗ trợ + `x_answer` hợp lệ sẽ có hai record, và Answer
   * edges vẫn được plan (§"Validation phase"). Outcome của từng cạnh nằm trên
   * `GraphEdgeV1.outcome`, không nằm ở đây.
   */
  expansions?: GraphExtensionExpansionV1[];
  message?: string;
}

export interface GraphEdgeV1 {
  from: string;
  to: string;
  edgeGroup: string;
  index: number;
  /** Extension field đã plan cạnh này — nối edge về đúng expansion record. */
  extensionField: `x_${string}`;
  declaredTargetType: string;
  /**
   * Verdict resolution của RIÊNG occurrence này (gồm cả sai `target_type` →
   * "invalid"). **Vắng** khi cạnh chưa bao giờ được thử resolve —
   * `depth-limit`, `cycle`, `already-expanded`, `budget-exhausted`.
   */
  status?: GraphNodeStatusV1;
  /** Luôn có. Điều gì xảy ra với cạnh này ở tầng traversal. */
  outcome: EdgeExpansionOutcomeV1;
  message?: string;
}

export interface GraphTraversalOptions extends RelationsClientOptions {
  budget: RelationsTraversalBudgetState;
  adapters?: readonly TraversalAdapter[];
  capabilities?: ReadonlyArray<{ moduleId: string; version: string }>;
  /**
   * Identity của root: canonical key VÀ cross-origin accounting. Bắt buộc khi
   * root là entity không có `canonical_url`. Không bao giờ được fetch.
   */
  rootUrl?: string;
  /** Manifest `modules[]` do CALLER tự fetch, chỉ dùng cho summary. Traversal không bao giờ tự fetch manifest. */
  declaredModules?: ManifestV1["modules"];
  includeGeneratedSummarySources?: boolean;  // default false
  followCollections?: boolean;               // default false (ADR-0011 §12.1)
  maxBufferedEvents?: number;                // default 256
  signal?: AbortSignal;
}

/**
 * Giữ ĐÚNG common intersection của `RelationsConformanceOptions`,
 * `AnswerConformanceOptions` và `EvidenceConformanceOptions` đã phát hành, trừ
 * hai nhóm được nêu lý do bên dưới. Runner của profile này compose ba module đó,
 * nên nó phải chạy được với cùng deployment/test convention: nếu thiếu URL policy
 * injection thì không chạy được localhost/private staging, thiếu `signal` thì
 * caller không abort được — cả hai đều là regression so với ba runner hiện có.
 */
export interface GraphTraversalConformanceOptions {
  /** Origin dùng cho các check cần deployment thật. */
  baseUrl?: string;
  /** Entity URL làm root của các check traversal — tương ứng `sampleEntityUrl` của ba module. */
  sampleRootUrl?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  retry?: RetryOptions;
  allowPrivateNetwork?: boolean;
  urlPolicy?: UrlPolicy;
  headers?: Record<string, string>;
  crossOriginSafeHeaders?: string[];
  /**
   * Budget do caller sở hữu; vắng thì runner tạo budget reference default.
   * Đây là **thay thế duy nhất** so với ba runner kia: sáu limit field rời
   * (`maxDepth`, `maxNodes`, `maxRequests`, `maxTotalBytes`,
   * `maxCrossOriginRequests`, `deadlineMs`) không xuất hiện ở đây, vì ADR-0011
   * §10 quy định caller sở hữu budget và traversal chỉ mượn — hai đường cấu hình
   * cùng sáu dimension sẽ cho phép runner chạy với limit khác chính budget mà nó
   * truyền vào. Budget KHÔNG thay thế HTTP policy, callback hay cancellation.
   */
  budget?: RelationsTraversalBudgetState;
  failOnWarning?: boolean;
  onCheck?: (result: CheckResult) => void;
  signal?: AbortSignal;
}

export function registerBuiltinTraversalAdapters(): void;
export function traverseGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): AsyncIterableIterator<GraphTraversalEventV1>;
export function collectGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions,
): Promise<CrossModuleGraphV1>;
export function runGraphTraversalConformance(
  options: GraphTraversalConformanceOptions,
): Promise<GraphTraversalConformanceReport>;
```

Toàn bộ block trên phải **compile được** trước khi ADR chuyển `Accepted`: Phase 0
có một type-only fixture (`tests/types/traversal-api.test-d.ts`) khai đúng các
declaration này, để không implementer nào phải tự phát minh một phần public
SemVer surface. Fixture này cùng compile harness tối thiểu của nó
(`tests/types/tsconfig.json`, script `test:types` trong `package.json`) là
**ngoại lệ duy nhất** của luật "không artifact trước khi ADR Accepted"
(§"Dependency bắt buộc" mục 4): chỉ chứa type declaration hoặc cấu hình build,
không runtime code, không tạo file nào dưới `src/traversal/**` hay
`spec/traversal/**`. Gate đóng khi `npm run test:types` pass. Mọi artifact khác
vẫn bị chặn tới khi ADR Accepted. Không còn symbol nào chưa định nghĩa; `GraphTraversalState` là
**internal**, không xuất hiện trong bất kỳ signature public nào.

Export path duy nhất: `ail-aadp/traversal/v1.0`. **Không** re-export từ package
root, không re-export từ subpath của module nào, không export shared canonical
resolution layer.

## Release gate

- Không unbounded graph/memory/request: mọi walk bị chặn bởi sáu dimension của
  ADR-0008, buffer bị chặn bởi `maxBufferedEvents`.
- Deterministic ordering: `graph.ordering.deterministic` và
  `graph.ordering.mixed_order_equivalence` xanh.
- Partial result không bị báo complete: `complete` luôn mang `stopReason`/`partial`.
- Core-only/single-module consumer không regression: `graph.compat.core_only_unchanged`
  xanh, và **toàn bộ test Relations/Answer/Evidence hiện có pass mà không sửa một dòng**.
- Hai neutral data set đạt interoperability tests, với tên/URL/owner ghi trong
  implementation record `1.5.0`.
- ADR-0011 Accepted trước mọi artifact của Phase 1-6.

## Rủi ro còn lại

- Adapter bên thứ ba vẫn có thể trả `planEdges` phát sinh số edge rất lớn; giới
  hạn duy nhất là budget. Nếu cần giới hạn theo adapter thì phải do ADR-0011
  quyết định, không thêm ad hoc lúc implement.
- `followCollections` mở ra bề mặt paging lớn hơn Evidence `1.0` từng có. Đã chốt
  ở [ADR-0011 §12.1](../../adr/0011-cross-module-graph-traversal.md): default
  `false`, không có `maxPages`, paging chỉ bị chặn bởi budget. Rủi ro còn lại là
  của caller nào opt in — mỗi page tiêu budget như mọi fetch khác.
- Hai neutral data set và owner của chúng chưa được định danh — đây là gate về
  môi trường/nhân sự, không phải code, giống hệt gate đã kéo từ `1.3.0` sang `1.4.0`.

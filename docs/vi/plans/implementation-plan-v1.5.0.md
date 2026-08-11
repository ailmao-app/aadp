# Kế hoạch triển khai `ail-aadp` 1.5.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft — chặn ở Phase 0 ([ADR-0011](../../adr/0011-cross-module-graph-traversal.md), **Proposed**); không artifact nào được tạo trước khi ADR Accepted |
| Chủ đề | Cross-module graph traversal và composition |
| Dependency | Relations `1.0`, Answer `1.0`, Evidence `1.0` stable — bằng chứng ở [implementation record 1.4.0](../../records/implementation-record-v1.4.0.md), mục "Closed gates" và "External interoperability evidence (closed 2026-08-10)" |
| Wire impact | KHÔNG đổi core schema, KHÔNG đổi `aadp:relations@1.0`, `aadp:answer@1.0`, `aadp:evidence@1.0`. Chỉ thêm package API mới (minor bump theo [roadmap §1](release-roadmap.md)) |
| Review | [review-20260811-194300](../../../.claude/review/review-20260811-194300.md) — bản này được viết lại để đóng finding P1-1..P1-4 và P2-5; P2-6 được đóng bằng cập nhật roadmap §2/§12 |
| Owner | AADP maintainers |

Tài liệu này là **kế hoạch, không phải nguồn normative**. Nguồn normative sẽ là
ADR-0011 và `spec/traversal/v1.0/specification.md`. Nếu hai bên lệch nhau, spec thắng.

## Trạng thái theo work package

Bảng per-work-item bắt buộc theo [document conventions §4](../../document-conventions.md).

| # | Work package | Trạng thái | Điều kiện mở khóa |
|---:|---|---|---|
| 0 | [ADR-0011](../../adr/0011-cross-module-graph-traversal.md) cross-module traversal | `Proposed` (2026-08-11) | Ba open question ở cuối ADR được chốt, rồi ADR chuyển `Accepted` |
| 1 | Traversal adapter registry + capability negotiation | `Blocked` | Phase 0 |
| 2 | Edge matrix + traversal state machine | `Blocked` | Phase 0 |
| 3 | Streaming API + deterministic ordering | `Blocked` | Phase 0, Phase 2 |
| 4 | Shared budget/accounting contract | `Blocked` | Phase 0, Phase 2 |
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
   khi tạo bất kỳ artifact nào của Phase 1-6 — hiện đang `Proposed`. Bài học
   của `1.4.0` (implementation đi trước acceptance theo chỉ đạo trực tiếp, xem
   ghi chú §"Trạng thái theo work package" của [plan 1.4.0](implementation-plan-v1.4.0.md))
   KHÔNG lặp lại ở release này.

ADR-0011 khóa tối thiểu các mục sau, và bản `Proposed` hiện tại đã có đủ cả sáu
(§1-2 registry, §3-4 edge matrix/state machine, §5-6 negotiation/cycle, §8-9
ordering/streaming, §10 budget, §11 conformance): ranh giới registry (§"Registry boundary"), edge
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
   ├── expansion guard (expandedTargets, depth)
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

export interface TraversalAdapter {
  readonly key: TraversalAdapterKey;
  readonly capabilities: TraversalAdapterCapabilities;
  /**
   * Đọc extension payload của MỘT entity đã validate và trả danh sách edge ứng
   * viên theo input order. Pure: KHÔNG fetch, KHÔNG charge budget, KHÔNG đọc
   * clock. Việc fetch/charge do scheduler làm qua shared canonical resolution.
   */
  planEdges(entity: EntityV1, context: TraversalPlanContext): TraversalEdgePlan[];
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

Ba hệ quả bắt buộc:

- `planEdges` là pure ⇒ adapter không thể tự phát request, nên không thể vượt
  URL/DNS policy hay bypass budget. Đây là lý do tách `planEdges` khỏi việc fetch.
- Adapter MUST NOT import `src/module-registry` để dispatch; validation của
  payload vẫn do module client (`validateEvidenceEntityV1`, …) làm như hiện tại.
- Adapter cho ba module `1.0` nằm trong package, nhưng **không tự đăng ký**:
  consumer gọi `registerBuiltinTraversalAdapters()` hoặc truyền
  `options.adapters`. Core-only consumer không chạm tới file nào của traversal.

## Edge matrix

Đây là phần đóng finding P1-1. Bảng dưới là **normative cho traversal service**;
nó KHÔNG định nghĩa lại wire contract của bất kỳ module nào.

| # | Source kind | Edge group | Nguồn edge trên wire | Target kind kỳ vọng | Depth delta | Expand tiếp? | Điều kiện |
|---:|---|---|---|---|---:|---|---|
| 1 | entity bất kỳ có `x_relations` | `relations.item` | `x_relations.items[].target` / `targets[]` | tuỳ `target_type` (free token) | +1 | Có, nếu entity fetch về có adapter khớp | Luôn (mặc định bật) |
| 2 | entity bất kỳ có `x_relations` | `relations.collection` | `x_relations.items[].collection` | như trên | +1 cho mỗi item của page | Có | `options.followCollections` (default `true`), giới hạn `maxPages` |
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
discovered ──► resolving ──► resolved ──► expanding ──► expanded
     │             │             │            │
     │             │             │            └──► unsupported-module | leaf | depth-limit
     │             │             └──► (không expand vì đã expanded ở nhánh khác) ──► cycle
     │             └──► forbidden | not-found | invalid | budget-exhausted
     └──► (đã có canonical outcome) ──► replayed (không fetch lại)
```

`ExpansionOutcome` là enum **mới, riêng của traversal layer** — KHÔNG đụng vào
`AnswerTargetResolutionStatus` đã phát hành:

| Outcome | Nghĩa | Có phát request? | Có charge node? |
|---|---|---|---|
| `expanded` | Adapter khớp, edge đã được lên lịch | (tuỳ edge con) | Không (charge ở resolve) |
| `leaf` | Adapter khớp nhưng entity không có edge nào (hàng 6, hoặc mảng rỗng) | Không | Không |
| `unsupported-module` | Entity có `x_*` nhưng không adapter nào khớp `{moduleId, moduleVersion, extensionField}` | Không | Không |
| `depth-limit` | Edge sẽ chạm `maxDepth` | Không | Không |
| `cycle` | Canonical key đã `markExpanded` trước đó | Không | Không |
| `not-resolved` | Node có status ≠ `resolved` nên không có payload để expand | — | — |
| `budget-exhausted` | Budget cạn / abort trước khi kịp expand | Không | Không |

Quy tắc bắt buộc:

- **Cycle**: dùng nguyên `markExpanded`/`expandedTargets` của
  `RelationsTraversalBudgetState`. Cycle KHÔNG phải lỗi, KHÔNG throw, KHÔNG charge
  thêm — chỉ dừng đúng nhánh đó và phát outcome `cycle`.
- **Type mismatch**: verdict tính **theo từng occurrence**, đúng mô hình hai tầng
  của `EvidenceGraph` (node giữ canonical outcome dùng chung; reference/edge giữ
  verdict riêng). Một reference khai sai `target_type` là `invalid` **cho riêng
  nó** và MUST NOT làm hỏng reference khác trỏ cùng canonical target.
- **Unsupported module**: là kết quả hợp lệ, KHÔNG fail traversal, KHÔNG fail
  conformance. Đây là điều kiện sống còn cho core-only/single-module consumer.
- Một node chỉ được expand **một lần** trên toàn walk, kể cả khi được nhiều cạnh
  trỏ tới (fan-in) — do `markExpanded`, không do dedupe riêng của service.

## Streaming contract

Đây là phần đóng finding P1-3.

### Public API

```ts
/** ail-aadp/traversal/v1.0 */
export type GraphTraversalEventV1 =
  | { type: "node"; node: GraphNodeV1 }
  | { type: "reference"; reference: GraphReferenceV1 }
  | { type: "edge"; edge: GraphEdgeV1 }
  | { type: "expansion"; key: string; outcome: ExpansionOutcome; module?: string }
  | { type: "complete"; summary: GraphTraversalSummaryV1 };

export interface GraphTraversalSummaryV1 {
  /** Lý do dừng. `"exhausted"` = đã thử hết mọi edge đã lên lịch. */
  stopReason: "exhausted" | "budget" | "aborted" | "max-events";
  /** true với mọi `stopReason` khác `"exhausted"`. */
  partial: boolean;
  nodes: number;
  edges: number;
  requests: number;
  /** Số node có expansion outcome `unsupported-module`, theo module id. */
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

Fetch MAY chạy đồng thời (`options.concurrency`, default 4), nhưng **emit thì
không**: kết quả được buffer và phát ra đúng thứ tự `scheduleKey`. Hệ quả kiểm
chứng được — cùng input + cùng option ⇒ cùng chuỗi event, bất kể nhánh nào về
trước. Đây là test bắt buộc (chạy với fetch trả về theo thứ tự đảo ngược).

Trong một node: `node` luôn phát trước mọi `edge` xuất phát từ nó; `expansion`
của một node luôn phát sau `node` đó và sau mọi `edge` con đã lên lịch.

### Backpressure và terminal

- `options.maxBufferedEvents` (default 256): khi buffer đầy, scheduler ngừng lên
  lịch fetch mới cho tới khi consumer tiêu thụ. Iterator không bao giờ tích luỹ
  toàn bộ graph.
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
| Expand một node | — | 0 (chỉ `markExpanded`) | 0 | 0 | 0 |
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

Thuật toán, chạy một lần cho mỗi origin gặp trong walk:

1. Đọc `.well-known/ai-manifest.json` (core discovery, không có đường mới), lấy
   `modules[]` — `Array<{ id, version, schema }>`.
2. Với mỗi entity fetch về, lấy tập extension field `x_*` thực có trên entity đó.
   **Manifest là gợi ý, entity là sự thật**: adapter được chọn theo
   `{payload.module, payload.version, extensionField}` đọc từ chính payload, không
   theo manifest. Manifest chỉ dùng để báo cáo và để bỏ qua sớm.
3. Tra adapter registry bằng **exact match** ba thành phần. KHÔNG range, KHÔNG
   fallback sang version khác — giống hệt rule đã phát hành cho module registry
   (ADR-0007) và cho Evidence client.
4. Miss ⇒ expansion outcome `unsupported-module`, node vẫn là node hợp lệ, walk
   tiếp. **KHÔNG throw, KHÔNG fail.**
5. Nếu consumer truyền `options.capabilities` (allowlist `{moduleId, version}[]`),
   adapter ngoài allowlist bị coi như không tồn tại (cùng outcome
   `unsupported-module`), để consumer thu hẹp surface một cách tường minh.
6. Manifest khai nhiều version của cùng `moduleId`: negotiation **không chọn giúp**
   — mỗi entity payload tự khai version của nó, và bước 3 quyết định. Không có
   "preference order" nào vì không có tình huống nào phải chọn.

Hệ quả bắt buộc: một deployment khai module mà consumer không hỗ trợ **không bao
giờ** làm hỏng traversal của consumer đó. Đây là compatibility gate, có test riêng.

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
  | `graph.capability.manifest` | Manifest đọc được, `modules[]` hợp lệ | error |
  | `graph.capability.unsupported_is_not_error` | Module/version lạ cho outcome `unsupported-module`, không throw | error |
  | `graph.capability.exact_match` | Không có fallback sang version khác | error |
  | `graph.traversal.edge_matrix` | Mọi edge quan sát được thuộc đúng một hàng của edge matrix | error |
  | `graph.traversal.source_targets_opt_in` | Mặc định KHÔNG request tới `authorship.source_targets` | error |
  | `graph.traversal.metadata_not_fetched` | Không request tới `evidence.source.url`/`publisher.url` | error |
  | `graph.traversal.cycle_contained` | Cycle cho outcome `cycle`, không lỗi, không lặp vô hạn | error |
  | `graph.traversal.type_mismatch_scoped` | Verdict sai type không lan sang occurrence khác | error |
  | `graph.ordering.deterministic` | Hai run với thứ tự hoàn tất khác nhau cho cùng chuỗi event | error |
  | `graph.ordering.mixed_order_equivalence` | Đảo thứ tự reference cho cùng graph và cùng số request | error |
  | `graph.budget.no_double_charge` | Fan-in ⇒ 1 node charge, 1 request | error |
  | `graph.budget.partial_not_complete` | Dừng vì budget ⇒ `partial: true`, `stopReason: "budget"` | error |
  | `graph.budget.no_request_after_abort` | Sau abort, request count không tăng | error |
  | `graph.streaming.terminal_event` | `complete` phát đúng một lần | error |
  | `graph.streaming.bounded_memory` | Buffer không vượt `maxBufferedEvents` | warning |
  | `graph.compat.core_only_unchanged` | Consumer core-only/single-module không đổi behavior | error |

- Fixture matrix (local, chạy trong CI, không cần deployment): fan-in, mixed
  order, mixed type, cycle, depth limit, unsupported module, unsupported version,
  budget stop, abort, collection paging.
- Hai neutral data set (Phase 6) phải có **tên, URL và owner cụ thể ghi trong
  implementation record** trước khi gate được coi là đóng; "hai data set" không có
  định danh thì không tái lập và không audit được. Data set MUST do hai bên khác
  nhau vận hành, và ít nhất một bên không phải AADP maintainers.

## Typed API contract

```ts
export type ExpansionOutcome =
  | "expanded" | "leaf" | "unsupported-module"
  | "depth-limit" | "cycle" | "not-resolved" | "budget-exhausted";

export type GraphNodeStatusV1 = AnswerTargetResolutionStatus; // tái dùng, không enum mới

export interface GraphNodeV1<T = unknown> {
  key: string;                    // canonical {id, normalizedUrl}
  depth: number;
  status: GraphNodeStatusV1;      // canonical outcome, dùng chung
  entity?: EntityV1<T>;
  modules?: Array<{ id: string; version: string; extensionField: string }>;
  expansion?: ExpansionOutcome;
  message?: string;
}

export interface GraphEdgeV1 {
  from: string;
  to: string;
  edgeGroup: string;
  index: number;
  declaredTargetType: string;
  status: GraphNodeStatusV1;      // verdict theo occurrence, KHÔNG dùng chung
  message?: string;
}

export interface GraphTraversalOptions extends RelationsClientOptions {
  budget: RelationsTraversalBudgetState;
  adapters?: readonly TraversalAdapter[];
  capabilities?: ReadonlyArray<{ moduleId: string; version: string }>;
  includeGeneratedSummarySources?: boolean;  // default false
  followCollections?: boolean;               // default true
  concurrency?: number;                      // default 4
  maxBufferedEvents?: number;                // default 256
  signal?: AbortSignal;
}

export function registerBuiltinTraversalAdapters(): void;
export function traverseGraphV1(...): AsyncIterableIterator<GraphTraversalEventV1>;
export function collectGraphV1(...): Promise<CrossModuleGraphV1>;
export function runGraphTraversalConformance(
  options: GraphTraversalConformanceOptions,
): Promise<GraphTraversalConformanceReport>;
```

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
- `followCollections` mở ra bề mặt paging lớn hơn Evidence `1.0` từng có; cần
  quyết định trong ADR-0011 xem `maxPages` mặc định là bao nhiêu và có nên
  default `false` không.
- Hai neutral data set và owner của chúng chưa được định danh — đây là gate về
  môi trường/nhân sự, không phải code, giống hệt gate đã kéo từ `1.3.0` sang `1.4.0`.

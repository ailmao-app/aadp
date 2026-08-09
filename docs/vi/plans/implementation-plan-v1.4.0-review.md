# Review kế hoạch triển khai `ail-aadp` 1.4.0

## Thông tin review

| Thuộc tính | Giá trị |
|---|---|
| Ngày review | 2026-08-08 |
| Plan được review | [`implementation-plan-v1.4.0.md`](implementation-plan-v1.4.0.md) |
| Phạm vi | Tính sẵn sàng triển khai, wire contract, kiến trúc, compatibility và verification |
| Kết luận | **Chưa implementation-ready cho toàn bộ release** |

## Kết luận ngắn

Không nên bắt đầu triển khai toàn bộ Evidence & Provenance Module từ plan hiện
tại. Plan vẫn tự đánh dấu là `Blocked Implementation Draft`, citation/claim ADR
chưa tồn tại, và nhiều quyết định ảnh hưởng trực tiếp đến wire artifact bất biến
chưa được khóa.

Có thể triển khai độc lập work package 5 — generic module support ở server layer
— vì core manifest và entity contract đã có extension point tương ứng. Phần này
phải giữ generic, không chứa logic Answer hoặc Evidence.

## Findings

### 1. Blocker: citation/claim ADR chưa tồn tại

Plan đặt citation/claim ADR làm dependency và work package đầu tiên, nhưng repo
hiện chỉ có ADR-0001 đến ADR-0009. Chưa có authoritative decision cho:

- `claim`, `evidence`, `source` là document kind, resource type hay object lồng;
- ownership, cardinality và integrity của các reference;
- canonical identity và quy tắc deduplicate;
- publisher identity và provenance timestamp precedence;
- confidence scale, nguồn tạo confidence và ý nghĩa của từng stance;
- private, authenticated hoặc cross-origin source;
- cycle nào hợp lệ và cycle nào phải reject.

Schema, types, semantic validator và traversal đều phụ thuộc các quyết định này.
Không nên tạo released schema trước khi ADR được accept.

### 2. Blocker: Answer integration chưa có contract cụ thể

Answer `1.0` là released immutable contract. Contract hiện tại chỉ cung cấp
generic `source_targets` và `related_entities` thông qua
`AnswerEntityReferenceV1`; Answer wrapper không hỗ trợ thêm vendor extension.

Plan phải chốt:

- Evidence được tham chiếu qua `source_targets`, `related_entities` hay cả hai;
- canonical `target_type` cho claim/evidence/source;
- integration chỉ thêm helper/conformance hay thay đổi validation result;
- cách tránh duplicate evidence payload mà không sửa Answer `1.0` schema.

Nếu cần thêm field hoặc thay đổi tập payload hợp lệ của Answer, phải tạo module
version mới thay vì sửa artifact `aadp:answer@1.0`.

### 3. Blocker: chưa có wire contract đủ chi tiết

Work package “versioned schemas/types/fixtures” chưa chỉ rõ:

- module ID, module version và danh sách document kind;
- required/optional fields của claim, evidence và source;
- schema ID, standalone envelope và inline extension field;
- reference identity và canonical target;
- confidence range, precision và interpretation;
- timestamp format, ordering và conflict policy;
- freshness là publisher metadata hay client-computed classification;
- checksum coverage và extension policy;
- package/schema export paths.

Các mục trên phải được khóa trước khi tạo schema vì released schema là immutable
theo ADR-0004 và ADR-0007.

### 4. Blocker: graph và traversal policy còn mơ hồ

Các gate “không dangling reference”, “không unbounded graph” và “cycle ngoài
policy” chưa đủ để tạo deterministic validator/conformance suite. Cần định nghĩa:

- reference nào bắt buộc resolve và reference nào được phép unresolved;
- 401/403, private URL và cross-origin denial có bị coi là dangling không;
- shared limits cho depth, node, request, response byte và deadline;
- dedup theo URL, entity ID hay cặp `{id, url}`;
- cycle guard và self-reference policy;
- partial-result model và stable issue/check IDs;
- cancellation, retry và budget exhaustion semantics.

Nên tái sử dụng shared HTTP, URL/DNS policy và traversal budget hiện có; không tạo
một network stack riêng cho Evidence.

### 5. Generic server support có thể triển khai độc lập

Core contract đã có:

- `ManifestV1.modules`;
- `EntityV1` cho phép root extension field `x_*`;
- manifest JSON Schema đã định nghĩa module declaration `{id, version, schema}`.

Server boundary hiện còn thiếu:

- `AadpServerConfig` chưa nhận module declarations;
- `SerializedEntity` chưa có API để trả extension fields;
- runtime chưa copy và validate extension fields vào entity output.

Kiến trúc đề xuất:

```text
Resource/repository
    -> serialize(record)
    -> SerializedEntity { core fields, extensions }
    -> generic server runtime validates and emits x_*
    -> AADP entity response
```

Public API nên dùng một field rõ nghĩa như `extensions` thay vì cho phép arbitrary
properties trên toàn bộ `SerializedEntity`. Runtime phải:

- chỉ chấp nhận key khớp grammar `x_*`;
- chống ghi đè core fields;
- không mutate object do consumer cung cấp;
- giữ checksum ổn định trên entity output cuối cùng;
- giữ nguyên behavior khi `modules` và `extensions` bị omit.

Module declarations phải được truyền qua `AadpServerConfig.modules` và validate
theo core manifest schema/semantic rules. Server runtime không được import hoặc
register Answer/Evidence module.

### 6. Major gap: execution plan và verification matrix chưa đầy đủ

Plan chưa có phase ordering, file map và acceptance criteria theo work package.
Cần bổ sung tối thiểu:

- danh sách schema/spec/type/register/client/conformance files dự kiến;
- schema immutability digest test;
- valid, invalid và malicious fixtures;
- core-only compatibility test trong process sạch;
- unsupported module/version/kind negative tests;
- reference-server resources và manifest declaration;
- packed-tarball clean-install test;
- real HTTP run cho Answer và Evidence conformance;
- external implementation hoặc fixture portability evidence;
- package exports, README, CHANGELOG và implementation record.

Mock server và unit test không đủ để đóng external conformance gate đã defer từ
release 1.3.0.

## Boundary kiến trúc được đề xuất

| Layer | Trách nhiệm |
|---|---|
| Core server | Serialize generic `x_*`, publish generic module declarations |
| Evidence module schema/types | Wire contract bất biến của `aadp:evidence` |
| Evidence semantic service | Integrity, timestamp, stance, confidence và provenance rules |
| Evidence client/traversal | Fetch, URL/DNS policy, shared budget, cycle guard, partial result |
| Conformance | Stable checks, malicious fixtures và report |
| Reference server | Neutral Answer/Evidence records và repository; không chứa reusable protocol logic |

Không đặt business/semantic rules của Evidence trong server runtime hoặc example
route. Không hardcode `x_answer`/`x_evidence` trong generic server layer.

## Điều kiện để chuyển sang Implementation Ready

- [ ] Citation/provenance/security ADR đã được accept.
- [ ] Wire model cho claim/evidence/source đã được khóa.
- [ ] Answer integration contract không sửa Answer `1.0` artifact.
- [ ] Graph integrity, cycle và traversal budget semantics đã cụ thể.
- [ ] Generic server public API đã được chọn và ghi compatibility contract.
- [ ] File map và phase ordering đã được bổ sung.
- [ ] Test/conformance matrix có stable expected outcomes.
- [ ] Reference deployment và packed-tarball execution flow đã được mô tả.
- [ ] External interoperability evidence có owner và môi trường chạy xác định.
- [ ] Release checklist bao gồm docs, exports, digests và implementation record.

## Khuyến nghị thứ tự triển khai

1. Accept citation/provenance/security ADR.
2. Khóa Evidence `1.0` specification và schema contract trên giấy.
3. Triển khai generic server module support cùng compatibility tests.
4. Triển khai schema, types, registry và semantic validator của Evidence.
5. Triển khai client/traversal bằng shared URL/DNS/budget infrastructure.
6. Thêm reference resources cho Answer và Evidence.
7. Chạy packed-tarball conformance qua real HTTP deployment.
8. Khóa schema digests, cập nhật docs/exports/CHANGELOG và tạo implementation record.

## Verdict

| Phạm vi | Trạng thái |
|---|---|
| Generic server module support | **Có thể bắt đầu sau khi chốt shape public API nhỏ** |
| Reference Answer resource | **Chờ generic server support** |
| Evidence wire/schema/types | **Blocked bởi ADR và wire decisions** |
| Evidence semantic validation/traversal | **Blocked bởi graph/security policy** |
| Full 1.4.0 release | **Chưa implementation-ready** |

# Kế hoạch triển khai `ail-aadp` 1.3.1

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Proposed — implementation ready, không chờ ADR |
| Loại | Patch release, **security fix** |
| Chủ đề | Answer client: canonical resolution cache bị dùng chung xuyên authorization context |
| Phiên bản bị ảnh hưởng | `ail-aadp@1.3.0` (bản duy nhất có per-budget outcome cache) — **đã publish public trên npm**, nên cần disclosure, xem §"Disclosure" |
| Wire impact | **Không** — `aadp:answer@1.0`, Relations `1.0` và core v1.0 schema không đổi |
| Public API impact | **Không có export mới** — xem §"Quyết định fix" |
| Dependency | Không. Độc lập hoàn toàn với ADR-0010 và [kế hoạch `1.4.0`](implementation-plan-v1.4.0.md) |

Kế hoạch này tách khỏi `1.4.0` có chủ đích: lỗi đã có trong bản đã phát hành, fix
được ngay trên nhánh `1.3.x`, và không nên bị chặn sau ADR-0010 hay Evidence
Module. `1.4.0` sau đó kế thừa nguyên contract này khi nâng cache lên tầng dùng
chung giữa các module.

## Bug

### Triệu chứng

Một caller **không có credential** có thể nhận về entity được bảo vệ mà chưa từng
phát request lẽ ra phải trả 401/403.

### Root cause

`src/modules/answer/v1.0/client/resolve.ts:302` giữ:

```ts
const budgetState = new WeakMap<RelationsTraversalBudgetState, BudgetResolutionState>();
// BudgetResolutionState = { outcomes, pending, globalStops }
```

Cache `outcomes` và `pending` khoá theo `{ budget, canonical target key }`. Nhưng
`headers`, `crossOriginSafeHeaders`, `urlPolicy` (`FetchJsonOptions`) và
`rootOrigin` (`RelationsClientOptions`) là option **theo từng call**, không tham
gia khoá. Budget lại được thiết kế để caller sở hữu và dùng chung nhiều call —
docstring của `resolveAnswerTargets` nói rõ state "outlives a single call" và
"race-safe across concurrent calls sharing the same budget".

Tuần tự:

```text
1. resolveAnswerTargets(answer1, { budget: B, headers: { Authorization: A } })
   -> target E resolved, ghi outcomes[key(E)] trên budget B.
2. resolveAnswerTargets(answer2, { budget: B })          // KHÔNG credential
3. Cache hit theo {B, key(E)} -> caller thứ hai nhận E,
   không có request nào được phát.
```

Concurrent:

```text
1. Call ẩn danh và call có credential cùng chạy trên budget B, cùng target E.
2. Call nào tạo `pending` trước sẽ quyết định headers/urlPolicy cho MỘT request
   dùng chung.
3. Cả hai caller nhận cùng kết quả đó -> kết quả phụ thuộc thứ tự chạy.
```

### Blast radius

- Chỉ Answer client. Đã rà toàn repo: đây là **per-budget cache duy nhất**
  (`WeakMap` khác chỉ có `dispatcherCache` khoá theo `UrlPolicy` trong
  `src/client/dns-pin.ts`, không mang kết quả response).
- Relations resolver và core client **không** cache outcome → không ảnh hưởng.
- Chỉ kích hoạt khi caller **dùng chung một budget object** giữa các call có
  context khác nhau. Mỗi call một budget mới thì không dính.
- Không phải lỗi wire/schema; server và document đã publish không bị ảnh hưởng.

## Mục tiêu

- Bảo đảm **một budget = một resolution context bất biến**, fail closed khi vi phạm.
- Không đổi hành vi của mọi cách dùng đúng hiện tại (một context cho suốt walk).
- Không đổi wire contract, không bump module version, không thêm public export.

## Ngoài phạm vi

- Không trích xuất shared canonical resolution layer (việc đó thuộc `1.4.0`).
- Không thêm Evidence, không đụng ADR-0010.
- Không đổi `AnswerResolveOptions`, `resolveAnswerTargets` signature hay
  `AnswerResolvedTargets`.
- Không thêm cơ chế cache mới, không đổi budget accounting.

## Quyết định fix

### Resolution context identity

Layer gắn một **context identity** vào `BudgetResolutionState` ở lần dùng đầu
tiên của budget đó. Trước **mọi** cache hit, pending join hoặc charge, so khớp
context của call hiện tại với context đã gắn.

Thành phần **trong** context identity:

| Option | Lý do |
|---|---|
| `headers` (tên **và** giá trị) | Authorization/tenant/session — biên principal |
| `crossOriginSafeHeaders` | Quyết định header nào còn được gửi khi vượt origin |
| `urlPolicy` | Quyết định URL/địa chỉ nào được phép fetch |
| `rootOrigin` | Quyết định cross-origin accounting |

Thành phần **ngoài** context identity: `signal` (đã là call-scoped theo thiết kế
hiện có), `timeoutMs`, `maxRedirects`, `maxResponseBytes`, `retry`. Chúng ảnh
hưởng liveness, không dịch chuyển biên authorization.

So khớp `urlPolicy` theo **reference identity** (WeakMap → opaque id), không
deep-compare config. Đây là cùng pattern `dispatcherFor` đang dùng
(`dns-pin.ts:53` khoá WeakMap theo `UrlPolicy`). Hai call cùng bỏ trống
`urlPolicy` sẽ cùng trỏ tới strict policy singleton nên vẫn khớp.

### Không lưu secret

Chỉ lưu **digest**: HMAC-SHA-256 trên chuỗi đã chuẩn hoá của các thành phần trên,
với salt ngẫu nhiên sinh một lần mỗi process.

- MUST NOT lưu giá trị header thô trong state.
- MUST NOT đưa digest, tên header hoặc giá trị header vào message lỗi.
- MUST NOT log chúng ở bất kỳ mức nào.

### Hành vi khi mismatch

Throw ngay, **fail closed**, trước khi charge budget hoặc phát request:

```ts
throw new AadpClientError(
  "Resolution options do not match the context this budget was first used with.",
  "resolution_context_mismatch",
);
```

- Dùng `AadpClientError` **đã export public** (`src/client/http.ts:137`,
  re-export ở `src/client/v1.0/index.ts:46`) với `code` ổn định. Nhờ vậy consumer
  vẫn `catch` và phân biệt được bằng `err.code`, mà package **không thêm một
  export nào** — giữ đúng phạm vi patch.
- KHÔNG trả partial result và KHÔNG trả status `forbidden`: đây là lỗi lập trình
  của caller, không phải trạng thái dữ liệu. Diễn đạt nó như một per-reference
  status sẽ khiến bug lẫn vào kết quả bình thường.
- Call bị từ chối là **no-op**: không mutate budget, không ghi cache, không phát
  request.

### Ảnh hưởng tương thích

Đây là thay đổi behavior của một bản đã phát hành, phải nói thẳng chứ không giấu
trong changelog chung:

- Cách dùng đúng — một context duy nhất cho toàn bộ walk — **không đổi gì**: cùng
  kết quả, cùng số request, cùng budget accounting.
- Cách dùng trộn context trên một budget: trước đây im lặng chia sẻ, nay throw.
- Không đổi schema, không đổi tập payload hợp lệ, không đổi kết quả semantic của
  bất kỳ document nào → **không bump `aadp:answer@1.0`**.
- Nếu có test hiện tại đang khẳng định hành vi chia sẻ xuyên context thì chính
  test đó đang mô tả bug: sửa test kèm ghi chú lý do trong implementation record.

## Work packages

### Phase 1 — Reproduce

1. Test tuần tự: call 1 có `Authorization`, call 2 không có, cùng budget, cùng
   target. Khẳng định bug hiện tại — call 2 nhận entity mà **không** phát request.
2. Test concurrent: hai call khác context race trên cùng budget và cùng target;
   khẳng định kết quả phụ thuộc thứ tự tạo `pending`.

Gate: cả hai test fail trên `1.3.0` (đúng nghĩa reproduce), không phải test viết
sẵn cho code mới.

### Phase 2 — Fix

1. Thêm context digest (HMAC + salt theo process) và trường context vào
   `BudgetResolutionState`.
2. Bind ở lần dùng đầu; so khớp ở đầu `resolveAnswerTargets`, trước
   `stateFor`-driven cache hit, trước `pending` join và trước `chargeNode`.
3. Throw `AadpClientError` code `resolution_context_mismatch` khi lệch.
4. Giữ nguyên `outcomes`/`pending`/`globalStops` semantics trong cùng một context.

Gate: hai test Phase 1 chuyển sang pass; toàn bộ test Answer/Relations/core hiện
có xanh không sửa (trừ ngoại lệ đã ghi ở §"Ảnh hưởng tương thích").

### Phase 3 — Test matrix

| Case | Kỳ vọng |
|---|---|
| Cùng context, nhiều call, cùng budget | Không đổi so với `1.3.0`: dedup, replay, join `pending` như cũ |
| authenticated → anonymous | Throw, no-op |
| anonymous → authenticated | Throw, no-op |
| Hai principal khác nhau (header value khác) | Throw, no-op |
| Khác `crossOriginSafeHeaders` | Throw, no-op |
| Khác `urlPolicy` instance | Throw, no-op |
| Khác `rootOrigin` | Throw, no-op |
| Chỉ khác `timeoutMs`/`maxRedirects`/`maxResponseBytes`/`retry` | **Không** throw |
| Chỉ khác `signal` | **Không** throw |
| Concurrent race khác context | Throw ở call thứ hai; call thứ nhất không bị hỏng |
| Message lỗi | Không chứa header name/value, không chứa digest |
| Budget mới cho mỗi call | Không throw, không chia sẻ gì |

### Phase 4 — Release

1. `CHANGELOG.md`: mục **Security** riêng, mô tả điều kiện kích hoạt (dùng chung
   budget object giữa các call khác credential) và cách khắc phục cho ai không
   nâng cấp được ngay: dùng budget riêng cho mỗi context.
2. Implementation record `1.3.1` ghi root cause, quyết định, test evidence.
3. Thực hiện disclosure theo §"Disclosure" — `1.3.0` đã public trên npm.
4. Cập nhật [kế hoạch `1.4.0`](implementation-plan-v1.4.0.md): phần
   resolution-context trong §"Orchestration contract" chuyển từ "phải làm" sang
   "kế thừa từ `1.3.1`", chỉ còn việc mở rộng contract đó sang tầng dùng chung.

Gate: `npm run build`, `npm test`, `npm run docs:check`,
`npm run check:release-consistency`, `npm pack --dry-run` xanh, cộng clean-install
suite hiện có.

## Disclosure

`ail-aadp@1.3.0` đã publish public trên npm, repo
[`ailmao-app/aadp`](https://github.com/ailmao-app/aadp), và repo **chưa có
`SECURITY.md`** — tức hiện chưa có kênh báo lỗi riêng tư.

### Đánh giá mức độ (đề xuất, maintainer chốt)

| Yếu tố | Nhận định |
|---|---|
| Loại | Information disclosure (confidentiality). Không ảnh hưởng integrity hay availability |
| Điều kiện kích hoạt | Ứng dụng tiêu thụ phải **dùng chung một budget object** giữa các call có credential/URL policy khác nhau |
| Attacker-initiated? | Không. Không có input từ xa nào tự gây ra; đây là lỗi chia sẻ state trong tiến trình của consumer |
| Hệ quả | Một call lẽ ra nhận 401/403 lại nhận entity đã fetch bằng credential của call khác, trong cùng process |
| Mức đề xuất | **Moderate** |

Không tự gán CVSS vector trong kế hoạch này: điểm số phụ thuộc giả định về mô hình
triển khai của consumer (multi-tenant fan-out hay không). Maintainer chốt vector
cuối khi soạn advisory.

Lưu ý khi viết advisory: pattern "một budget dùng chung cho nhiều call" **là cách
dùng được thiết kế và tài liệu hoá** (`BudgetResolutionState` cố ý sống lâu hơn
một call và race-safe giữa các call). Vì vậy đừng mô tả nó như misuse của
consumer — bug nằm ở chỗ cache không phân biệt context.

### Các bước

1. Tạo `SECURITY.md` (kênh báo lỗi riêng tư + phạm vi hỗ trợ version). Nên làm
   **trước** khi công bố advisory để người báo lỗi sau này có chỗ gửi.
2. Publish `ail-aadp@1.3.1` trước, rồi mới publish advisory — advisory phải trỏ
   tới bản vá đã có sẵn.
3. Soạn GitHub Security Advisory tại
   `https://github.com/ailmao-app/aadp/security/advisories`: affected `= 1.3.0`,
   patched `1.3.1`, kèm workaround cho ai chưa nâng cấp được (**dùng budget riêng
   cho mỗi resolution context**).
4. Cân nhắc xin CVE qua GitHub khi publish advisory. Package public + có consumer
   bên ngoài thì nên xin, để advisory chảy được vào `npm audit`/scanner.
5. **`npm deprecate ail-aadp@1.3.0 "..."`** — hành động outward-facing, chỉ chạy
   sau khi maintainer xác nhận riêng. Kế hoạch này không tự thực hiện.

Không `npm unpublish`: nó phá build của consumer đang pin `1.3.0` và không xoá
được code đã bị mirror. Deprecate + advisory là đường đúng.

## Release gate

- Hai test reproduce của Phase 1 pass sau fix, và đã được chứng minh fail trước fix.
- Toàn bộ test matrix Phase 3 xanh.
- Không có export mới trong `package.json` exports hay bất kỳ public subpath nào.
- Không có file nào dưới `schemas/` bị sửa.
- `aadp:answer@1.0`, `aadp:relations@1.0` và core v1.0 không đổi.
- Regression: core, server, Relations, Answer và conformance suite xanh.
- CHANGELOG có mục Security; implementation record hoàn tất trước khi tag.

## Definition of Done

- Cache và in-flight request không bao giờ vượt biên resolution context, ở cả
  đường tuần tự lẫn concurrent.
- Header thô không được lưu, log hay lộ qua message lỗi.
- Cách dùng một-context không thay đổi hành vi.
- `1.3.1` đã publish; advisory đã công bố với affected `= 1.3.0` và workaround.
- `SECURITY.md` tồn tại; quyết định CVE và deprecate `1.3.0` đã được maintainer
  chốt và ghi lại trong implementation record.
- Kế hoạch `1.4.0` đã được cập nhật để không làm lại phần này.

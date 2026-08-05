# ADR-0008: Shared module traversal budget và authorization boundary

## Status

Accepted — áp dụng từ Relations Module `1.0` và package `ail-aadp@1.2.0`.

## Context

ADR-0006 chưa có request counter, graph depth, node count hoặc cross-origin count.
Module traversal còn phải xử lý authorization, cursor cycle, canonical-target
deduplication và partial results mà không tạo HTTP/budget riêng cho mỗi module.

## Decision

### Shared traversal state

Một traversal tree MUST dùng cùng budget state từ root tới mọi core/module request:

```ts
interface TraversalBudgetState {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxRequests: number;
  readonly maxTotalBytes: number;
  readonly deadlineMs: number;
  readonly maxCrossOriginRequests: number;
  readonly startedAt: number;
  nodesVisited: number;
  requestsStarted: number;
  bytesFetched: number;
  crossOriginRequestsStarted: number;
}
```

Mỗi HTTP attempt, retry và redirect hop charge request trước network. Byte charge
khi stream body. Canonical target mới charge node; duplicate target không charge
node lần hai. Root depth là `0`; follow một edge tăng depth một đơn vị.

### Compatibility với 1.1.0

Public `DiscoveryBudgetState` không đổi nghĩa. Implementation MAY tạo generic
state kèm adapter hoặc thêm optional dimensions có defaults tương thích. Không
alias `maxPages`/`maxEntities` thành `maxRequests`.

### Cycle và cursor

Canonical key là `{id, normalizedUrl}`. Client MUST phát hiện cursor lặp,
deduplicate target, dừng cycle branch và ghi issue provenance. Cursor MUST bind với
source, relation, target type, ordering và filter; cursor sai context bị từ chối.

### Authorization

Credential provider nằm ở application boundary. Core/module không lưu credential
và không tự login/OAuth:

```text
validate manifest/security metadata
→ resolve credential and allowed origin/path
→ decorate request
→ fetch protected document
→ validate fetched document
→ trust discovered URLs only after validation
```

Credential MUST bị loại khi đổi origin trừ explicit allow-list. Query credential
MUST không forward qua redirect. `unauthorized`/`forbidden` không fallback scraping.

### Partial results

Budget, policy, unsupported module/version/kind, cancellation và broken optional
edge tạo partial result có provenance và MUST NOT được báo complete. Pure validator
không gọi network; resolution/traversal service dùng shared HTTP/budget.

### Reference defaults

| Dimension | Default |
|---|---:|
| `maxDepth` | 3 |
| `maxNodes` | 1,000 |
| `maxRequests` | 2,000 |
| `maxTotalBytes` | 64 MiB |
| `deadlineMs` | 5 phút |
| `maxCrossOriginRequests` | 100 |

Defaults là client policy, không phải wire contract. Report MUST ghi effective
limits. Omitting options mới MUST giữ default behavior 1.1.0 cho core-only client.

## Consequences

- HTTP layer cần charge hook trước mỗi network attempt.
- Relations traversal nằm trong service riêng; pure validators không fetch.
- Client và conformance dùng chung budget/cycle semantics.
- Application sở hữu credential, visibility và business mapping.

## References

- [ADR-0006](0006-bounded-traversal-controls.md)
- [ADR-0007](0007-module-versioning-and-discovery.md)
- [Relations Module v1.0 specification](../../spec/modules/relations/v1.0/specification.md)

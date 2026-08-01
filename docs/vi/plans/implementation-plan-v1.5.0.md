# Kế hoạch triển khai `ail-aadp` 1.5.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Blocked Implementation Draft |
| Chủ đề | Cross-module graph traversal |
| Dependency | Relations, Answer, Evidence stable |
| Wire impact | Không đổi core schema |

## Architecture

```text
consumer → graph traversal service
              ├── module registry
              ├── shared budget/cycle guard
              ├── dedupe
              └── typed partial results
                         ↓
              versioned module clients → core HTTP policy
```

## Scope

- Capability negotiation theo module ID/version.
- Entity→Relations→Answer→Evidence traversal plan.
- Shared depth/request/entity/byte/deadline budget.
- Streaming iterator, dedupe và partial/inconclusive results.
- Cross-module conformance profile và stable report IDs.

Business interpretation/ranking nằm ngoài traversal service.

## Release gate

- Không unbounded graph/memory/request.
- Deterministic ordering semantics.
- Partial result không bị báo complete.
- Core-only/single-module consumer không regression.
- Hai neutral data sets đạt interoperability tests.

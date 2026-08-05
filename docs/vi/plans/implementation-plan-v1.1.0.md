# Kế hoạch triển khai `ail-aadp` 1.1.0

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Implementation Draft |
| Chủ đề | Bounded traversal controls |
| Dependency | Dòng `1.0.x` ổn định |
| Wire impact | Không đổi AADP v1.0 |

## Public capability

- `AbortSignal` xuyên suốt request/body/traversal.
- Configurable concurrency limit với default tương thích.
- Retry/backoff/`Retry-After` opt-in.
- Tổng request/response-byte/deadline budget.
- Conformance profiles: `core`, `public-web`, `full-traversal`, `authenticated`.

## Kiến trúc

```text
CLI/options → traversal policy service
                 ├── scheduler
                 ├── retry policy
                 ├── shared budgets
                 └── cancellation
                         ↓
                 HTTP + URL/DNS policy
```

CLI chỉ parse/render. Scheduler, retry và budget là module thuần (không phụ
thuộc HTTP/CLI), nhưng **không** clock/fetch-injectable — `Date.now`,
`Math.random`, `setTimeout` và `fetch` được gọi trực tiếp. Quyết định này đã
được chốt lại trong `docs/adr/0006-bounded-traversal-controls.md` §Testability
(bản draft ban đầu của kế hoạch này từng yêu cầu injection, nhưng seam đó
chưa bao giờ được triển khai; test dựa trên timer thật ngắn + mock server
thật thay vì fake clock).

## Work packages

1. ADR/public option semantics và default compatibility.
2. Cancellation propagation và cleanup.
3. Concurrency scheduler có fairness/bounded queue.
4. Retry policy không vượt budget, không retry lỗi permanent.
5. Total-byte/deadline accounting.
6. Profile registry, report metadata và CLI flags.
7. Tarball/type/docs/conformance verification.

## Release gate

- Default giữ behavior `1.0.x`.
- Abort dừng header, body, retry timer và iterator.
- Không unbounded queue/timer/request.
- Credential không đi qua cross-origin retry/redirect.
- Public API/CLI/report compatibility tests xanh.
- `1.1.x` chỉ dùng để stabilize capability này.

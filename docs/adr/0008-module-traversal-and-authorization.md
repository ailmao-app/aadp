# ADR-0008: Shared module traversal budget and authorization boundary

## Status

Accepted — applies from Relations Module `1.0` and package `ail-aadp@1.2.0`.

## Context

ADR-0006 has no request counter, graph depth, node count or cross-origin count.
Module traversal additionally has to handle authorization, cursor cycles,
canonical-target deduplication and partial results — without giving each module
its own HTTP stack or budget.

## Decision

### Shared traversal state

One traversal tree MUST use the same budget state from the root through every
core and module request:

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

Every HTTP attempt, retry and redirect hop charges a request before touching the
network. Bytes are charged while streaming the body. A new canonical target
charges a node; a duplicate target does not charge one a second time. Root depth
is `0`; following an edge increases depth by one.

### Compatibility with 1.1.0

The public `DiscoveryBudgetState` does not change meaning. An implementation MAY
introduce a generic state with an adapter, or add optional dimensions with
compatible defaults. Do not alias `maxPages`/`maxEntities` onto `maxRequests`.

### Cycles and cursors

The canonical key is `{id, normalizedUrl}`. A client MUST detect repeated
cursors, deduplicate targets, stop a cyclic branch and record issue provenance.
A cursor MUST be bound to its source, relation, target type, ordering and
filters; a cursor presented in the wrong context is rejected.

### Authorization

The credential provider lives at the application boundary. Core and module code
never stores credentials and never performs login/OAuth itself:

```text
validate manifest/security metadata
→ resolve credential and allowed origin/path
→ decorate request
→ fetch protected document
→ validate fetched document
→ trust discovered URLs only after validation
```

Credentials MUST be dropped when the origin changes, unless an explicit
allow-list says otherwise. Query-string credentials MUST NOT be forwarded across
a redirect. `unauthorized`/`forbidden` MUST NOT fall back to scraping.

### Partial results

Budget exhaustion, policy blocks, an unsupported module/version/kind,
cancellation and a broken optional edge all produce a partial result with
provenance, and MUST NOT be reported as complete. Pure validators make no
network calls; the resolution/traversal service uses the shared HTTP stack and
budget.

### Reference defaults

| Dimension | Default |
|---|---:|
| `maxDepth` | 3 |
| `maxNodes` | 1,000 |
| `maxRequests` | 2,000 |
| `maxTotalBytes` | 64 MiB |
| `deadlineMs` | 5 minutes |
| `maxCrossOriginRequests` | 100 |

Defaults are client policy, not wire contract. A report MUST record the
effective limits. Omitting the new options MUST preserve 1.1.0 default behaviour
for a core-only client.

## Consequences

- The HTTP layer needs a charge hook before every network attempt.
- Relations traversal lives in its own service; pure validators do not fetch.
- The client and the conformance runner share budget and cycle semantics.
- The application owns credentials, visibility and business mapping.

## References

- [ADR-0006](0006-bounded-traversal-controls.md)
- [ADR-0007](0007-module-versioning-and-discovery.md)
- [Relations Module v1.0 specification](../../spec/modules/relations/v1.0/specification.md)

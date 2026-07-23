# ADR-0002: Cache semantics

## Status

Accepted — AADP v0.1

## Context

AI clients are expected to re-crawl AADP endpoints on a schedule. Without
explicit cache semantics, every crawl would re-fetch and re-validate every
entity, which does not scale for either the AI client or the origin
server, and gives implementers no standard way to signal freshness.

## Decision

- The mandatory cache contract applies to the three resource kinds that
  carry both a `checksum` and a timestamp: **sitemap index, sitemap, and
  entity**. For these, every 2xx response MUST set:
  - `ETag`: the resource's checksum (see ADR-0001), quoted per RFC 9110.
  - `Last-Modified`: derived from the resource's `generated_at` (sitemap
    index/sitemap) or `updated_at` (entity) field.
  - `Cache-Control`: producer-defined `max-age`; AADP does not mandate a
    value but RECOMMENDS `max-age=300` for entities and shorter values for
    sitemap index/sitemap since those change less predictably but gate
    discovery.
- Servers MUST support conditional GET via `If-None-Match` for these
  three kinds. A matching `ETag` MUST return `304 Not Modified` with no
  body.
- Servers SHOULD support `If-Modified-Since` as a fallback for clients
  that only track `Last-Modified`.
- The **manifest** is exempted from the mandatory checksum-backed `ETag`
  requirement: v0.1's manifest schema has no `checksum`/timestamp field,
  since it is expected to be small and near-static. Servers MAY still set
  `Cache-Control` on it. This was a deliberate scope narrowing (see spec
  §7) rather than an oversight — earlier drafts of this ADR implied a
  uniform requirement across all resource kinds, which was inconsistent
  with the schemas as specified and untestable by the conformance suite.
- **Error envelope** responses are out of scope for this ADR entirely:
  HTTP error responses are not cacheable resource representations.
- Checksum/ETag stability (ADR-0001) is a hard precondition for this ADR:
  if checksums are not stable across re-serialization, conditional GET
  produces false negatives (unnecessary 200s) and erodes trust in 304s.
- **Weak validators in transit are expected, not a violation.** An origin
  MUST emit a strong `ETag` (`"sha256:<hex>"`), but an intermediary (CDN,
  compression proxy) MAY rewrite it to a weak validator
  (`W/"sha256:<hex>"`) — confirmed in practice: Cloudflare in front of
  the Ailmao pilot does this whenever it gzip/brotli-compresses the
  response, since the original strong validator no longer represents the
  exact on-wire bytes (RFC 9110 §8.8.1). This does not break conditional
  GET: `If-None-Match` on `GET`/`HEAD` always uses weak comparison
  regardless of which side sent the `W/` prefix. Clients and conformance
  tooling MUST compare ETags by their validator value with an optional
  leading `W/` stripped, not by exact byte equality including the prefix.

## Verified in production

Confirmed against the live Ailmao pilot deployment (`ailmao.com`,
2026-07-22): origin (Next.js) emits a strong `ETag`; Cloudflare rewrites
it to weak in transit whenever it compresses the response (which happens
for any client that negotiates `Accept-Encoding: gzip`/`br`/`zstd` — the
common case, including Node's built-in `fetch`). Reproduced with both
`curl --compressed` and the reference client.

This initially broke conditional GET for the compressed path: the origin
compared the incoming `If-None-Match` (weak, as echoed by the client)
against its own strong `ETag` using **strict string equality**, so a
weak/strong pair that represents the same checksum never matched —
`304` only ever fired for uncompressed requests, which is not what most
real clients send. Fixed at the origin by implementing RFC 9110 §8.8.3.2
weak comparison (strip an optional `W/` from both sides before
comparing) — see `ailmao-landing/lib/aadp/http.ts`'s `ifNoneMatchHits()`.
The conformance suite's ETag assertion does the same stripping when
reading the *response* ETag for comparison against the declared
checksum.

## Consequences

- Origin servers need to be able to compute `updated_at` and checksum
  cheaply, or cache them alongside the source record, since they are
  required on every response, not only on change.
- The conformance suite (`tests/conformance/`) MUST assert 304 behavior
  and checksum/ETag stability as a release-blocking check.

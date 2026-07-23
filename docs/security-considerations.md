# AADP v0.1 — Security Considerations

Status: required reading before implementing an AADP server or adapter,
per the Phase A3 release gate in `docs/IMPLEMENTATION_PLAN.md` §8.

## 1. AADP is read-only by design

v0.1 defines no write, mutation or command surface. Any server that
attaches write semantics to an AADP-shaped endpoint is not implementing
this specification. This eliminates an entire class of injection/mutation
risk at the protocol level; implementers MUST NOT bolt write behavior
onto `/ai/v0.1/*` routes.

## 2. Data exposure is a server decision, not a protocol guarantee

AADP does not know or enforce what a server chooses to put in `data`.
Servers MUST treat every field they expose through a sitemap or entity as
**public**, since:

- No authentication is defined in v0.1 (see §8 below).
- Checksums and cache headers do not encrypt or restrict content — they
  are integrity/freshness aids, not access control.

Implementers MUST run an explicit field allow-list / export audit before
wiring an existing internal type into an AADP serializer (this is exactly
what Phase B0 mandates for the Ailmao adapter — mapping document +
"data exposure matrix"). Never serialize an internal model directly;
never assume a field is safe because it's "already public in the UI" —
UI rendering and JSON export have different blast radii (e.g. moderation
state, internal IDs, soft-deleted flags visible in dev tools but not
meant for bulk machine consumption).

## 3. Canonical ID stability and enumeration

- Canonical IDs (`{type}:{id}`) are stable public identifiers by
  construction — a server publishing them is committing to their
  stability (see spec §2, ADR discussion in `IMPLEMENTATION_PLAN.md` §6
  re: username-based IDs). Implementers MUST confirm the underlying ID is
  actually immutable before using it as a canonical ID; otherwise entity
  URLs silently 404 after a rename and any external index becomes stale.
- Sitemaps make full enumeration of a resource type trivial by design —
  that is the point of the protocol. Implementers MUST NOT publish a
  resource type in a sitemap unless every item in it is intended to be
  bulk-enumerable by any client, including adversarial scrapers. Anything
  requiring rate-limited or gated access does not belong in v0.1's
  unauthenticated model.

## 4. Denial of service surface

- **Pagination**: the mandatory page-size cap (spec §5, max 100) bounds
  per-request response size. Servers MUST enforce the cap server-side,
  never trust a client-supplied page size unbounded.
- **Cursor cycles**: spec §5 forbids servers from producing a `next`
  cycle; a cyclical cursor is a client-side resource-exhaustion vector
  (an AI crawler stuck in an infinite discovery loop). The conformance
  suite's `iterateSitemap` cursor-seen check exists specifically to catch
  this at test time, but servers are the ones who must not produce it.
- **Upstream fan-out**: a naive adapter that calls its origin API once per
  sitemap item defeats caching and amplifies load. Implementers SHOULD
  batch or cache upstream reads (see `IMPLEMENTATION_PLAN.md` §4.2 data
  source layer) rather than fan out per-request.
- Standard HTTP-layer mitigations (rate limiting, CDN caching honoring
  `Cache-Control`, WAF) are the deploying operator's responsibility; AADP
  only provides the cache headers and pagination cap that make such
  mitigations effective.

## 5. Checksum is integrity, not authenticity

`sha256:<hex>` (ADR-0001) proves the payload matches what the server
canonicalized — it detects transport corruption or accidental mutation.
It is **not** a signature: a malicious or compromised server can compute
a valid checksum over falsified data. Do not present the checksum to end
users as a trust/authenticity signal beyond "the body matches its own
declared hash." If cryptographic authenticity of the origin is required,
that is a v1.0+/extension-point concern (`x_*` field), out of scope for
v0.1.

## 6. Locale and error messages

- `message` in the error envelope (spec §9) is for humans/logs and MAY be
  localized; it MUST NOT be relied upon by clients for control flow —
  clients MUST branch on `error.code`, not `error.message` text.
  Implementers MUST NOT leak internal error detail (stack traces, DB
  errors, upstream response bodies) into `message`; map upstream failures
  to `upstream_unavailable` with a generic message instead.
- `request_id` SHOULD be an opaque trace identifier, safe to log and
  correlate, and MUST NOT itself encode sensitive data (e.g. a raw
  internal object ID that wasn't otherwise exposed).

## 7. No authentication in v0.1

AADP v0.1 is unauthenticated/public-only by design (see roadmap in
`AADP_Draft.md` — auth is deferred to v0.5+). Consequences:

- Do not deploy an AADP v0.1 endpoint for data that requires access
  control. There is no protocol-level mechanism to restrict it.
- A future `capabilities` token (ADR-0003) may announce an auth scheme;
  until that lands, "AADP-shaped but requires an API key" is not v0.1
  conformant and must not claim conformance in its manifest.

## 8. SSR / server boundary leakage (adapter-specific, forward note)

For adapters that sit in front of an internal API (as planned for
`ailmao-landing` in Chặng B), the adapter's own base URL/config and any
upstream credentials MUST stay server-side only. The AADP layer being
public by design makes this an easy place to accidentally leak an
internal upstream URL or debug header into a response — Phase B4
explicitly requires testing this boundary before pilot production
deploy.

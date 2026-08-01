# Proposal: adjacent agent-discovery integrations for AADP

Written after wiring `ailmao-landing` (the reference AADP consumer) up against
an external "agent readiness" scanner (isitagentready.com) that checks for a
handful of mechanisms adjacent to, but not covered by, the AADP v1.0 spec:
RFC 8288 Link headers, `Accept: text/markdown` content negotiation, RFC 9727
API catalogs, DNS-AID SVCB records, WebMCP, MCP server cards, OAuth/OIDC
discovery, and auth.md.

Every one of these had to be hand-rolled in `ailmao-landing` itself rather
than coming from `ail-aadp`. Some of that hand-rolling exposed real gaps in
the library; the rest is out of scope for AADP and should stay that way.
Filing both so the line is explicit for whoever picks this up.

## Worth pulling into `ail-aadp`

1. **`Link` header helper.** `ailmao-landing/middleware.ts` now hardcodes
   `</.well-known/ai-manifest.json>; rel="api-catalog"` on every response.
   Every AADP consumer will need the exact same header, and the value is
   fully derivable from the config already passed to `defineAADP()` (it's
   just `${baseUrl}/.well-known/ai-manifest.json`). Suggest
   `aadp.linkHeader()` or exporting the well-known path as a constant from
   `ail-aadp/server` so consumers don't retype it (and can't typo it).

2. **RFC 9727 API catalog generation.** We ended up hand-writing
   `/.well-known/api-catalog` (`application/linkset+json`) in
   `ailmao-landing`, and it only has one honest entry (`service-desc` →
   the AADP manifest) because nothing else in `defineAADP()`'s `links`/
   `policies`/`resources` maps cleanly onto `service-doc`/`status` relations.
   If `defineAADP()` grew an optional `healthCheck: string` field alongside
   `policies`, AADP itself could emit a spec-compliant linkset (`service-desc`
   always; `status` when `healthCheck` is set) via something like
   `aadp.buildApiCatalogLinkset()`. Every consumer needs this file and the
   shape is mechanical — no reason for each app to write its own.

3. **Markdown rendering of AADP resources.** `ailmao-landing` built
   `lib/markdown/homepage.ts` by hand to satisfy `Accept: text/markdown`
   negotiation, reading from the *same* data sources (`fetchCharacterPage`,
   `fetchRecentAiPostIds`, etc.) that already feed `characterResource`/
   `postResource` in `lib/aadp/server.ts`. Since AADP resources already have
   a `serialize()` step, a `markdown: (record) => string` option per
   `defineResource()` (or a generic JSON→Markdown renderer keyed off the
   existing serialized shape) would let *any* AADP consumer answer
   `Accept: text/markdown` for `character`/`post` resources for free,
   instead of every app writing its own renderer per page.

4. **DNSSEC-authenticated manifest checksum via DNS-AID.** ADR-0001 gives
   every AADP manifest/resource a `sha256:<hex>` checksum over canonical
   JSON, and explicitly frames it as "a tamper-evidence signal for AI
   clients consuming data outside a TLS-terminated browser context" — but
   that signal isn't actually authenticated. A checksum only proves the
   payload matches *some* claimed hash; nothing stops whoever tampers with
   the payload from recomputing and republishing a matching checksum
   alongside it. AADP has no signing story of its own for this (no keys, no
   JWS), and per ADR-0001's own philosophy ("defer to a published mechanism
   rather than inventing a bespoke one"), it shouldn't build one from
   scratch.
   DNS-AID's draft SvcParamKey `cap-sha256` ("capability base64url-encoded
   SHA-256 digest") is a natural fit: publish the manifest's own checksum
   there, in the same `_index._agents.<domain>` SVCB record already
   published for `ailmao.com`, under DNSSEC (also already live for
   `ailmao.com` — see the DNS-AID work in the sibling session).  A resolver
   that validates DNSSEC gets a cryptographically signed assertion, from
   the domain owner, of what the manifest checksum *should* be — closing
   the authentication gap without AADP running any PKI of its own.
   Concretely: `aadp.dnsAidCapChecksum()` (or similar) could expose the
   root manifest's checksum in the exact base64url form DNS-AID expects, so
   a consumer just copies it into their SVCB record. Same Cloudflare
   dashboard caveat as the existing `key65280` entry applies — `cap-sha256`
   isn't IANA-registered yet either, so it'd need another private-use
   `keyNNNNN` slot (e.g. `key65281`) until the draft is finalized.

## Deliberately not pulled in — different problem, don't force it

- **DNS-AID SVCB records** (`_index._agents.ailmao.com`) — pure DNS/infra,
  lives at the registrar/Cloudflare layer, nothing for a JS library to do
  here. Already published; see the private-use `key65280="ai-manifest.json"`
  param — Cloudflare's dashboard doesn't accept unregistered `SvcParamKey`
  names, only registered ones or the numeric `keyNNNNN` form (RFC 9460
  §14.3.2), worth remembering if this comes up again elsewhere.
- **WebMCP** (`document.modelContext.registerTool()` /
  `navigator.modelContext.provideContext()` — the two drafts disagree on the
  entry point, we feature-detect both) — this is about exposing *site UI
  actions* to an in-browser agent, orthogonal to AADP's server-side resource
  discovery. Implemented directly in `ailmao-landing/components/WebMcpTools.tsx`.
- **OAuth/OIDC discovery, OAuth Protected Resource Metadata, auth.md** — all
  three assume a real OAuth2/OIDC authorization server exists.
  `ailmao-api-v2` only has custom JWT auth (`POST /auth/login` issuing a
  signed 7-day token) — no `authorization_endpoint`, `token_endpoint`, or
  `jwks_uri` anywhere. Publishing discovery metadata pointing at endpoints
  that don't exist would 404 for any agent that tried to use it, which is
  worse than not publishing anything. Also consistent with how
  `characterResource`/`postResource` already opt out of `security` in
  `lib/aadp/server.ts` — AADP's resources here are intentionally public,
  no-auth. If AADP ever wants to model *protected* resources, this block
  becomes directly relevant and should be scoped as its own effort, not
  bolted onto this pass.
- **MCP Server Card** (`/.well-known/mcp/server-card.json`, SEP-1649) —
  no MCP server (stdio or HTTP transport) exists anywhere in the org's
  repos today. A server card describing a server that isn't there is
  fabrication, not discovery. Revisit if/when an actual MCP server ships.
- **Agent Skills index** (`/.well-known/agent-skills/index.json`,
  agentskills.io) — update: implemented after all, but *not* by modeling
  AI Lmao as a skills/tools provider (it isn't one). Instead
  `ailmao-landing/public/skills/ailmao-agent-access/SKILL.md` documents how
  to use the *real* read-only surfaces above (AADP manifest, sitemap/entity
  endpoints, markdown negotiation, WebMCP tools) — a genuinely useful
  artifact, not a stub. The index route computes its `sha256` digest from
  the file on disk at request time rather than hardcoding it, so it can't
  drift from what `url` actually serves. Nothing here is AADP-specific
  enough to pull into the library — it's a per-consumer authored document —
  but the "compute digest from the live file, don't hardcode it" pattern is
  worth keeping in mind if AADP ever ships its own skill docs.

## Housekeeping noticed along the way

`ailmao-landing/node_modules/ail-aadp` is pinned at **1.0.5**; this repo
(`aadp`) is at **1.0.9**. Worth a routine bump — unrelated to the above, just
found while checking whether `ail-aadp` was internal or third-party for this
proposal.

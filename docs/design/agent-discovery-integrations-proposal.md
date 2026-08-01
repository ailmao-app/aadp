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
  agentskills.io) — models a site as a provider of reusable "skills"/tool
  bundles, which isn't what AI Lmao is. Forcing an entry here would be an
  empty or misleading stub.

## Housekeeping noticed along the way

`ailmao-landing/node_modules/ail-aadp` is pinned at **1.0.5**; this repo
(`aadp`) is at **1.0.9**. Worth a routine bump — unrelated to the above, just
found while checking whether `ail-aadp` was internal or third-party for this
proposal.

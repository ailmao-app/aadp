# Proposal: integrating agent-discovery mechanisms adjacent to AADP

## Document metadata

| Field | Value |
|---|---|
| Status | Proposed |
| Audience | AADP maintainers, and implementers and reviewers of discovery integrations |
| Scope | Agent-discovery standards and mechanisms that sit next to AADP but are not part of AADP core by default |
| Normativity | Informational; changes no released specification or JSON Schema |
| Origin | Integrating `ailmao-landing` with an external agent-readiness scanner |

## Abstract

Connecting `ailmao-landing`, AADP's reference implementation, to an external
agent-readiness scanner forced the project to handle several mechanisms that are
not part of AADP v1.0: RFC 8288 Link headers, `Accept: text/markdown`, RFC 9727
API Catalog, DNS-AID SVCB, WebMCP, MCP Server Card, OAuth/OIDC discovery and
`auth.md`.

Some of these repeat across every AADP publisher and could move into
`ail-aadp`; others solve a different problem and must stay outside core. DNS-AID
in particular is an adjacent discovery/trust layer: the DNS operator publishes
the record, authoritative DNS signs the RRset with DNSSEC, and the client or a
validating resolver verifies it before handing the discovered endpoint or
descriptor to an AADP client. This memo draws that boundary and points to
focused proposals wherever an item needs a new wire contract or new semantics.

## 1. Status of this memo

This memo follows the [AADP documentation conventions](../document-conventions.md).
The examples, helper API names and fields mentioned here are all non-normative
while the memo is Proposed.

This memo MUST NOT be used to claim that a capability is part of AADP, or has
been assigned a version, merely because it appears in this document. Any wire
contract change goes through an ADR, the specification and the schemas, under
the compatibility policy.

## 2. Scope and non-goals

This memo:

- classifies which integrations could be reused inside the package;
- records which integrations belong to the application, the browser or the
  infrastructure;
- discourages publishers from fabricating discovery metadata purely to raise a
  scanner score;
- provides input for focused ADRs and proposals.

This memo does not:

- turn AADP into OpenAPI, an OAuth/OIDC server or an MCP runtime;
- turn AADP core or its client into a DNS resolver, DNSSEC validator or DNS-AID
  client;
- require publishers to support every standard a scanner knows about;
- change the released v1.0 schemas;
- treat a scanner score as protocol conformance.

## 3. Parts that could move into `ail-aadp`

### 3.1 A `Link` header helper

`ailmao-landing/middleware.ts` currently has to declare this itself:

```text
</.well-known/ai-manifest.json>; rel="api-catalog"
```

Every AADP publisher needs the same value, and the well-known path is already
derivable from the config passed to `defineAADP()`. The package SHOULD provide a
helper such as `aadp.linkHeader()`, or export the well-known path constant from
`ail-aadp/server`, so publishers do not repeat the string and risk typos.

The final helper name should follow the package's public API conventions.

### 3.2 Generating an RFC 9727 API Catalog

`ailmao-landing` serves `/.well-known/api-catalog` itself, with the media type
`application/linkset+json`. The catalog currently has exactly one honest entry:
a `service-desc` pointing at the AADP manifest. The `links`, `policies` and
`resources` fields of `defineAADP()` do not map directly or completely onto
`service-doc` or `status`.

The package could:

1. generate the `service-desc` entry for the AADP manifest;
2. generate `status` only when the publisher configures a real health endpoint;
3. provide a helper such as `aadp.buildApiCatalogLinkset()` instead of making
   every application rewrite the same Linkset shape.

An optional field such as `healthCheck` should only be added once the right
layer and the compatibility impact are settled; a publisher MUST NOT advertise
an endpoint that is not deployed.

### 3.3 Markdown rendering for AADP resources

`ailmao-landing/lib/markdown/homepage.ts` was written specifically to serve
`Accept: text/markdown`, but it reads from the same data source that already
feeds `characterResource` and `postResource`.

An AADP resource already has a `serialize()` step. The package could explore two
directions:

- a `markdown: (record) => string` callback in `defineResource()`;
- a generic JSON-to-Markdown renderer over the serialized shape.

The callback gives publishers control of the content but widens the public
server API; the generic renderer reduces code but makes stable semantics and
presentation hard to guarantee. This needs its own design memo before either is
chosen.

## 4. Parts that must stay outside AADP core

### 4.1 DNS-AID discovery, DNSSEC validation and descriptor digests

DNS-AID and AADP solve two different problems. DNS-AID discovers agent/service
endpoints and their connection metadata over DNS; AADP discovers, lists and
retrieves read-only application data over HTTP. The `_index._agents.<domain>`
record belongs to the registrar/DNS provider. Authoritative DNS produces the
DNSSEC signature; the client or a validating resolver verifies it and applies
trust policy. No link in that chain is the responsibility of AADP core or its
runtime.

ADR-0001 specifies a `sha256:<hex>` checksum over `entity.data` and
`sitemap.items` for caching, deduplication and change detection. A checksum
self-published alongside its payload is not a signature, does not prove origin,
and does not define a checksum for the AADP manifest as a whole. DNS-AID's
`cap-sha256` therefore MUST NOT be called an "AADP manifest checksum", nor
derived from an existing AADP checksum, without a dedicated integration profile.

If a deployment wants to use an AADP manifest as a DNS-AID capability
descriptor, an independent profile/adapter must settle at least:

- the locator, media type and accepted AADP versions;
- the exact set of hashed fields and the canonicalization;
- client-side DNSSEC validation, redirect/origin and URL/SSRF policy;
- behaviour on a digest mismatch, an unsigned record, or an unsupported draft
  key;
- conformance vectors spanning the DNS publisher, the resolver and the AADP
  consumer.

Such a profile may depend on both DNS-AID and AADP, but `ail-aadp` MUST NOT
depend on it in return. Do not add `aadp.dnsAidCapChecksum()` to the public API.
If a production use case and interoperability are demonstrated, the
implementation SHOULD live in a package such as `aadp-dnsaid-profile`, or in an
application adapter, with its own lifecycle and version.

For `ailmao.com`, the Cloudflare dashboard rejects unregistered SvcParamKey
names and needs a numeric `keyNNNNN` from the private-use range until the draft
stabilises. That is an infrastructure runbook, not AADP wire behaviour.
`cap-sha256` and private-use numeric keys remain draft/experimental mechanisms,
not AADP allocations.

### 4.2 WebMCP

`document.modelContext.registerTool()` and the legacy
`navigator.modelContext.provideContext()` expose UI actions to in-browser
agents. That is a browser interaction API, distinct from AADP's server-side
resource discovery.

A WebMCP implementation belongs in the corresponding application component —
for example `ailmao-landing/components/WebMcpTools.tsx` — not in AADP core.

### 4.3 OAuth/OIDC discovery, OAuth Protected Resource Metadata and `auth.md`

These discovery documents apply only when a real authorization server, protected
resource or agent registration flow exists. AADP v1.0 can already describe the
`none`, `api_key` and `oauth2` security schemes, so the gap is not "AADP does
not know about protected resources". The real gaps are:

- an application-level profile for declaring that this is a content site;
- default access, with resource/interface overrides;
- clear semantics so a scanner can distinguish `not_applicable` from `missing`;
- a runtime that preserves public cache semantics when the referenced scheme has
  `type: "none"`.

The detailed design lives in
[the content-site and public-access discovery proposal](../vi/design/content-site-access-discovery-proposal.md)
(an internal Vietnamese memo).

`ailmao-api-v2` currently uses a custom JWT from `POST /auth/login`, with no
complete `authorization_endpoint`, `token_endpoint`, `jwks_uri` or agent
registration contract. A publisher MUST NOT create OAuth/OIDC metadata pointing
at endpoints that do not exist just to satisfy a scanner.

### 4.4 MCP Server Card

An MCP Server Card is only appropriate when a real MCP server and transport
endpoint exist. WebMCP is not a remote MCP server. A card describing a server
that does not exist is fabrication, not discovery.

Revisit this item when the organisation actually deploys an MCP server.

### 4.5 The Agent Skills index

`/.well-known/agent-skills/index.json` was implemented in a way that does NOT
describe AI Lmao as a skills/tools provider. Instead,
`ailmao-landing/public/skills/ailmao-agent-access/SKILL.md` documents how to use
the real read-only surfaces: the AADP manifest, the sitemap/entity endpoints,
Markdown negotiation and the WebMCP tools.

The index route computes the `sha256` from the file it actually serves rather
than hardcoding it, so the digest cannot drift from the content at `url`. This
is a per-application authored document; nothing about it is AADP-specific enough
to move into core yet. If AADP later publishes a skill of its own, the "compute
the digest from the live file" pattern SHOULD be kept.

## 5. How the proposals relate

```text
Agent-discovery integrations proposal (this memo)
├── helper/library candidates
│   ├── Link header
│   ├── RFC 9727 API Catalog
│   └── Markdown rendering
├── external integration profile candidates
│   └── DNS-AID resolver → descriptor verification → AADP client
└── focused design proposals
    └── Content Site + public access discovery
```

This memo is an umbrella inventory. The Content Site proposal is a focused
design memo that may lead to an ADR and a new protocol version. Wire shape,
validation and migration content MUST live in that focused proposal and MUST NOT
be duplicated here.

## 6. Suggested way forward

1. Split each AADP helper candidate into an issue/design item with acceptance
   criteria.
2. Fix the `security_schemes.type: "none"` semantics before adding new fields.
3. Open a separate ADR for the application profile and default access.
4. Remove the DNS-AID checksum helper from the `ail-aadp` roadmap and public
   API.
5. Open a DNS-AID integration profile only once there is a real deployment,
   client-side DNSSEC validation, a canonical descriptor contract and
   cross-implementation vectors.
6. Do not fold DNS mutation, a DNSSEC resolver, a WebMCP runtime or an MCP
   server implementation into core.
7. Publish adjacent discovery metadata only once the real capability is
   deployed.

## 7. Housekeeping

When this memo was first written, `ailmao-landing/node_modules/ail-aadp` was at
version `1.0.5` while the `aadp` repository was already at `1.0.9`. Upgrading
that dependency is a separate maintenance task and should not be folded into a
protocol proposal.

## 8. Security considerations

- Helpers MUST NOT create placeholder endpoints or live credentials.
- DNSSEC authenticates an RRset published by the domain owner; it does not by
  itself prove that the capability descriptor's contents are truthful, or that
  an agent will behave as its metadata claims.
- A client must fail closed, or report an unverifiable state as the profile
  requires, when DNSSEC validation or digest verification does not complete; it
  must never quietly promote an AADP self-hash into an authenticity signal.
- A client must still apply URL/redirect/SSRF policy to every discovered URL.
- A scanner score is not a security proof or a protocol conformance result.
- A publisher cannot turn a protected resource into a public one with incorrect
  metadata; enforcement at the resource server remains the security boundary.

## 9. Compatibility and versioning

- A helper that only renders a representation of an existing contract can be a
  package-level feature.
- A new manifest field requires a new protocol/schema version under ADR-0004.
- The v1.0 schemas MUST NOT be edited to accommodate a new application profile
  or default access.
- A DNS-AID integration profile must version independently and must not change
  AADP conformance.
- A draft DNS-AID key or MCP proposal MUST NOT be presented as a finalised
  standard.

## 10. IANA Considerations

This document has no IANA actions.

## 11. References

### AADP sources

- [AADP documentation conventions](../document-conventions.md)
- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [ADR-0001: Checksum algorithm](../adr/0001-checksum-algorithm.md)
- [ADR-0004: Backward compatibility](../adr/0004-backward-compatibility.md)
- [ADR-0005: Manifest v1 discovery](../adr/0005-manifest-v1-discovery.md)
- [Content-site and public-access discovery proposal](../vi/design/content-site-access-discovery-proposal.md)
  (internal Vietnamese memo)

### External standards

- RFC 8288, “Web Linking”.
- RFC 4033, “DNS Security Introduction and Requirements”.
- [`draft-mozleywilliams-dnsop-dnsaid`](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/),
  “DNS for AI Discovery” (work in progress).
- RFC 8414, “OAuth 2.0 Authorization Server Metadata”.
- RFC 9460, “Service Binding and Parameter Specification via the DNS”.
- RFC 9727, “api-catalog: A Well-Known URI and Link Relation”.
- RFC 9728, “OAuth 2.0 Protected Resource Metadata”.

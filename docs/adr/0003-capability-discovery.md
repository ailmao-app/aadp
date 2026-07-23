# ADR-0003: Capability discovery

## Status

Accepted — AADP v0.1

## Context

Not every AADP server exposes the same resource types, and future
versions may add optional capabilities (delta sync, search, auth scopes —
see the v0.5/v1.0 roadmap in `AADP_Draft.md`). Clients need a way to know
what a given server supports before attempting an operation, without
hardcoding per-deployment assumptions or trial-and-erroring endpoints.

## Decision

- The manifest (`/.well-known/ai-manifest.json`) is the single capability
  discovery surface. It MUST list `aadp_version` and MAY list a
  `capabilities` array of string tokens.
- v0.1 defines no optional capability tokens — a v0.1 server that
  publishes a manifest is assumed to support manifest → sitemap index →
  sitemap → entity, read-only, no auth. `capabilities` is reserved for
  future versions (e.g. `"delta-sync"`, `"search"`) and MUST be treated
  as an open, extensible set — unknown tokens MUST be ignored by clients,
  not treated as errors.
- Resource types actually served are enumerated in the sitemap index
  (`sitemaps[].type`), not the manifest. A client MUST NOT assume a type
  exists until it sees it in the sitemap index.
- Vendor/implementation-specific extensions that are not yet
  standardized MUST be namespaced under `x_`-prefixed fields anywhere in
  the manifest, sitemap, or entity envelope, per the extension-point rule
  in the specification. Core schemas explicitly allow but do not validate
  the shape of `x_*` fields.

## Consequences

- Adding a new optional protocol capability in a future minor version is
  additive (new capability token + new manifest field), not breaking.
- Server implementers MUST NOT invent ad-hoc top-level manifest fields for
  vendor needs; they MUST use `x_` extension fields instead, keeping the
  manifest schema stable for all consumers.

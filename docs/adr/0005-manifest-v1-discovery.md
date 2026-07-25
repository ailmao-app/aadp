# ADR-0005: Manifest v1.0 Application Discovery and Canonical URL

## Status

Accepted — AADP v1.0.

Vietnamese edition: [`../vi/adr/0005-manifest-v1-discovery.md`](../vi/adr/0005-manifest-v1-discovery.md).

## Context

The v0.1 manifest only exposed locale metadata, a sitemap index URL, an optional entity construction prefix, and open capability tokens. That shape could not clearly describe application identity, human-facing links, structured modules, non-AADP interfaces, security metadata, public policies, or publisher preferences.

AADP had no production v0.1 consumer when the v1.0 contract was designed. Preserving the v0.1 manifest shape would have forced ambiguous compatibility fields into the first stable protocol.

## Decision

### Canonical discovery

Servers publish the manifest at:

```text
/.well-known/ai-manifest.json
```

The URL returns the v1.0 manifest directly. AADP v1.0 does not define a version index, content negotiation, dual-manifest serving, or a migration runtime.

### Manifest role

The manifest is an application discovery document with these sections:

- `application`
- `links`
- `discovery`
- `modules`
- `resources`
- `interfaces`
- `security_schemes`
- `policies`
- `usage_guidance`

Root required fields are `aadp_version`, `application`, `discovery`, and `policies`. Optional collections and maps are omitted when empty.

### Resource authority

`discovery.sitemap_index` is the sole authoritative entry point for resource enumeration. The optional `resources` section adds metadata keyed by resource type and does not duplicate sitemap URLs.

### Localization

Entity retrieval locale remains part of the core entity request behavior. Language fields under `usage_guidance` are preferences for AI output only and must not control entity locale selection.

### Security schemes

The manifest may describe public metadata for:

- no authentication;
- API keys, including their location and name;
- OAuth 2, including public authorization metadata.

The manifest never contains live credentials. Every resource or interface security reference must resolve to a declared scheme.

### Untrusted guidance

`usage_guidance` is untrusted publisher preference data. A client must not treat it as a system or developer instruction, execute actions because of it, or allow it to override source facts.

## Consequences

- Manifest v1.0 is not schema-compatible with the v0.1 manifest.
- Clients select parsers and schemas through `aadp_version`.
- The well-known URL has one deterministic response shape.
- Applications can describe resources and interfaces without mixing them into open capability strings.
- Sitemap and entity envelopes remain structurally consistent with v0.1 apart from their version value and conventional base path.
- Schema validation handles wire shape; semantic validation handles cross-reference integrity and uniqueness.
- Released v1.0 schemas are immutable under ADR-0004.

## References

- [Manifest v1.0 design](../MANIFEST_V1.0_DESIGN.md)
- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [Backward compatibility policy](0004-backward-compatibility.md)

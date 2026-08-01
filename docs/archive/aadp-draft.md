# AI Application Discovery Protocol — Historical Draft

| Field | Value |
|---|---|
| Document type | Historical design note |
| Status | Superseded by the versioned specifications |
| Audience | Maintainers researching protocol history |
| Normative authority | None |
| Vietnamese internal edition | [`../vi/archive/aadp-draft.md`](../vi/archive/aadp-draft.md) |

## Abstract

This document preserves the original direction of AADP. It MUST NOT be used as
an implementation contract; implementers use the versioned specifications and
schemas.

This document records the original direction of AADP: a read-only, JSON-native protocol that allows an AI client to discover and retrieve structured application data without crawling HTML.

The draft introduced the core traversal:

```text
well-known manifest
        ↓
   sitemap index
        ↓
 per-type sitemap
        ↓
      entity
```

It also established the principles that remain part of the protocol:

- Applications explicitly choose which public resources to expose.
- Sitemap entries enumerate canonical entity identifiers and URLs.
- Entity payloads are application-defined but use a stable protocol envelope.
- Checksums and cache validators support efficient synchronization.
- The core protocol is read-only and does not define authentication or mutation workflows.
- Application-specific fields and business rules do not belong in AADP core.

Use the normative documents for implementation:

- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [AADP v1.0 implementation guide](../guides/implementation-guide-v1.0.md)
- [Manifest v1.0 design](../design/manifest-v1.0-design.md)

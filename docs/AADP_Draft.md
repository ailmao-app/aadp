# AI Application Discovery Protocol — Historical Draft

> Status: Superseded by the versioned specifications.
>
> Vietnamese edition: [`vi/AADP_Draft.md`](vi/AADP_Draft.md).

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

- [AADP v1.0 specification](../spec/v1.0/specification.md)
- [AADP v1.0 implementation guide](implementation-guide-v1.0.md)
- [Manifest v1.0 design](MANIFEST_V1.0_DESIGN.md)

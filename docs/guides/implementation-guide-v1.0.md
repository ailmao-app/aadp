# AADP v1.0 — Implementation Guide

| Field | Value |
|---|---|
| Document type | Implementation guide |
| Status | Active |
| Audience | AADP v1.0 server implementers |
| Normative source | [AADP v1.0 specification](../../spec/v1.0/specification.md) |

## Abstract

This guide summarizes the operational steps for an AADP v1.0 server. It is
informational and does not replace the specification or schemas.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

For anyone implementing an AADP v1.0 **server** (a future adapter, not
just this repo's mock server). v1.0 is a clean break from v0.1 — do not
dual-publish or attempt content negotiation between the two
(`docs/records/implementation-record-v1.0.md` §1).

## Minimal checklist

1. Publish `/.well-known/ai-manifest.json` matching
   `schemas/v1.0/manifest.schema.json`. Required top-level fields:
   `aadp_version` (constant `"1.0"`), `application`, `discovery`,
   `policies`. Everything else (`links`, `modules`, `resources`,
   `interfaces`, `security_schemes`, `usage_guidance`) is optional — only
   publish it once the thing it describes is actually deployed and has
   passed conformance (`docs/records/implementation-record-v1.0.md` §2).
2. Publish a sitemap index and one sitemap per resource type you expose,
   matching `schemas/v1.0/sitemap-index.schema.json` and
   `schemas/v1.0/sitemap.schema.json`. `discovery.sitemap_index` is the
   authoritative entry point for enumeration — a client is never expected
   to guess it. `sitemap.items[].url` is the authoritative entity URL.
3. Publish entities matching `schemas/v1.0/entity.schema.json`, with
   `data` containing only allow-listed fields (see
   `docs/guides/security-considerations.md` §2).
4. Compute `checksum` from canonical JSON — `data` for entities, `items`
   for sitemaps, `sitemaps` for the sitemap index. Use
   `src/canonical-json/checksum.ts` directly, or reimplement spec v1.0 §6
   exactly (RFC 8785 key ordering, no whitespace, UTF-8). Sort object keys
   by **UTF-16 code unit value**, not UTF-8 byte order (see
   `docs/adr/0001-checksum-algorithm.md`).
5. Set `ETag`, `Last-Modified`, `Cache-Control` on sitemap index, sitemap
   and entity responses (not manifest, not error responses); honor
   `If-None-Match` with `304` on those three kinds, using weak comparison
   (see `docs/adr/0002-cache-semantics.md`).
6. Cap sitemap page size at 100 and never emit a cursor cycle.
7. If any `resources[].security` or `interfaces[].security` references a
   scheme, `security_schemes` MUST be present and MUST define it. Do not
   publish `api_key` or `oauth2` schemes until the metadata is complete
   enough for a client to actually use the flow — an incomplete scheme is
   worse than `type: "none"`.
8. Treat `usage_guidance` as a publisher **preference**, never as an
   instruction to the reader. Do not phrase it as a command to an AI
   system — the semantic validator flags (but does not block) text that
   reads like one, and any conformant client MUST still treat the field as
   untrusted data regardless of that warning (spec v1.0 §3.1.9).
9. On error, return the error envelope (`schemas/v1.0/error.schema.json`)
   with an appropriate standard `code`.
10. Run `aadp-validate <kind> <url-or-file> --version 1.0` against individual
    documents, then run the public conformance CLI against the deployment:

    ```sh
    npx aadp-conformance https://your-domain.example
    ```

    Use `--json --output conformance.json` in CI. Repository contributors MAY
    run `npm test` for the bundled mock-server and negative-policy fixtures;
    consumers do not need the source tree or Vitest.

## What NOT to do

- Do not add fields outside the schema without an `x_` prefix.
- Do not serve `/ai/v1.0/*` payloads that fail their schema — that is a
  release-gate violation, not a warning.
- Do not advertise an MCP/GraphQL/WebSocket/OAuth interface that is not
  actually deployed (`docs/records/implementation-record-v1.0.md` §"Application adapters").
- Do not treat this guide as normative — the specification
  (`spec/v1.0/specification.md`) is the source of truth; this document is
  a practical companion.

## Using the reference client

```ts
import { v1 } from "ail-aadp/client"; // or "ail-aadp/client/v1.0" directly

for await (const entity of v1.discoverAllEntities("https://your-domain.example")) {
  console.log(entity.id, entity.checksum);
}
```

This performs the full manifest → sitemap index → sitemap → entity walk,
following pagination automatically, detecting cursor cycles, and — unlike
the v0.1 client — validating every document against its JSON Schema (and
the manifest against the Phase-3 semantic rules) before any URL it
contains is dereferenced.

### URL policy, timeouts and size limits

By default the client blocks private, loopback and link-local
destinations (`createStrictUrlPolicy()`), caps response size at 2 MiB,
times out at 10s, and follows at most 5 redirects. Every call accepts an
options object to override these:

```ts
import { v1 } from "ail-aadp/client";

const manifest = await v1.discover("https://your-domain.example", {
  timeoutMs: 5000,
  maxResponseBytes: 512 * 1024,
  maxRedirects: 3,
});
```

Only pass `urlPolicy: v1.createPermissiveUrlPolicy()` for tests or an
intentionally trusted local/offline deployment — never for a crawler
processing server-supplied URLs from an untrusted origin.

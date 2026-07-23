# AADP v0.1 — Implementation Guide

For anyone implementing an AADP v0.1 **server** (a future adapter, not
just this repo's mock server).

## Minimal checklist

1. Publish `/.well-known/ai-manifest.json` matching
   `schemas/v0.1/manifest.schema.json`.
2. Publish a sitemap index and one sitemap per resource type you expose,
   matching `schemas/v0.1/sitemap-index.schema.json` and
   `schemas/v0.1/sitemap.schema.json`.
3. Publish entities matching `schemas/v0.1/entity.schema.json`, with
   `data` containing only allow-listed fields (see
   `docs/security-considerations.md` §2).
4. Compute `checksum` from canonical JSON — `data` for entities, `items`
   for sitemaps, `sitemaps` for the sitemap index. Use
   `src/canonical-json/checksum.ts` directly, or reimplement spec §6
   exactly (RFC 8785 key ordering, no whitespace, UTF-8). Sort object
   keys by **UTF-16 code unit value**, not UTF-8 byte order — they
   diverge for supplementary-plane characters (see
   `docs/adr/0001-checksum-algorithm.md`).
5. Set `ETag`, `Last-Modified`, `Cache-Control` on sitemap index, sitemap
   and entity responses (not manifest, not error responses — see spec §7);
   honor `If-None-Match` with `304` on those three kinds.
6. Cap sitemap page size at 100 and never emit a cursor cycle.
7. On error, return the error envelope
   (`schemas/v0.1/error.schema.json`) with an appropriate standard `code`
   (spec §9).
8. Run `npm run validate -- <kind> <url-or-file>` against every live
   endpoint, and run the conformance suite against your deployment before
   claiming v0.1 conformance:

   ```sh
   AADP_BASE_URL=https://your-domain.example \
     npx vitest run tests/conformance/conformance.test.ts
   ```

   Without `AADP_BASE_URL`, that same command runs against this repo's
   own in-process mock server (self-test mode) instead.

## What NOT to do

- Do not add fields outside the schema without an `x_` prefix.
- Do not serve `/ai/v0.1/*` payloads that fail their schema — that is a
  release-gate violation, not a warning.
- Do not treat this guide as normative — the specification
  (`spec/v0.1/specification.md`) is the source of truth; this document is
  a practical companion.

## Using the reference client

```ts
import { discoverAllEntities } from "ail-aadp"; // or "ail-aadp/client" for a narrower import

for await (const entity of discoverAllEntities("https://your-domain.example")) {
  console.log(entity.id, entity.checksum);
}
```

This performs the full manifest → sitemap index → sitemap → entity walk
described in spec §3, following pagination automatically and detecting
cursor cycles.

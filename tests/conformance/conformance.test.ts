import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle } from "./mock-server.js";
import {
  discover,
  fetchSitemapIndex,
  fetchSitemap,
  fetchEntity,
  iterateSitemap,
  discoverAllEntities,
  AadpRequestError,
  createPermissiveUrlPolicy,
  type ClientOptions,
} from "../../src/client/index.js";
import {
  validateManifest,
  validateSitemapIndex,
  validateSitemap,
  validateEntity,
  validateError,
} from "../../src/validator/index.js";
import { checksumOf } from "../../src/canonical-json/checksum.js";

/**
 * AADP v0.1 conformance suite. This file MUST be runnable, unmodified,
 * against any server claiming v0.1 conformance — not just this repo's
 * own mock server (spec §11). It only asserts invariants that hold for
 * *any* conformant server; assertions specific to the shape of our own
 * fixture dataset live in `mock-server.test.ts` instead.
 *
 * Usage against a live deployment:
 *   AADP_BASE_URL=https://your-domain.example npx vitest run tests/conformance/conformance.test.ts
 *
 * Without AADP_BASE_URL, an in-process mock server (self-test mode) is
 * started and torn down automatically.
 */

let server: MockServerHandle | undefined;
let baseUrl: string;

// The self-test mock server binds to 127.0.0.1, which the default strict
// UrlPolicy blocks as a loopback address; a real AADP_BASE_URL deployment
// is unaffected by the permissive policy since it only widens what is
// allowed, never narrows it.
const PERMISSIVE: ClientOptions = { urlPolicy: createPermissiveUrlPolicy() };

beforeAll(async () => {
  const externalBaseUrl = process.env.AADP_BASE_URL;
  if (externalBaseUrl) {
    baseUrl = externalBaseUrl.replace(/\/$/, "");
    return;
  }
  server = await startMockServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server?.close();
});

describe("discovery flow", () => {
  it("manifest -> sitemap index -> sitemap -> entity all schema-validate, with checksums recomputed (not just shape-checked)", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    expect(validateManifest(manifest).valid).toBe(true);

    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    expect(validateSitemapIndex(index).valid).toBe(true);
    expect(index.sitemaps.length).toBeGreaterThan(0);
    // §6: checksum MUST be the actual hash of the canonical `sitemaps`
    // payload, not merely a well-formed sha256:<hex> string.
    expect(index.checksum).toBe(checksumOf(index.sitemaps));

    const sitemapRef = index.sitemaps[0];
    const sitemap = await fetchSitemap(sitemapRef.url, undefined, PERMISSIVE);
    expect(validateSitemap(sitemap).valid).toBe(true);
    expect(sitemap.checksum).toBe(checksumOf(sitemap.items));

    if (sitemap.items.length === 0) return; // empty server is technically conformant
    const item = sitemap.items[0];
    // §2/§3.3-3.4: a sitemap item's canonical ID MUST be namespaced under
    // the sitemap's own `type`, and an entity fetched from that item MUST
    // preserve both id and type unchanged — otherwise a client indexes
    // the resource under the wrong namespace.
    expect(item.id.startsWith(`${sitemap.type}:`)).toBe(true);

    const entity = await fetchEntity(item.url, PERMISSIVE);
    expect(validateEntity(entity).valid).toBe(true);
    expect(entity.id).toBe(item.id);
    expect(entity.type).toBe(sitemap.type);
    expect(entity.checksum).toBe(item.checksum);
    // §6: entity.checksum MUST be the actual hash of canonical `data`.
    expect(entity.checksum).toBe(checksumOf(entity.data));
  });

  it("full discoverAllEntities walk yields every published entity exactly once, all schema-valid and checksum-correct", async () => {
    const seen = new Set<string>();
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    const typeBySitemapUrl = new Map(index.sitemaps.map((s) => [s.url, s.type]));

    for (const sitemapRef of index.sitemaps) {
      for await (const item of iterateSitemap(sitemapRef.url, PERMISSIVE)) {
        expect(item.id.startsWith(`${typeBySitemapUrl.get(sitemapRef.url)}:`)).toBe(true);
      }
    }

    for await (const entity of discoverAllEntities(baseUrl, PERMISSIVE)) {
      expect(validateEntity(entity).valid).toBe(true);
      expect(seen.has(entity.id)).toBe(false);
      seen.add(entity.id);
      expect(entity.checksum).toBe(checksumOf(entity.data));
    }
    // No fixed count asserted here — a conformant server may publish any
    // number of entities, including zero. Exact-count regression coverage
    // for this repo's own fixtures lives in mock-server.test.ts.
  });
});

describe("pagination", () => {
  it("caps page size, terminates cursor.next at null, and never repeats an id — for every published sitemap type, paginated or not", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);

    for (const sitemapRef of index.sitemaps) {
      const first = await fetchSitemap(sitemapRef.url, undefined, PERMISSIVE);
      expect(first.items.length).toBeLessThanOrEqual(100);
      // cursor is OPTIONAL (spec §5, schema does not require it): a server
      // with <=100 items MAY return a single unpaginated page and omit
      // cursor entirely. Only when cursor IS present must next be string|null.
      if (first.cursor !== undefined) {
        expect(["string", "object"]).toContain(typeof first.cursor.next); // string, or null (object)
      }

      const allIds: string[] = [];
      for await (const item of iterateSitemap(sitemapRef.url, PERMISSIVE)) {
        allIds.push(item.id);
      }
      expect(new Set(allIds).size).toBe(allIds.length); // no duplicates/no cycle
    }
  });
});

describe("cache and checksum stability", () => {
  it("entity checksum is stable across repeated fetches", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    if (index.sitemaps.length === 0) return;
    const sitemap = await fetchSitemap(index.sitemaps[0].url, undefined, PERMISSIVE);
    if (sitemap.items.length === 0) return;
    const itemUrl = sitemap.items[0].url;

    const first = await fetchEntity(itemUrl, PERMISSIVE);
    const second = await fetchEntity(itemUrl, PERMISSIVE);
    expect(first.checksum).toBe(second.checksum);
  });

  it.each(["sitemap-index", "sitemap", "entity"] as const)(
    "%s: ETag equals the declared checksum, Last-Modified is a valid date, and If-None-Match yields an empty 304",
    async (kind) => {
      const manifest = await discover(baseUrl, PERMISSIVE);
      let targetUrl: string;
      let declaredChecksum: string;
      let declaredTimestamp: string;
      if (kind === "sitemap-index") {
        const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
        targetUrl = manifest.sitemap_index;
        declaredChecksum = index.checksum;
        declaredTimestamp = index.generated_at;
      } else {
        const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
        if (index.sitemaps.length === 0) return;
        if (kind === "sitemap") {
          const sitemap = await fetchSitemap(index.sitemaps[0].url, undefined, PERMISSIVE);
          targetUrl = index.sitemaps[0].url;
          declaredChecksum = sitemap.checksum;
          declaredTimestamp = sitemap.generated_at;
        } else {
          const sitemap = await fetchSitemap(index.sitemaps[0].url, undefined, PERMISSIVE);
          if (sitemap.items.length === 0) return;
          const entity = await fetchEntity(sitemap.items[0].url, PERMISSIVE);
          targetUrl = sitemap.items[0].url;
          declaredChecksum = entity.checksum;
          declaredTimestamp = entity.updated_at;
        }
      }

      const res1 = await fetch(targetUrl);
      const etag = res1.headers.get("etag");
      // §7/ADR-0002: ETag MUST be the resource's own declared checksum,
      // quoted — not merely present. An intermediary (CDN, compression
      // proxy) MAY add a weak-validator "W/" prefix in transit (RFC 9110
      // §8.8.1 — e.g. Cloudflare does this when it gzip/brotli-compresses
      // the response, since the original strong validator no longer
      // matches the on-wire bytes exactly). Conditional GET uses weak
      // comparison for GET/HEAD regardless, so this is not a protocol
      // violation — strip an optional "W/" before comparing.
      const etagValue = etag?.startsWith("W/") ? etag.slice(2) : etag;
      expect(etagValue).toBe(`"${declaredChecksum}"`);

      const lastModified = res1.headers.get("last-modified");
      expect(lastModified).toBeTruthy();
      const lastModifiedMs = Date.parse(lastModified!);
      expect(Number.isNaN(lastModifiedMs)).toBe(false);
      // HTTP-date has second-level precision; allow up to 1s of rounding
      // versus the declared RFC 3339 timestamp.
      expect(Math.abs(lastModifiedMs - Date.parse(declaredTimestamp))).toBeLessThanOrEqual(1000);

      const res2 = await fetch(targetUrl, { headers: { "If-None-Match": etag! } });
      expect(res2.status).toBe(304);
      const body = await res2.text();
      expect(body).toBe("");

      // §7: servers MUST use weak comparison — a client that only ever
      // saw a weakened ETag (e.g. from a compressing intermediary, see
      // ADR-0002) still needs a 304 when it echoes that weak value back.
      const weakEtag = etagValue!.startsWith("W/") ? etagValue! : `W/${etagValue}`;
      const res3 = await fetch(targetUrl, { headers: { "If-None-Match": weakEtag } });
      expect(res3.status).toBe(304);
    }
  );
});

describe("error envelope", () => {
  it("unknown entity id returns a schema-valid not_found error", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    if (index.sitemaps.length === 0) return;
    const sitemap = await fetchSitemap(index.sitemaps[0].url, undefined, PERMISSIVE);

    // Build the "unknown id" URL by taking a *real* entity URL from the
    // sitemap and swapping only its final id segment — this guarantees
    // the request actually reaches this server's entity route (correct
    // path shape, suffix, encoding), rather than assuming a URI
    // construction convention that might not match how this particular
    // server built its sitemap.items[].url. Falls back to entity_base
    // construction (spec §3.1) only for a server with an empty sitemap.
    let url: string;
    if (sitemap.items.length > 0) {
      const sample = new URL(sitemap.items[0].url);
      const segments = sample.pathname.split("/");
      segments[segments.length - 1] = "aadp-conformance-suite-does-not-exist.json";
      sample.pathname = segments.join("/");
      url = sample.toString();
    } else {
      if (!manifest.entity_base) return; // nothing to build an entity URL from
      url = `${manifest.entity_base}/${index.sitemaps[0].type}/aadp-conformance-suite-does-not-exist.json`;
    }

    let caught: AadpRequestError | undefined;
    try {
      await fetchEntity(url, PERMISSIVE);
    } catch (err) {
      caught = err as AadpRequestError;
    }
    expect(caught).toBeInstanceOf(AadpRequestError);
    expect(caught?.status).toBe(404);
    expect(validateError(caught?.envelope).valid).toBe(true);
    expect(caught?.envelope?.error.code).toBe("not_found");
  });

  it("unpublished type returns a schema-valid unsupported_type error", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    if (index.sitemaps.length === 0) return;

    // Same principle as the entity test above: derive the URL by
    // swapping the type segment of a *real* sitemap URL, rather than
    // assuming the conventional /ai/v0.1/sitemaps/{type}.json shape.
    const sample = new URL(index.sitemaps[0].url);
    const segments = sample.pathname.split("/");
    segments[segments.length - 1] = "aadp-conformance-suite-unknown-type.json";
    sample.pathname = segments.join("/");
    const url = sample.toString();

    let caught: AadpRequestError | undefined;
    try {
      await fetchSitemap(url, undefined, PERMISSIVE);
    } catch (err) {
      caught = err as AadpRequestError;
    }
    expect(caught?.status).toBe(404);
    expect(caught?.envelope?.error.code).toBe("unsupported_type");
    expect(validateError(caught?.envelope).valid).toBe(true);
  });
});

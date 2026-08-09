import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle, INSTRUCTION_LIKE_SUMMARY_PREFERENCE } from "./mock-server.js";
import {
  discover,
  fetchSitemapIndex,
  fetchSitemap,
  fetchEntity,
  iterateSitemap,
  discoverAllEntities,
  AadpRequestError,
  BlockedUrlError,
  TooManyRedirectsError,
  ResponseTooLargeError,
  createPermissiveUrlPolicy,
  type ClientOptions,
} from "../../../src/client/v1.0/index.js";
import { validateDocument, checkManifestSemantics, hasSemanticErrors } from "../../../src/validator/index.js";
import { checksumOf } from "../../../src/canonical-json/checksum.js";

/**
 * AADP v1.0 conformance suite (Phase 5). This file MUST be runnable,
 * unmodified, against any server claiming v1.0 conformance — not just
 * this repo's own mock server. It only asserts invariants that hold for
 * *any* conformant v1.0 server; assertions specific to this repo's own
 * fixture dataset live in `mock-server.test.ts` instead. Self-test-only
 * groups (redirect loop, oversized document, SSRF against a loopback
 * origin) are skipped when pointed at an external deployment, since a
 * real server generally won't expose those failure fixtures on demand.
 *
 * Usage against a live deployment:
 *   AADP_BASE_URL=https://your-domain.example npx vitest run tests/conformance/v1.0/conformance.test.ts
 *
 * Without AADP_BASE_URL, an in-process mock server (self-test mode) is
 * started and torn down automatically.
 */

let server: MockServerHandle | undefined;
let baseUrl: string;
const isSelfTest = !process.env.AADP_BASE_URL;
// The mock server binds to 127.0.0.1 (loopback), which the client's
// default strict UrlPolicy blocks — every self-test call below opts in
// via PERMISSIVE, mirroring a caller who intentionally trusts this origin.
const PERMISSIVE: ClientOptions = isSelfTest ? { urlPolicy: createPermissiveUrlPolicy() } : {};

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

async function collectAdvertisedUrls(manifest: Awaited<ReturnType<typeof discover>>): Promise<string[]> {
  const urls: string[] = [manifest.policies.robots, manifest.policies.terms];
  if (manifest.policies.privacy) urls.push(manifest.policies.privacy);
  if (manifest.policies.content_license?.url) urls.push(manifest.policies.content_license.url);
  if (manifest.links?.homepage) urls.push(manifest.links.homepage);
  if (manifest.links?.feed) urls.push(manifest.links.feed);
  if (manifest.links?.search) urls.push(manifest.links.search);
  if (manifest.links?.profiles) urls.push(manifest.links.profiles);
  for (const mod of manifest.modules ?? []) urls.push(mod.schema);
  for (const iface of manifest.interfaces ?? []) {
    if (iface.documentation) urls.push(iface.documentation);
    if (iface.endpoint) urls.push(iface.endpoint);
  }
  return urls;
}

describe("manifest discovery, schema and semantic validity", () => {
  it("manifest schema-validates and has no semantic errors", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    expect(validateDocument({ version: "1.0", kind: "manifest", data: manifest }).valid).toBe(true);
    expect(hasSemanticErrors(checkManifestSemantics(manifest))).toBe(false);
  });

  it("discovery.sitemap_index is the authoritative entry point for enumeration", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    expect(typeof manifest.discovery.sitemap_index).toBe("string");
  });
});

describe("discovery flow: manifest -> sitemap index -> sitemap -> entity", () => {
  it("every hop schema-validates, with checksums recomputed (not just shape-checked)", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);

    const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, PERMISSIVE);
    expect(validateDocument({ version: "1.0", kind: "sitemap-index", data: index }).valid).toBe(true);
    expect(index.sitemaps.length).toBeGreaterThan(0);
    expect(index.checksum).toBe(checksumOf(index.sitemaps));

    const sitemapRef = index.sitemaps[0];
    const sitemap = await fetchSitemap(sitemapRef.url, null, PERMISSIVE);
    expect(validateDocument({ version: "1.0", kind: "sitemap", data: sitemap }).valid).toBe(true);
    expect(sitemap.checksum).toBe(checksumOf(sitemap.items));

    if (sitemap.items.length === 0) return; // empty server is technically conformant
    const item = sitemap.items[0];
    expect(item.id.startsWith(`${sitemap.type}:`)).toBe(true);

    const entity = await fetchEntity(item.url, PERMISSIVE);
    expect(validateDocument({ version: "1.0", kind: "entity", data: entity }).valid).toBe(true);
    expect(entity.id).toBe(item.id);
    expect(entity.type).toBe(sitemap.type);
    expect(entity.checksum).toBe(item.checksum);
    expect(entity.checksum).toBe(checksumOf(entity.data));
  });

  it("full discoverAllEntities walk yields every published entity exactly once", async () => {
    const seen = new Set<string>();
    for await (const entity of discoverAllEntities(baseUrl, PERMISSIVE)) {
      expect(validateDocument({ version: "1.0", kind: "entity", data: entity }).valid).toBe(true);
      expect(seen.has(entity.id)).toBe(false);
      seen.add(entity.id);
      expect(entity.checksum).toBe(checksumOf(entity.data));
    }
  });
});

describe("pagination", () => {
  it("caps page size, terminates cursor.next at null, and never repeats an id", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, PERMISSIVE);

    for (const sitemapRef of index.sitemaps) {
      const first = await fetchSitemap(sitemapRef.url, null, PERMISSIVE);
      expect(first.items.length).toBeLessThanOrEqual(100);
      if (first.cursor !== undefined) {
        expect(["string", "object"]).toContain(typeof first.cursor.next);
      }
      const allIds: string[] = [];
      for await (const item of iterateSitemap(sitemapRef.url, PERMISSIVE)) allIds.push(item.id);
      expect(new Set(allIds).size).toBe(allIds.length);
    }
  });
});

describe("HTTP content type, status and cache validators", () => {
  it("manifest is served as application/json 200", async () => {
    const res = await fetch(new URL("/.well-known/ai-manifest.json", baseUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  });

  it.each(["sitemap-index", "sitemap", "entity"] as const)(
    "%s: ETag equals the declared checksum, Last-Modified is a valid date, and If-None-Match yields an empty 304",
    async (kind) => {
      const manifest = await discover(baseUrl, PERMISSIVE);
      let targetUrl: string;
      let declaredChecksum: string;
      let declaredTimestamp: string;
      const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, PERMISSIVE);
      if (kind === "sitemap-index") {
        targetUrl = manifest.discovery.sitemap_index;
        declaredChecksum = index.checksum;
        declaredTimestamp = index.generated_at;
      } else if (kind === "sitemap") {
        if (index.sitemaps.length === 0) return;
        const sitemap = await fetchSitemap(index.sitemaps[0].url, null, PERMISSIVE);
        targetUrl = index.sitemaps[0].url;
        declaredChecksum = sitemap.checksum;
        declaredTimestamp = sitemap.generated_at;
      } else {
        if (index.sitemaps.length === 0) return;
        const sitemap = await fetchSitemap(index.sitemaps[0].url, null, PERMISSIVE);
        if (sitemap.items.length === 0) return;
        const entity = await fetchEntity(sitemap.items[0].url, PERMISSIVE);
        targetUrl = sitemap.items[0].url;
        declaredChecksum = entity.checksum;
        declaredTimestamp = entity.updated_at;
      }

      const res1 = await fetch(targetUrl);
      const etag = res1.headers.get("etag");
      const etagValue = etag?.startsWith("W/") ? etag.slice(2) : etag;
      expect(etagValue).toBe(`"${declaredChecksum}"`);

      const lastModified = res1.headers.get("last-modified");
      expect(lastModified).toBeTruthy();
      const lastModifiedMs = Date.parse(lastModified!);
      expect(Number.isNaN(lastModifiedMs)).toBe(false);
      expect(Math.abs(lastModifiedMs - Date.parse(declaredTimestamp))).toBeLessThanOrEqual(1000);

      const res2 = await fetch(targetUrl, { headers: { "If-None-Match": etag! } });
      expect(res2.status).toBe(304);
      expect(await res2.text()).toBe("");

      const weakEtag = etagValue!.startsWith("W/") ? etagValue! : `W/${etagValue}`;
      const res3 = await fetch(targetUrl, { headers: { "If-None-Match": weakEtag } });
      expect(res3.status).toBe(304);
    }
  );
});

describe("no advertised URL is a dead link", () => {
  it("every URL the manifest advertises (policies, links, module schema, interface docs) resolves", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const urls = await collectAdvertisedUrls(manifest);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const res = await fetch(url);
      expect(res.status, `${url} returned ${res.status}`).not.toBe(404);
    }
  });
});

describe("error envelope", () => {
  it("unknown entity id returns a schema-valid not_found error", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, PERMISSIVE);
    if (index.sitemaps.length === 0) return;
    const sitemap = await fetchSitemap(index.sitemaps[0].url, null, PERMISSIVE);
    if (sitemap.items.length === 0) return;

    const sample = new URL(sitemap.items[0].url);
    const segments = sample.pathname.split("/");
    segments[segments.length - 1] = "aadp-conformance-suite-does-not-exist.json";
    sample.pathname = segments.join("/");

    let caught: AadpRequestError | undefined;
    try {
      await fetchEntity(sample.toString(), PERMISSIVE);
    } catch (err) {
      caught = err as AadpRequestError;
    }
    expect(caught).toBeInstanceOf(AadpRequestError);
    expect(caught?.status).toBe(404);
    expect(validateDocument({ version: "1.0", kind: "error", data: caught?.envelope }).valid).toBe(true);
    expect(caught?.envelope?.error.code).toBe("not_found");
  });

  it("unpublished type returns a schema-valid unsupported_type error", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, PERMISSIVE);
    if (index.sitemaps.length === 0) return;

    const sample = new URL(index.sitemaps[0].url);
    const segments = sample.pathname.split("/");
    segments[segments.length - 1] = "aadp-conformance-suite-unknown-type.json";
    sample.pathname = segments.join("/");

    let caught: AadpRequestError | undefined;
    try {
      await fetchSitemap(sample.toString(), null, PERMISSIVE);
    } catch (err) {
      caught = err as AadpRequestError;
    }
    expect(caught?.status).toBe(404);
    expect(caught?.envelope?.error.code).toBe("unsupported_type");
    expect(validateDocument({ version: "1.0", kind: "error", data: caught?.envelope }).valid).toBe(true);
  });
});

describe("prompt-like free text is treated as data only", () => {
  it("an instruction-shaped usage_guidance value survives discovery unchanged and unexecuted", async () => {
    const manifest = await discover(baseUrl, PERMISSIVE);
    // Advisory only, per spec v1.0 §3.1.9 — must not block discover().
    const issues = checkManifestSemantics(manifest);
    const warning = issues.find((i) => i.code === "usage_guidance_looks_like_instruction");
    expect(warning?.level).toBe("warning");
    // The field itself is returned verbatim as inert data — this client
    // never parses or acts on it (Phase 4, on never injecting
    // usage_guidance into a system/developer prompt).
    expect(manifest.usage_guidance?.summary_preference).toBe(INSTRUCTION_LIKE_SUMMARY_PREFERENCE);
  });
});

(isSelfTest ? describe : describe.skip)("self-test-only: redirect, oversized, SSRF policy", () => {
  it("a redirect loop is rejected with TooManyRedirectsError", async () => {
    await expect(
      fetchSitemapIndex(new URL("/self-test/redirect-loop", baseUrl).toString(), PERMISSIVE)
    ).rejects.toThrow(TooManyRedirectsError);
  });

  it("an oversized document is rejected once maxResponseBytes is exceeded", async () => {
    await expect(
      discover(baseUrl, { ...PERMISSIVE, maxResponseBytes: 100 })
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it("the default strict UrlPolicy blocks this loopback mock server", async () => {
    await expect(discover(baseUrl)).rejects.toThrow(BlockedUrlError);
  });
});

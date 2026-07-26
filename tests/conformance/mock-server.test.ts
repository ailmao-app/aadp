import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle } from "./mock-server.js";
import {
  discover,
  fetchSitemapIndex,
  fetchSitemap,
  iterateSitemap,
  discoverAllEntities,
  createPermissiveUrlPolicy,
  type ClientOptions,
} from "../../src/client/index.js";

// The mock server binds to 127.0.0.1, which the default strict UrlPolicy
// blocks as a loopback address.
const PERMISSIVE: ClientOptions = { urlPolicy: createPermissiveUrlPolicy() };

/**
 * Regression tests specific to this repo's own reference/mock server
 * fixture dataset: type "example" (5 items, paginated at page size 2)
 * and type "note" (3 items, deliberately served unpaginated with no
 * `cursor` field, to lock in that spec-legal shape). These assertions
 * are tied to mock-server.ts's hardcoded datasets and MUST NOT be
 * asserted by conformance.test.ts, which needs to run unmodified against
 * arbitrary external servers with a different dataset shape.
 */

let server: MockServerHandle;

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

it("mock dataset has exactly 8 entities (5 example + 3 note), discoverable end to end", async () => {
  const seen = new Set<string>();
  for await (const entity of discoverAllEntities(server.baseUrl, PERMISSIVE)) {
    seen.add(entity.id);
  }
  expect(seen.size).toBe(8);
});

it("mock note sitemap is unpaginated: single page, no cursor field", async () => {
  const manifest = await discover(server.baseUrl, PERMISSIVE);
  const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
  const sitemapUrl = index.sitemaps.find((s) => s.type === "note")!.url;

  const page = await fetchSitemap(sitemapUrl, undefined, PERMISSIVE);
  expect(page.items.length).toBe(3);
  expect(page.cursor).toBeUndefined();

  const allIds: string[] = [];
  for await (const item of iterateSitemap(sitemapUrl, PERMISSIVE)) {
    allIds.push(item.id);
  }
  expect(allIds.length).toBe(3);
});

it("mock sitemap paginates 5 items into 3 pages of page size 2", async () => {
  const manifest = await discover(server.baseUrl, PERMISSIVE);
  const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
  const sitemapUrl = index.sitemaps.find((s) => s.type === "example")!.url;

  const page1 = await fetchSitemap(sitemapUrl, undefined, PERMISSIVE);
  expect(page1.items.length).toBe(2);
  expect(page1.cursor?.next).not.toBeNull();

  const page2 = await fetchSitemap(sitemapUrl, page1.cursor!.next, PERMISSIVE);
  expect(page2.items.length).toBe(2);
  expect(page2.cursor?.next).not.toBeNull();

  const page3 = await fetchSitemap(sitemapUrl, page2.cursor!.next, PERMISSIVE);
  expect(page3.items.length).toBe(1);
  expect(page3.cursor?.next).toBeNull();

  const allIds: string[] = [];
  for await (const item of iterateSitemap(sitemapUrl, PERMISSIVE)) {
    allIds.push(item.id);
  }
  expect(allIds.length).toBe(5);
});

describe("locale echo (mock always serves en)", () => {
  it("entity.locale is echoed as en", async () => {
    const manifest = await discover(server.baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    const sitemap = await fetchSitemap(index.sitemaps[0].url, undefined, PERMISSIVE);
    const res = await fetch(sitemap.items[0].url);
    const entity = await res.json();
    expect(entity.locale).toBe("en");
  });
});

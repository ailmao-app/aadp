import { describe, expect, it } from "vitest";
import { defineAADP, defineResource, AadpServerError } from "../../src/server/index.js";
import type { ListArgs } from "../../src/server/index.js";

interface Post {
  slug: string;
  title: string;
  updatedAt: string;
}

const POSTS: Post[] = [
  { slug: "first-post", title: "First post", updatedAt: "2026-01-01T00:00:00.000Z" },
  { slug: "second-post", title: "Second post", updatedAt: "2026-01-02T00:00:00.000Z" },
  { slug: "third-post", title: "Third post", updatedAt: "2026-01-03T00:00:00.000Z" },
];

function makePostResource(overrides: Partial<Parameters<typeof defineResource<Post>>[0]> = {}) {
  return defineResource<Post>({
    type: "post",
    list: ({ cursor, limit }: ListArgs) => {
      const start = cursor ? Number(cursor) : 0;
      const items = POSTS.slice(start, start + limit);
      const nextCursor = start + limit < POSTS.length ? String(start + limit) : null;
      return { items, nextCursor };
    },
    get: ({ id }) => POSTS.find((p) => p.slug === id) ?? null,
    serialize: (post) => ({
      id: `post:${post.slug}`,
      updatedAt: post.updatedAt,
      canonicalUrl: `/posts/${post.slug}`,
      data: { title: post.title },
    }),
    ...overrides,
  });
}

function makeServer(opts: Partial<Parameters<typeof defineAADP>[0]> = {}) {
  return defineAADP({
    baseUrl: "https://example.com",
    application: {
      name: "Example App",
      description: "An example AADP application.",
      publisher: { name: "Example Publisher", url: "https://example.com" },
    },
    policies: {
      robots: "https://example.com/robots.txt",
      terms: "https://example.com/terms",
    },
    resources: [makePostResource()],
    pageSize: 2,
    ...opts,
  });
}

describe("defineAADP() manifest", () => {
  it("builds a schema/semantic-valid manifest with resolved discovery URL", () => {
    const aadp = makeServer();
    const manifest = aadp.manifest();
    expect(manifest.aadp_version).toBe("1.0");
    expect(manifest.discovery.sitemap_index).toBe("https://example.com/ai/1.0/sitemap-index.json");
    expect(manifest.resources).toEqual([{ type: "post" }]);
  });

  it("throws at definition time for a duplicate resource type", () => {
    expect(() =>
      makeServer({ resources: [makePostResource(), makePostResource()] })
    ).toThrow(/duplicate resource type/);
  });

  it("rejects an invalid resource type in defineResource()", () => {
    expect(() => defineResource({ type: "Not_Valid!", list: async () => ({ items: [], nextCursor: null }), get: async () => null, serialize: (x: never) => x })).toThrow(
      /not a valid AADP resource type/
    );
  });
});

describe("defineAADP() sitemap index and sitemap", () => {
  it("builds a valid sitemap index referencing each resource's sitemap URL", () => {
    const aadp = makeServer();
    const index = aadp.sitemapIndex();
    expect(index.sitemaps).toEqual([{ type: "post", url: "https://example.com/ai/1.0/sitemaps/post.json" }]);
    expect(index.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("paginates via an opaque, app-owned cursor round-tripped through the wire cursor envelope", async () => {
    const aadp = makeServer();
    const page1 = await aadp.sitemap("post", null);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe("post:first-post");
    expect(page1.items[0].url).toBe("https://example.com/ai/1.0/entities/post/first-post.json");
    expect(page1.cursor?.next).toBeTruthy();

    const page2 = await aadp.sitemap("post", page1.cursor!.next);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe("post:third-post");
    expect(page2.cursor?.next).toBeNull();
  });

  it("rejects a cursor minted for a different resource type", async () => {
    const aadp = makeServer();
    const page1 = await aadp.sitemap("post", null);
    await expect(aadp.sitemap("other-type" as string, page1.cursor!.next)).rejects.toMatchObject({
      code: "unsupported_type",
    });
  });

  it("throws unsupported_type for an unknown resource type", async () => {
    const aadp = makeServer();
    await expect(aadp.sitemap("unknown")).rejects.toBeInstanceOf(AadpServerError);
    await expect(aadp.sitemap("unknown")).rejects.toMatchObject({ code: "unsupported_type", status: 404 });
  });
});

describe("defineAADP() entity", () => {
  it("resolves a relative canonicalUrl against baseUrl", async () => {
    const aadp = makeServer();
    const doc = await aadp.entity("post", "first-post");
    expect(doc.id).toBe("post:first-post");
    expect(doc.canonical_url).toBe("https://example.com/posts/first-post");
    expect(doc.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("throws not_found for an id get() cannot resolve", async () => {
    const aadp = makeServer();
    await expect(aadp.entity("post", "does-not-exist")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("treats a serialize() id mismatch as not_found rather than leaking the mismatch", async () => {
    const aadp = makeServer({
      resources: [
        makePostResource({
          // get() resolves *some* record regardless of the requested id...
          get: () => POSTS[0],
          // ...but serialize() reports it under its own slug, so the
          // requested id never matches the resolved record's real id.
        }),
      ],
    });
    await expect(aadp.entity("post", "second-post")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("defineAADP() handleRequest", () => {
  it("serves the manifest at the well-known path", async () => {
    const aadp = makeServer();
    const res = await aadp.handleRequest(new Request("https://example.com/.well-known/ai-manifest.json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aadp_version).toBe("1.0");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });

  it("serves sitemap-index and entity routes with ETag + conditional GET", async () => {
    const aadp = makeServer();
    const first = await aadp.handleRequest(new Request("https://example.com/ai/1.0/sitemaps/post.json"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();

    const conditional = await aadp.handleRequest(
      new Request("https://example.com/ai/1.0/sitemaps/post.json", {
        headers: { "If-None-Match": etag! },
      })
    );
    expect(conditional.status).toBe(304);
  });

  it("serves an entity route and returns a 404 error envelope for an unknown id", async () => {
    const aadp = makeServer();
    const ok = await aadp.handleRequest(new Request("https://example.com/ai/1.0/entities/post/first-post.json"));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.data.title).toBe("First post");

    const missing = await aadp.handleRequest(
      new Request("https://example.com/ai/1.0/entities/post/nope.json")
    );
    expect(missing.status).toBe(404);
    const body = await missing.json();
    expect(body.error.code).toBe("not_found");
    expect(body.error.request_id).toBeTruthy();
  });

  it("returns a 404 envelope for an unrouted path", async () => {
    const aadp = makeServer();
    const res = await aadp.handleRequest(new Request("https://example.com/nope"));
    expect(res.status).toBe(404);
  });

  it("answers CORS preflight", async () => {
    const aadp = makeServer();
    const res = await aadp.handleRequest(
      new Request("https://example.com/ai/1.0/sitemap-index.json", { method: "OPTIONS" })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

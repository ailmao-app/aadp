import { describe, expect, it } from "vitest";
import { compileAadpRoutes, WELL_KNOWN_PATH } from "../../src/server/routes.js";
import { AadpServerError } from "../../src/server/errors.js";

describe("compileAadpRoutes() defaults", () => {
  it("compiles the default v1.0 templates", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.paths.sitemapIndex).toBe("/ai/v1.0/sitemap-index.json");
    expect(routes.sitemapPath("post")).toBe("/ai/v1.0/sitemaps/post.json");
    expect(routes.entityPath("post", "welcome")).toBe("/ai/v1.0/entities/post/welcome.json");
  });

  it("builds absolute URLs against a baseUrl", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.sitemapIndexUrl("https://example.com")).toBe("https://example.com/ai/v1.0/sitemap-index.json");
    expect(routes.sitemapUrl("https://example.com", "post")).toBe("https://example.com/ai/v1.0/sitemaps/post.json");
    expect(routes.entityUrl("https://example.com", "post", "welcome")).toBe(
      "https://example.com/ai/v1.0/entities/post/welcome.json"
    );
  });

  it.each([
    ["/ai/v1.0/sitemap-index.json", { kind: "sitemap-index" }],
    ["/ai/v1.0/sitemaps/post.json", { kind: "sitemap", type: "post" }],
    ["/ai/v1.0/entities/post/welcome.json", { kind: "entity", type: "post", id: "welcome" }],
  ])("matches %s", (pathname, expected) => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.match(pathname)).toEqual(expected);
  });

  it("does not match the legacy /ai/1.0/* path", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.match("/ai/1.0/sitemap-index.json")).toBeNull();
  });

  it("does not match an unrelated path", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.match("/nope")).toBeNull();
  });

  it("decodes percent-encoded type/id when matching", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.match("/ai/v1.0/sitemaps/po%73t.json")).toEqual({ kind: "sitemap", type: "post" });
    expect(routes.match("/ai/v1.0/entities/post/wel%63ome.json")).toEqual({
      kind: "entity",
      type: "post",
      id: "welcome",
    });
  });

  it("throws invalid_request for malformed percent-encoding in a matched segment", () => {
    const routes = compileAadpRoutes("1.0");
    let caught: unknown;
    try {
      routes.match("/ai/v1.0/sitemaps/%ZZ.json");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AadpServerError);
    expect(caught).toMatchObject({ code: "invalid_request" });
  });

  it("decodes double percent-encoding only once, never re-interpreting the decoded result as another escape", () => {
    const routes = compileAadpRoutes("1.0");
    // "%2525" decodes once to "%25" (a literal percent sign followed by
    // "25"), not twice to "%" — a second, implicit decode pass would let a
    // client smuggle characters the matcher never sees encoded.
    expect(routes.match("/ai/v1.0/sitemaps/%2525.json")).toEqual({ kind: "sitemap", type: "%25" });
  });

  it("decodes an encoded slash inside a captured segment to a literal slash, never a path separator", () => {
    const routes = compileAadpRoutes("1.0");
    // Splitting happens on raw "/" before any decoding, so "%2F" stays
    // inside the one path segment it was sent in — it must never let a
    // caller smuggle an extra path segment into type/id.
    expect(routes.match("/ai/v1.0/sitemaps/po%2Fst.json")).toEqual({ kind: "sitemap", type: "po/st" });
  });

  it("decodes an encoded backslash inside a captured segment to a literal backslash", () => {
    const routes = compileAadpRoutes("1.0");
    expect(routes.match("/ai/v1.0/sitemaps/po%5Cst.json")).toEqual({ kind: "sitemap", type: "po\\st" });
  });
});

describe("compileAadpRoutes() custom routes", () => {
  it("compiles and matches the plan's acceptance-criteria example", () => {
    const routes = compileAadpRoutes("1.0", {
      sitemapIndex: "/aadp/index",
      sitemap: "/aadp/maps/{type}",
      entity: "/aadp/resources/{type}/{id}",
    });

    expect(routes.sitemapIndexUrl("https://example.com")).toBe("https://example.com/aadp/index");
    expect(routes.sitemapUrl("https://example.com", "post")).toBe("https://example.com/aadp/maps/post");
    expect(routes.entityUrl("https://example.com", "post", "welcome")).toBe(
      "https://example.com/aadp/resources/post/welcome"
    );

    expect(routes.match("/aadp/index")).toEqual({ kind: "sitemap-index" });
    expect(routes.match("/aadp/maps/post")).toEqual({ kind: "sitemap", type: "post" });
    expect(routes.match("/aadp/resources/post/welcome")).toEqual({
      kind: "entity",
      type: "post",
      id: "welcome",
    });
  });

  it("supports a literal prefix/suffix sharing a segment with the placeholder", () => {
    const routes = compileAadpRoutes("1.0", {
      sitemap: "/discovery/aadp/{type}",
      entity: "/public/aadp/{type}/{id}",
      sitemapIndex: "/discovery/aadp-index.json",
    });
    expect(routes.match("/discovery/aadp/post")).toEqual({ kind: "sitemap", type: "post" });
    expect(routes.match("/discovery/aadp-index.json")).toEqual({ kind: "sitemap-index" });
  });

  it("only overrides the fields provided, keeping the rest at their v1.0 default", () => {
    const routes = compileAadpRoutes("1.0", { sitemapIndex: "/custom/index" });
    expect(routes.match("/custom/index")).toEqual({ kind: "sitemap-index" });
    expect(routes.match("/ai/v1.0/sitemaps/post.json")).toEqual({ kind: "sitemap", type: "post" });
    expect(routes.match("/ai/v1.0/entities/post/welcome.json")).toEqual({
      kind: "entity",
      type: "post",
      id: "welcome",
    });
  });
});

describe("compileAadpRoutes() literal canonicalization (published URL must round-trip through a real Request)", () => {
  /** Builds the URL exactly the way `defineAADP()` publishes it, then re-derives the pathname the same way `handleRequest()` reads it off an inbound `Request` — via `new URL(request.url).pathname`, never a hand-built string. */
  function requestPathnameFor(url: string): string {
    return new URL(new Request(url).url).pathname;
  }

  it("round-trips a Unicode literal segment through Request/URL normalization", () => {
    const routes = compileAadpRoutes("1.0", { sitemapIndex: "/khám-phá/aadp" });
    const publishedUrl = routes.sitemapIndexUrl("https://example.com");
    const pathname = requestPathnameFor(publishedUrl);
    expect(routes.match(pathname)).toEqual({ kind: "sitemap-index" });
  });

  it("round-trips a literal segment containing a space", () => {
    const routes = compileAadpRoutes("1.0", { sitemap: "/custom maps/{type}" });
    const publishedUrl = routes.sitemapUrl("https://example.com", "post");
    const pathname = requestPathnameFor(publishedUrl);
    expect(routes.match(pathname)).toEqual({ kind: "sitemap", type: "post" });
  });

  it("round-trips a Unicode literal prefix sharing a segment with a placeholder", () => {
    const routes = compileAadpRoutes("1.0", { entity: "/thực-thể/{type}/{id}" });
    const publishedUrl = routes.entityUrl("https://example.com", "post", "welcome");
    const pathname = requestPathnameFor(publishedUrl);
    expect(routes.match(pathname)).toEqual({ kind: "entity", type: "post", id: "welcome" });
  });

  it("rejects a malformed percent-escape in a literal prefix sharing a segment with a placeholder", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/maps/%ZZ-{type}" })).toThrow(
      /malformed percent-encoding/
    );
  });
});

describe("compileAadpRoutes() invalid configuration", () => {
  it("rejects a relative path", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "relative/path" })).toThrow(
      /origin-relative pathname/
    );
  });

  it("rejects an absolute URL", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "https://example.com/index" })).toThrow(
      /origin-relative pathname/
    );
  });

  it("rejects a path with a query string", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/index?x=1" })).toThrow(/query string or fragment/);
  });

  it("rejects a path with a fragment", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/index#frag" })).toThrow(/query string or fragment/);
  });

  it("rejects a sitemap template missing {type}", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/sitemaps" })).toThrow(
      /must contain exactly one \{type\} placeholder/
    );
  });

  it("rejects a sitemap template with a repeated {type}", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/{type}/{type}" })).toThrow(
      /must contain exactly one \{type\} placeholder/
    );
  });

  it("rejects a sitemap template that also contains {id}", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/{type}/{id}" })).toThrow(
      /must not contain a \{id\} placeholder/
    );
  });

  it("rejects an entity template missing {id}", () => {
    expect(() => compileAadpRoutes("1.0", { entity: "/aadp/{type}" })).toThrow(
      /must contain exactly one \{id\} placeholder/
    );
  });

  it("rejects a sitemapIndex template containing a placeholder", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp/{type}" })).toThrow(
      /must not contain a \{type\} placeholder/
    );
  });

  it("rejects an unsupported placeholder name", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/{slug}" })).toThrow(
      /not a supported placeholder/
    );
  });

  it("rejects a template with an unterminated placeholder", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/{type" })).toThrow(/unterminated/);
  });

  it("rejects a template with a stray closing brace", () => {
    expect(() => compileAadpRoutes("1.0", { sitemap: "/aadp/type}" })).toThrow(/stray/);
  });

  it("rejects two placeholders in the same segment", () => {
    expect(() => compileAadpRoutes("1.0", { entity: "/aadp/{type}{id}" })).toThrow(/ambiguous/);
  });

  it("rejects an empty path segment", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp//index" })).toThrow(/empty path segment/);
  });

  it("rejects a trailing slash", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp/index/" })).toThrow(/empty path segment/);
  });

  it("rejects a dot segment", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp/../index" })).toThrow(/dot segment/);
  });

  it("rejects a percent-encoded dot segment", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp/%2e%2e/index" })).toThrow(/dot segment/);
  });

  it("rejects a backslash in the path", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp\\index" })).toThrow(
      /backslash or control character/
    );
  });

  it("rejects a control character in the path", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "/aadp/in\ndex" })).toThrow(
      /backslash or control character/
    );
  });

  it("rejects an empty string template", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: "" })).toThrow(/non-empty string/);
  });
});

describe("compileAadpRoutes() collision detection", () => {
  it("rejects a sitemapIndex path equal to the well-known manifest path", () => {
    expect(() => compileAadpRoutes("1.0", { sitemapIndex: WELL_KNOWN_PATH })).toThrow(
      /collides with the well-known manifest path/
    );
  });

  it("rejects a sitemapIndex matchable by the sitemap template's placeholder", () => {
    expect(() =>
      compileAadpRoutes("1.0", { sitemapIndex: "/aadp/index", sitemap: "/aadp/{type}" })
    ).toThrow(/collides with/);
  });

  it("rejects sitemap and entity templates with the same shape", () => {
    expect(() =>
      compileAadpRoutes("1.0", { sitemap: "/aadp/{type}/current", entity: "/aadp/{type}/{id}" })
    ).toThrow(/collides with/);
  });

  it("accepts non-colliding custom routes with different segment counts", () => {
    expect(() =>
      compileAadpRoutes("1.0", {
        sitemapIndex: "/aadp/index",
        sitemap: "/aadp/maps/{type}",
        entity: "/aadp/resources/{type}/{id}",
      })
    ).not.toThrow();
  });
});

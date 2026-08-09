/**
 * Generic server module support (implementation plan 1.4.0 §"Generic server
 * module support", Phase 1 — the 1.3.0 debt).
 *
 * The whole point of this layer is that it is *generic*: it publishes module
 * declarations and root-level `x_*` extension fields without knowing which
 * module produced them. These tests therefore use a deliberately fictional
 * `aadp:example` module — a test that reached for `aadp:answer`/`aadp:evidence`
 * would not notice the runtime growing a module-specific branch.
 */
import { describe, expect, it } from "vitest";
import { defineAADP, defineResource } from "../../src/server/index.js";
import type { ListArgs, SerializedEntity } from "../../src/server/index.js";
import { checksumOf } from "../../src/canonical-json/index.js";
import { EXTENSION_KEY_GRAMMAR, isExtensionKey } from "../../src/validator/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Post {
  slug: string;
  title: string;
  updatedAt: string;
}

const POSTS: Post[] = [
  { slug: "first-post", title: "First post", updatedAt: "2026-01-01T00:00:00.000Z" },
];

const APPLICATION = {
  name: "Example App",
  description: "An example AADP application.",
  publisher: { name: "Example Publisher", url: "https://example.com" },
};
const POLICIES = {
  robots: "https://example.com/robots.txt",
  terms: "https://example.com/terms",
};

const EXAMPLE_MODULE = {
  id: "aadp:example",
  version: "1.0",
  schema: "https://example.com/schemas/modules/example/v1.0/module.schema.json",
};

/** `extensions` is a function so each server gets a fresh object — the no-mutation test depends on it. */
function makeServer(options: {
  modules?: Parameters<typeof defineAADP>[0]["modules"];
  extensions?: () => Record<string, unknown> | undefined;
} = {}) {
  const resource = defineResource<Post>({
    type: "post",
    list: ({ cursor, limit }: ListArgs) => {
      const start = cursor ? Number(cursor) : 0;
      return {
        items: POSTS.slice(start, start + limit),
        nextCursor: start + limit < POSTS.length ? String(start + limit) : null,
      };
    },
    get: ({ id }) => POSTS.find((p) => p.slug === id) ?? null,
    serialize: (post): SerializedEntity => ({
      id: `post:${post.slug}`,
      updatedAt: post.updatedAt,
      canonicalUrl: `/posts/${post.slug}`,
      data: { title: post.title },
      ...(options.extensions ? { extensions: options.extensions() } : {}),
    }),
  });
  return defineAADP({
    baseUrl: "https://example.com",
    application: APPLICATION,
    policies: POLICIES,
    resources: [resource],
    ...(options.modules ? { modules: options.modules } : {}),
  });
}

describe("extension-key predicate", () => {
  const entitySchema = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../schemas/v1.0/entity.schema.json", import.meta.url)), "utf8")
  ) as { patternProperties: Record<string, unknown> };

  it("uses the exact grammar the released core entity schema declares", () => {
    // If this ever drifts, the server layer starts accepting or rejecting a
    // different set of keys than the wire contract itself does.
    expect(Object.keys(entitySchema.patternProperties)).toContain(EXTENSION_KEY_GRAMMAR.source);
  });

  it.each(["x_relations", "x_Foo", "x_1", "x_", "x_a_B_9"])("accepts %s", (key) => {
    expect(isExtensionKey(key)).toBe(true);
  });

  it.each(["y_foo", "xfoo", "X_foo", "_x_foo", "x-foo", "x_foo-bar", "data", ""])("rejects %s", (key) => {
    expect(isExtensionKey(key)).toBe(false);
  });
});

describe("manifest module declarations", () => {
  it("publishes AadpServerConfig.modules verbatim in the manifest", () => {
    const manifest = makeServer({ modules: [EXAMPLE_MODULE] }).manifest();
    expect(manifest.modules).toEqual([EXAMPLE_MODULE]);
  });

  it("publishes several declarations in declaration order", () => {
    const second = { ...EXAMPLE_MODULE, id: "aadp:other" };
    const manifest = makeServer({ modules: [EXAMPLE_MODULE, second] }).manifest();
    expect(manifest.modules?.map((m) => m.id)).toEqual(["aadp:example", "aadp:other"]);
  });

  it("carries x_* extension fields on a module declaration", () => {
    const declared = { ...EXAMPLE_MODULE, x_note: { docs: "https://example.com/docs" } };
    expect(makeServer({ modules: [declared] }).manifest().modules).toEqual([declared]);
  });

  it("fails at definition time when a declaration violates the core manifest schema", () => {
    // Validated on the same path as every other manifest field — no
    // module-specific validation branch.
    expect(() =>
      makeServer({ modules: [{ id: "Not A Module Id", version: "1.0", schema: "https://example.com/s.json" }] })
    ).toThrow(/failed schema validation/);
    expect(() =>
      makeServer({ modules: [{ id: "aadp:example", version: "1.0", schema: "not-a-uri" }] })
    ).toThrow(/failed schema validation/);
    expect(() => makeServer({ modules: [] })).toThrow(/failed schema validation/);
  });

  it("is unaffected by mutating the caller's modules array after defineAADP() returns", () => {
    const modules = [{ ...EXAMPLE_MODULE }];
    const aadp = defineAADP({
      baseUrl: "https://example.com",
      application: APPLICATION,
      policies: POLICIES,
      resources: [],
      modules,
    });
    modules.push({ ...EXAMPLE_MODULE, id: "aadp:sneaky" });
    modules[0].version = "9.9";
    expect(aadp.manifest().modules).toEqual([EXAMPLE_MODULE]);
  });
});

describe("entity extension serialization", () => {
  const payload = { module: "aadp:example", version: "1.0", note: "hello" };

  it("emits root-level x_* fields from SerializedEntity.extensions", async () => {
    const aadp = makeServer({ extensions: () => ({ x_example: payload }) });
    const doc = (await aadp.entity("post", "first-post")) as Record<string, unknown>;
    expect(doc.x_example).toEqual(payload);
    expect(doc.data).toEqual({ title: "First post" });
  });

  it("serves them over handleRequest too", async () => {
    const aadp = makeServer({ extensions: () => ({ x_example: payload }) });
    const res = await aadp.handleRequest(
      new Request("https://example.com/ai/v1.0/entities/post/first-post.json")
    );
    expect((await res.json()).x_example).toEqual(payload);
  });

  it.each(["x_Foo", "x_1", "x_"])(
    "accepts extension key %s, exactly as the released core grammar does",
    async (key) => {
      const aadp = makeServer({ extensions: () => ({ [key]: { ok: true } }) });
      const doc = (await aadp.entity("post", "first-post")) as Record<string, unknown>;
      expect(doc[key]).toEqual({ ok: true });
    }
  );

  it.each(["y_foo", "xfoo", "X_foo", "x-foo", "data"])(
    "rejects extension key %s loudly instead of dropping it",
    async (key) => {
      const aadp = makeServer({ extensions: () => ({ [key]: { ok: true } }) });
      await expect(aadp.entity("post", "first-post")).rejects.toThrow(
        /does not match the AADP v1.0 extension grammar/
      );
    }
  );

  it("rejects a non-JSON-safe extension value before it can reach JSON.stringify", async () => {
    for (const value of [() => 1, Number.POSITIVE_INFINITY, new Date(), 1n, undefined]) {
      const aadp = makeServer({ extensions: () => ({ x_example: { bad: value } }) });
      await expect(aadp.entity("post", "first-post")).rejects.toThrow(/not JSON-safe/);
    }
  });

  it("rejects a circular extension value", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const aadp = makeServer({ extensions: () => ({ x_example: cyclic }) });
    await expect(aadp.entity("post", "first-post")).rejects.toThrow(/circular reference/);
  });

  it("rejects an extensions value that is not a plain object", async () => {
    // `null` is in this list deliberately: it is the one value whose
    // prototype cannot be read at all, so a guard ordered after
    // `Object.getPrototypeOf()` would throw a raw TypeError instead of the
    // resource-scoped AADP error. TypeScript forbids it; a JavaScript
    // resource adapter can still produce it.
    for (const bad of [null, [{ x_example: 1 }], "x_example", 42]) {
      const aadp = makeServer({ extensions: () => bad as unknown as Record<string, unknown> });
      await expect(aadp.entity("post", "first-post")).rejects.toMatchObject({
        code: "upstream_unavailable",
        status: 502,
        message: expect.stringMatching(/is not a plain object/),
      });
    }
  });

  it("maps a non-plain-object extensions value to a diagnosable 502 over handleRequest", async () => {
    const aadp = makeServer({ extensions: () => null as unknown as Record<string, unknown> });
    const res = await aadp.handleRequest(
      new Request("https://example.com/ai/v1.0/entities/post/first-post.json")
    );
    expect(res.status).toBe(502);
    // An unhandled error would ALSO surface as a 502 `upstream_unavailable`,
    // just with the generic catch-all message — so the message naming the
    // resource and entity is what actually proves this went through the
    // extension guard rather than escaping it.
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toMatch(/Resource "post" serialize\(\) returned an "extensions" value for "post:first-post"/);
  });

  it("does not mutate, freeze or adopt the object serialize() returned", async () => {
    const supplied: Record<string, unknown> = { x_example: { ...payload } };
    const aadp = makeServer({ extensions: () => supplied });
    const doc = (await aadp.entity("post", "first-post")) as Record<string, unknown>;
    expect(supplied).toEqual({ x_example: payload });
    expect(Object.isFrozen(supplied)).toBe(false);
    expect(doc).not.toBe(supplied);
  });
});

describe("compatibility with 1.3.0 output", () => {
  it("produces a byte-identical manifest when modules is omitted", () => {
    // The 1.3.0 shape, asserted literally rather than against another
    // makeServer() call — otherwise a regression in both paths would cancel out.
    const manifest = makeServer().manifest();
    expect(JSON.stringify(manifest)).toBe(
      JSON.stringify({
        aadp_version: "1.0",
        application: APPLICATION,
        discovery: { sitemap_index: "https://example.com/ai/v1.0/sitemap-index.json" },
        resources: [{ type: "post" }],
        policies: POLICIES,
      })
    );
    expect("modules" in manifest).toBe(false);
  });

  it("produces a byte-identical entity when extensions is omitted", async () => {
    const doc = await makeServer().entity("post", "first-post");
    expect(JSON.stringify(doc)).toBe(
      JSON.stringify({
        aadp_version: "1.0",
        id: "post:first-post",
        type: "post",
        checksum: checksumOf({ title: "First post" }),
        updated_at: "2026-01-01T00:00:00.000Z",
        canonical_url: "https://example.com/posts/first-post",
        data: { title: "First post" },
      })
    );
  });

  it("treats an explicitly undefined/empty extensions the same as omitting it", async () => {
    for (const extensions of [() => undefined, () => ({})]) {
      const doc = await makeServer({ extensions }).entity("post", "first-post");
      expect(Object.keys(doc)).toEqual([
        "aadp_version",
        "id",
        "type",
        "checksum",
        "updated_at",
        "canonical_url",
        "data",
      ]);
    }
  });
});

describe("the server layer stays generic", () => {
  const SERVER_DIR = fileURLToPath(new URL("../../src/server/", import.meta.url));

  it("never names a specific module anywhere under src/server/**", () => {
    // Release gate (plan 1.4.0 §"Release gate"): generic module support means
    // the runtime cannot know about `aadp:relations`, `aadp:answer` or
    // `aadp:evidence` — not in a branch, an import, or even an example in a
    // doc comment that a later reader might turn into a branch.
    const offenders: string[] = [];
    for (const file of readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(new URL(file, pathToFileURL(SERVER_DIR)), "utf8");
      for (const name of ["aadp:relations", "aadp:answer", "aadp:evidence", "x_relations", "x_answer", "x_evidence"]) {
        if (source.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not re-declare the extension grammar in the server layer", () => {
    // One source of truth (`src/validator/extension-keys.ts`); a second copy
    // is exactly how the server would drift into a stricter grammar than core.
    for (const file of readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(new URL(file, pathToFileURL(SERVER_DIR)), "utf8");
      expect(source).not.toMatch(/\/\^x_/);
    }
  });
});

describe("checksum stability", () => {
  it("keeps the core checksum scoped to data, so adding an extension never changes it", async () => {
    const plain = await makeServer().entity("post", "first-post");
    const extended = await makeServer({
      extensions: () => ({ x_example: { module: "aadp:example", version: "1.0" } }),
    }).entity("post", "first-post");

    expect(extended.checksum).toBe(plain.checksum);
    expect(extended.checksum).toBe(checksumOf({ title: "First post" }));
  });

  it("keeps the sitemap item checksum identical to the entity checksum", async () => {
    const aadp = makeServer({ extensions: () => ({ x_example: { module: "aadp:example" } }) });
    const sitemap = await aadp.sitemap("post");
    const doc = await aadp.entity("post", "first-post");
    expect(sitemap.items[0].checksum).toBe(doc.checksum);
  });
});

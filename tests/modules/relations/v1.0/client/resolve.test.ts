import { afterEach, describe, expect, it } from "vitest";
import {
  resolveRelationTarget,
  resolveRelationItem,
  iterateRelationCollection,
} from "../../../../../src/modules/relations/v1.0/client/resolve.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { RelationsCursorCycleError, RelationsIntegrityMismatchError } from "../../../../../src/modules/relations/v1.0/client/errors.js";
import { createPermissiveUrlPolicy, BlockedUrlError } from "../../../../../src/client/v1.0/index.js";
import type { RelationItemV1 } from "../../../../../src/modules/relations/v1.0/types.js";
import { startServer, sendJson, buildEntity, buildCollectionPage, type TestServer } from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("resolveRelationTarget", () => {
  it("resolves a target entity and checks it against the hint", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        return sendJson(res, 200, buildEntity("post:hello", "post", { title: "Hello" }));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const result = await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.target.entity!.id).toBe("post:hello");
    }
  });

  it("returns status: duplicate without a network call for an already-visited canonical target", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        return sendJson(res, 200, buildEntity("post:hello", "post", { title: "Hello" }));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    server.requestLog.length = 0;
    const second = await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    expect(second.status).toBe("duplicate");
    expect(server.requestLog).toEqual([]);
  });

  it("returns status: issue (not a throw) when the target entity's id disagrees with the hint", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        return sendJson(res, 200, buildEntity("post:wrong-id", "post", { title: "Hello" }));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const result = await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    expect(result.status).toBe("issue");
    if (result.status === "issue") {
      expect(result.issue.code).toBe("target_unresolvable");
      // `cause` preserves the original error (here an id/type integrity
      // mismatch) so a caller (e.g. Answer's resolveAnswerTargets) can
      // distinguish causes `code` alone collapses — see
      // RelationsTraversalIssue.cause docstring.
      expect(result.issue.cause).toBeInstanceOf(Error);
      expect(result.issue.cause?.message).toMatch(/does not match/);
    }
  });

  it("returns status: issue but preserves the fetched entity when only the target's type disagrees with expectedType", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        return sendJson(res, 200, buildEntity("post:hello", "document", { title: "Hello" }));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const result = await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    expect(result.status).toBe("issue");
    if (result.status === "issue") {
      expect(result.issue.code).toBe("target_unresolvable");
      expect(result.issue.cause).toBeInstanceOf(Error);
      expect(result.issue.cause?.message).toMatch(/has type/);
      // Unlike an id mismatch, the entity WAS fetched and is schema/checksum
      // valid — a caller with its own, differently-scoped expected type for
      // the same canonical target (Answer's resolveAnswerTargets) can reuse
      // it without a second fetch. See RelationsTraversalIssue.entity.
      expect(result.issue.entity?.id).toBe("post:hello");
      expect(result.issue.entity?.type).toBe("document");
    }
  });

  it("returns a blocked_url issue for a private-network target instead of throwing", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, buildEntity("post:hello", "post", {})));
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    // No urlPolicy override: default strict policy blocks this loopback origin.
    const result = await resolveRelationTarget(hint, "post", {}, budget, "test");
    expect(result.status).toBe("issue");
    if (result.status === "issue") {
      expect(result.issue.code).toBe("blocked_url");
      expect(result.issue.cause).toBeInstanceOf(Error);
    }
  });

  it("reports a warning issue when the checksum hint disagrees with the fetched entity, but still resolves", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        return sendJson(res, 200, buildEntity("post:hello", "post", { title: "Hello" }));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json`, checksum: `sha256:${"0".repeat(64)}` };
    const result = await resolveRelationTarget(hint, "post", PERMISSIVE, budget, "test");
    expect(result.status).toBe("resolved");
  });
});

describe("resolveRelationItem — cardinality one", () => {
  it("resolves the single target", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") return sendJson(res, 200, buildEntity("post:hello", "post", {}));
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "creator",
      target_type: "post",
      cardinality: "one",
      target: { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entity!.id).toBe("post:hello");
  });
});

describe("resolveRelationItem — cardinality many, inline targets", () => {
  it("resolves every inline target", async () => {
    server = await startServer((_req, res, url) => {
      const match = url.pathname.match(/^\/entities\/series\/(.+)\.json$/);
      if (match) return sendJson(res, 200, buildEntity(`series:${match[1]}`, "series", {}));
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "series",
      target_type: "series",
      cardinality: "many",
      targets: [
        { id: "series:a", url: `${server.baseUrl}/entities/series/a.json` },
        { id: "series:b", url: `${server.baseUrl}/entities/series/b.json` },
      ],
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(false);
    expect(result.items.map((t) => t.entity!.id).sort()).toEqual(["series:a", "series:b"]);
  });

  it("does not charge a node twice for a duplicate target id across two different relation items", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/series/shared.json") return sendJson(res, 200, buildEntity("series:shared", "series", {}));
      sendJson(res, 404, {});
    });
    const sharedTarget = { id: "series:shared", url: `${server.baseUrl}/entities/series/shared.json` };
    const itemA: RelationItemV1 = { rel: "series", target_type: "series", cardinality: "many", targets: [sharedTarget] };
    const itemB: RelationItemV1 = { rel: "x_vendor:also_series", target_type: "series", cardinality: "many", targets: [sharedTarget] };
    const budget = createRelationsTraversalBudget();
    const resultA = await resolveRelationItem(itemA, "character:alice", 1, PERMISSIVE, budget);
    const resultB = await resolveRelationItem(itemB, "character:alice", 1, PERMISSIVE, budget);
    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0].entity).toBeDefined();
    // Duplicate: recorded hint-only (the edge still exists) but not
    // re-fetched and not re-charged against the node budget.
    expect(resultB.items).toHaveLength(1);
    expect(resultB.items[0].entity).toBeUndefined();
    expect(server.requestLog.filter((p) => p === "/entities/series/shared.json")).toHaveLength(1);
    expect(budget.nodesVisited).toBe(1);
  });
});

describe("resolveRelationItem — cardinality many, collection", () => {
  it("paginates a collection and returns hint-only items by default (no per-item entity fetch)", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) {
          return sendJson(
            res,
            200,
            buildCollectionPage(source, "posts", "post", [{ id: "post:a", url: "http://example.com/a.json" }], "page-2")
          );
        }
        return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [{ id: "post:b", url: "http://example.com/b.json" }], null));
      }
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "posts",
      target_type: "post",
      cardinality: "many",
      collection: { url: `${server.baseUrl}/relations/alice/posts.json`, pagination: "cursor" },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(false);
    expect(result.items.map((t) => t.hint.id)).toEqual(["post:a", "post:b"]);
    expect(result.items.every((t) => t.entity === undefined)).toBe(true);
  });

  it("handles an empty collection (single page, items: [])", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "posts",
      target_type: "post",
      cardinality: "many",
      collection: { url: `${server.baseUrl}/relations/alice/posts.json`, pagination: "cursor" },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("resolves full entities for collection items when resolveCollectionTargets is set", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(
          res,
          200,
          buildCollectionPage(source, "posts", "post", [{ id: "post:a", url: `${(_req.headers.host ? `http://${_req.headers.host}` : "")}/entities/post/a.json` }], null)
        );
      }
      if (url.pathname === "/entities/post/a.json") return sendJson(res, 200, buildEntity("post:a", "post", {}));
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "posts",
      target_type: "post",
      cardinality: "many",
      collection: { url: `${server.baseUrl}/relations/alice/posts.json`, pagination: "cursor" },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, { ...PERMISSIVE, resolveCollectionTargets: true }, budget);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entity!.id).toBe("post:a");
  });

  it("reports a cursor_cycle issue (partial) and stops that item's pagination when cursor.next repeats", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [{ id: "post:a", url: "http://example.com/a.json" }], "page-2"));
      }
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "posts",
      target_type: "post",
      cardinality: "many",
      collection: { url: `${server.baseUrl}/relations/alice/posts.json`, pagination: "cursor" },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("cursor_cycle");
  });

  it("reports a collection_context_mismatch issue when the page's source/rel/target_type disagrees with the item", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage({ id: "character:bob", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const item: RelationItemV1 = {
      rel: "posts",
      target_type: "post",
      cardinality: "many",
      collection: { url: `${server.baseUrl}/relations/alice/posts.json`, pagination: "cursor" },
    };
    const budget = createRelationsTraversalBudget();
    const result = await resolveRelationItem(item, "character:alice", 1, PERMISSIVE, budget);
    expect(result.partial).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("collection_context_mismatch");
  });
});

describe("iterateRelationCollection standalone", () => {
  it("yields items across pages until cursor.next is null", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [{ id: "post:a", url: "http://x/a.json" }], "p2"));
        return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [{ id: "post:b", url: "http://x/b.json" }], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    const items = [];
    for await (const item of iterateRelationCollection(`${server.baseUrl}/relations/alice/posts.json`, expected, PERMISSIVE, budget)) {
      items.push(item.id);
    }
    expect(items).toEqual(["post:a", "post:b"]);
  });

  it("throws RelationsCursorCycleError when a repeated cursor is seen", async () => {
    server = await startServer((_req, res, url) => {
      const source = { id: "character:alice", type: "character" };
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage(source, "posts", "post", [], "same-cursor"));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    await expect(
      (async () => {
        for await (const _item of iterateRelationCollection(`${server.baseUrl}/relations/alice/posts.json`, expected, PERMISSIVE, budget)) {
          // consume
        }
      })()
    ).rejects.toThrow(RelationsCursorCycleError);
  });

  it("throws RelationsIntegrityMismatchError when a page's context disagrees with what was expected", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage({ id: "character:someone-else", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget();
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    await expect(
      (async () => {
        for await (const _item of iterateRelationCollection(`${server.baseUrl}/relations/alice/posts.json`, expected, PERMISSIVE, budget)) {
          // consume
        }
      })()
    ).rejects.toThrow(RelationsIntegrityMismatchError);
  });

  it("charges maxCrossOriginRequests once per page for a cross-origin collection, rejecting before the first page at limit 0", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 0 });
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    await expect(
      (async () => {
        for await (const _item of iterateRelationCollection(
          `${server.baseUrl}/relations/alice/posts.json`,
          expected,
          { ...PERMISSIVE, rootOrigin: "https://root.example.com" },
          budget
        )) {
          // consume
        }
      })()
    ).rejects.toThrow(/maxCrossOriginRequests/);
    expect(server.requestLog).toEqual([]); // rejected before the first page was ever fetched
  });

  it("counts every page of a cross-origin collection toward maxCrossOriginRequests, not just the first", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], "p2"));
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 1 });
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    await expect(
      (async () => {
        for await (const _item of iterateRelationCollection(
          `${server.baseUrl}/relations/alice/posts.json`,
          expected,
          { ...PERMISSIVE, rootOrigin: "https://root.example.com" },
          budget
        )) {
          // consume
        }
      })()
    ).rejects.toThrow(/maxCrossOriginRequests/);
    // First page allowed (charge 1, at limit); second page's charge (2) exceeds the limit of 1.
    expect(server.requestLog.filter((p) => p === "/relations/alice/posts.json")).toHaveLength(1);
  });

  it("does not charge maxCrossOriginRequests for a same-origin collection", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 0 });
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    const items = [];
    for await (const item of iterateRelationCollection(
      `${server.baseUrl}/relations/alice/posts.json`,
      expected,
      { ...PERMISSIVE, rootOrigin: server.baseUrl },
      budget
    )) {
      items.push(item);
    }
    expect(items).toEqual([]);
    expect(budget.crossOriginRequestsMade).toBe(0);
  });
});

function errorEnvelope(code: string, message: string) {
  return { error: { code, message, request_id: "req_test" } };
}

describe("per-hop cross-origin charging (ADR-0008): every attempt, retry, and redirect hop", () => {
  it("resolveRelationTarget charges a retried cross-origin target on every attempt, not just the first", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        attempts++;
        if (attempts < 2) return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
        return sendJson(res, 200, buildEntity("post:hello", "post", {}));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 1 });
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    // rootOrigin deliberately different from the server itself, so every
    // attempt (including the retry) is cross-origin from the first hop.
    const options = { ...PERMISSIVE, rootOrigin: "https://root.example.com", retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 } };
    await expect(resolveRelationTarget(hint, "post", options, budget, "test")).rejects.toThrow(/maxCrossOriginRequests/);
    // Charged (and rejected) on attempt 2, before that attempt's network
    // call — so the server only ever received the first attempt.
    expect(attempts).toBe(1);
  });

  it("resolveRelationTarget charges a redirect hop that leaves rootOrigin, even though the initial request was same-origin", async () => {
    const target = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") return sendJson(res, 200, buildEntity("post:hello", "post", {}));
      sendJson(res, 404, {});
    });
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/redirect-to-hello.json") {
        res.writeHead(302, { Location: `${target.baseUrl}/entities/post/hello.json` });
        return res.end();
      }
      sendJson(res, 404, {});
    });
    try {
      const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 0 });
      const hint = { id: "post:hello", url: `${server.baseUrl}/redirect-to-hello.json` };
      // rootOrigin matches the FIRST hop's origin (server), so only the
      // redirect hop (landing on `target`, a different origin) is
      // cross-origin.
      const options = { ...PERMISSIVE, rootOrigin: server.baseUrl };
      const result = await resolveRelationTarget(hint, "post", options, budget, "test").catch((e) => e);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/maxCrossOriginRequests/);
    } finally {
      await target.close();
    }
  });

  it("iterateRelationCollection charges a retried cross-origin page on every attempt", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        attempts++;
        if (attempts < 2) return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 1 });
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    const options = {
      ...PERMISSIVE,
      rootOrigin: "https://root.example.com",
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    };
    await expect(
      (async () => {
        for await (const _item of iterateRelationCollection(`${server.baseUrl}/relations/alice/posts.json`, expected, options, budget)) {
          // consume
        }
      })()
    ).rejects.toThrow(/maxCrossOriginRequests/);
    expect(attempts).toBe(1);
  });

  it("resolveRelationTarget preserves (never replaces) a caller-supplied onBeforeAttempt, calling it once per attempt", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/post/hello.json") {
        attempts++;
        if (attempts < 2) return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
        return sendJson(res, 200, buildEntity("post:hello", "post", {}));
      }
      sendJson(res, 404, {});
    });
    const seenUrls: string[] = [];
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const options = {
      ...PERMISSIVE,
      rootOrigin: server.baseUrl,
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
      onBeforeAttempt: (url: URL) => seenUrls.push(url.toString()),
    };
    const result = await resolveRelationTarget(hint, "post", options, budget, "test");
    expect(result.status).toBe("resolved");
    // Called once per attempt (2 attempts: one 503, one success) — not
    // silently dropped by the internal cross-origin hook this client adds.
    expect(seenUrls).toEqual([hint.url, hint.url]);
  });

  it("iterateRelationCollection preserves a caller-supplied onBeforeAttempt across pages", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/relations/alice/posts.json") {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], "p2"));
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });
    const seenCount = { n: 0 };
    const budget = createRelationsTraversalBudget();
    const expected = { sourceId: "character:alice", sourceType: "character", rel: "posts", targetType: "post" };
    const options = { ...PERMISSIVE, rootOrigin: server.baseUrl, onBeforeAttempt: () => seenCount.n++ };
    const items = [];
    for await (const item of iterateRelationCollection(`${server.baseUrl}/relations/alice/posts.json`, expected, options, budget)) {
      items.push(item);
    }
    expect(seenCount.n).toBe(2); // one call per page fetched
  });

  it("a caller's onBeforeAttempt that throws blocks the network call, same as the internal cross-origin charge", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, buildEntity("post:hello", "post", {})));
    const budget = createRelationsTraversalBudget();
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const options = {
      ...PERMISSIVE,
      rootOrigin: server.baseUrl,
      onBeforeAttempt: () => {
        throw new Error("caller policy rejected this hop");
      },
    };
    // A plain Error from the caller's own hook is a per-target issue here
    // (resolveRelationTarget never throws for those — see `issueFromError`),
    // not a global-stop rejection like a budget/abort error would be. What
    // matters for this test is that the network call never happened.
    const result = await resolveRelationTarget(hint, "post", options, budget, "test");
    expect(result.status).toBe("issue");
    if (result.status === "issue") {
      expect(result.issue.message).toMatch(/caller policy rejected/);
    }
    expect(server.requestLog).toEqual([]);
  });

  it("maxCrossOriginRequests: 0 blocks the request before the network call, leaving requestsMade at 0", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, buildEntity("post:hello", "post", {})));
    const budget = createRelationsTraversalBudget({ maxCrossOriginRequests: 0 });
    const hint = { id: "post:hello", url: `${server.baseUrl}/entities/post/hello.json` };
    const options = { ...PERMISSIVE, rootOrigin: "https://root.example.com" };
    await expect(resolveRelationTarget(hint, "post", options, budget, "test")).rejects.toThrow(/maxCrossOriginRequests/);
    expect(server.requestLog).toEqual([]);
    // The blocked hop must not have consumed a maxRequests slot either —
    // onBeforeAttempt (which threw) runs before that charge.
    expect(budget.requestsMade).toBe(0);
  });
});

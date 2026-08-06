import { afterEach, describe, expect, it } from "vitest";
import { traverseRelations } from "../../../../../src/modules/relations/v1.0/client/graph.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { createPermissiveUrlPolicy, AbortedError } from "../../../../../src/client/v1.0/index.js";
import { AadpDiscoveryBudgetExceededError } from "../../../../../src/client/discovery-budget.js";
import { startServer, sendJson, buildEntity, buildRelationSet, type TestServer } from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** A -> B -> C chain, each with a single `creator`-style "one" edge to the next. */
function chainServer() {
  return startServer((_req, res, url) => {
    const host = _req.headers.host;
    if (url.pathname === "/entities/character/a.json") {
      return sendJson(
        res,
        200,
        buildEntity("character:a", "character", {}, {
          x_relations: buildRelationSet([
            { rel: "related", target_type: "character", cardinality: "one", target: { id: "character:b", url: `http://${host}/entities/character/b.json` } },
          ]),
        })
      );
    }
    if (url.pathname === "/entities/character/b.json") {
      return sendJson(
        res,
        200,
        buildEntity("character:b", "character", {}, {
          x_relations: buildRelationSet([
            { rel: "related", target_type: "character", cardinality: "one", target: { id: "character:c", url: `http://${_req.headers.host}/entities/character/c.json` } },
          ]),
        })
      );
    }
    if (url.pathname === "/entities/character/c.json") {
      return sendJson(res, 200, buildEntity("character:c", "character", {}));
    }
    sendJson(res, 404, {});
  });
}

describe("traverseRelations — depth", () => {
  it("root is depth 0; direct relations resolve at depth 1 without followEdges", async () => {
    server = await chainServer();
    const result = await traverseRelations(`${server.baseUrl}/entities/character/a.json`, PERMISSIVE);
    expect(result.partial).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].depth).toBe(1);
    expect(result.items[0].target.entity!.id).toBe("character:b");
    // followEdges is off by default: character:c is never fetched.
    expect(server.requestLog).not.toContain("/entities/character/c.json");
  });

  it("with followEdges, walks multiple hops and increments depth per edge", async () => {
    server = await chainServer();
    const result = await traverseRelations(`${server.baseUrl}/entities/character/a.json`, { ...PERMISSIVE, followEdges: true, maxDepth: 5 });
    expect(result.partial).toBe(false);
    const byTarget = Object.fromEntries(result.items.map((e) => [e.target.entity!.id, e.depth]));
    expect(byTarget).toEqual({ "character:b": 1, "character:c": 2 });
  });

  it("stops descending once maxDepth is reached, reporting the walk as partial", async () => {
    server = await chainServer();
    const result = await traverseRelations(`${server.baseUrl}/entities/character/a.json`, { ...PERMISSIVE, followEdges: true, maxDepth: 1 });
    expect(result.partial).toBe(true);
    expect(result.issues.some((i) => i.code === "traversal_budget_exceeded")).toBe(true);
    // Depth-1 edge (character:b) still resolved before the limit stopped the walk.
    expect(result.items.map((e) => e.target.entity?.id)).toContain("character:b");
    expect(result.items.map((e) => e.target.entity?.id)).not.toContain("character:c");
  });
});

describe("traverseRelations — graph cycle", () => {
  it("a cycle back to an already-expanded node stops that branch without re-fetching or infinite recursion", async () => {
    server = await startServer((_req, res, url) => {
      const host = _req.headers.host;
      if (url.pathname === "/entities/character/a.json") {
        return sendJson(
          res,
          200,
          buildEntity("character:a", "character", {}, {
            x_relations: buildRelationSet([
              { rel: "related", target_type: "character", cardinality: "one", target: { id: "character:b", url: `http://${host}/entities/character/b.json` } },
            ]),
          })
        );
      }
      if (url.pathname === "/entities/character/b.json") {
        return sendJson(
          res,
          200,
          buildEntity("character:b", "character", {}, {
            x_relations: buildRelationSet([
              // Cycle: b points right back to a.
              { rel: "related", target_type: "character", cardinality: "one", target: { id: "character:a", url: `http://${host}/entities/character/a.json` } },
            ]),
          })
        );
      }
      sendJson(res, 404, {});
    });

    const result = await traverseRelations(`${server.baseUrl}/entities/character/a.json`, { ...PERMISSIVE, followEdges: true, maxDepth: 20 });
    expect(result.partial).toBe(false); // a contained cycle is not a budget/error condition
    // a -> b (depth 1), b -> a (depth 2, resolved as a duplicate-target edge, but a's own
    // relations are never expanded a second time) — the walk terminates.
    expect(result.items.map((e) => `${e.depth}:${e.target.hint.id}`)).toEqual(["1:character:b", "2:character:a"]);
    expect(server.requestLog.filter((p) => p === "/entities/character/a.json")).toHaveLength(1);
    expect(server.requestLog.filter((p) => p === "/entities/character/b.json")).toHaveLength(1);
  });
});

describe("traverseRelations — node budget", () => {
  it("throws via a partial result once maxNodes is exceeded", async () => {
    server = await startServer((_req, res, url) => {
      const host = _req.headers.host;
      // Ids' local part must start with a lowercase letter (entity id
      // pattern), hence "leaf-n0" etc. rather than a bare numeric suffix.
      const match = url.pathname.match(/^\/entities\/leaf\/(n\d+)\.json$/);
      if (url.pathname === "/entities/root.json") {
        const targets = Array.from({ length: 5 }, (_, i) => ({ id: `leaf:n${i}`, url: `http://${host}/entities/leaf/n${i}.json` }));
        return sendJson(
          res,
          200,
          buildEntity("root:root", "root", {}, {
            x_relations: buildRelationSet([{ rel: "related", target_type: "leaf", cardinality: "many", targets }]),
          })
        );
      }
      if (match) return sendJson(res, 200, buildEntity(`leaf:${match[1]}`, "leaf", {}));
      sendJson(res, 404, {});
    });

    const result = await traverseRelations(`${server.baseUrl}/entities/root.json`, { ...PERMISSIVE, maxNodes: 3 });
    expect(result.partial).toBe(true);
    expect(result.issues.some((i) => i.code === "traversal_budget_exceeded")).toBe(true);
    expect(result.items.length).toBeLessThan(5);
  });
});

describe("traverseRelations — cross-origin cap", () => {
  it("throws via a partial result once maxCrossOriginRequests is exceeded", async () => {
    const otherOrigin = await startServer((_req, res, url) => {
      const match = url.pathname.match(/^\/entities\/leaf\/(n\d+)\.json$/);
      if (match) return sendJson(res, 200, buildEntity(`leaf:${match[1]}`, "leaf", {}));
      sendJson(res, 404, {});
    });
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/root.json") {
        return sendJson(
          res,
          200,
          buildEntity("root:root", "root", {}, {
            x_relations: buildRelationSet([
              {
                rel: "related",
                target_type: "leaf",
                cardinality: "many",
                targets: [
                  { id: "leaf:n0", url: `${otherOrigin.baseUrl}/entities/leaf/n0.json` },
                  { id: "leaf:n1", url: `${otherOrigin.baseUrl}/entities/leaf/n1.json` },
                ],
              },
            ]),
          })
        );
      }
      sendJson(res, 404, {});
    });

    try {
      const result = await traverseRelations(`${server.baseUrl}/entities/root.json`, { ...PERMISSIVE, maxCrossOriginRequests: 1 });
      expect(result.partial).toBe(true);
      expect(result.issues.some((i) => i.code === "traversal_budget_exceeded")).toBe(true);
      expect(result.items).toHaveLength(1);
    } finally {
      await otherOrigin.close();
    }
  });
});

describe("traverseRelations — cancellation", () => {
  it("propagates AbortedError and stops the whole walk, not just one branch", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/root.json") {
        setTimeout(() => sendJson(res, 200, buildEntity("root:root", "root", {})), 2000);
        return;
      }
      sendJson(res, 404, {});
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort("giving up"), 20);
    await expect(
      traverseRelations(`${server.baseUrl}/entities/root.json`, { ...PERMISSIVE, signal: controller.signal })
    ).rejects.toThrow(AbortedError);
  });
});

describe("traverseRelations — credential scoping (specification.md §7)", () => {
  it("sends a caller-supplied header to the root origin but strips it when resolving a cross-origin target", async () => {
    let targetReceivedAuth: string | undefined;
    const target = await startServer((req, res, url) => {
      targetReceivedAuth = req.headers.authorization;
      if (url.pathname === "/entities/leaf/n0.json") return sendJson(res, 200, buildEntity("leaf:n0", "leaf", {}));
      sendJson(res, 404, {});
    });

    let rootReceivedAuth: string | undefined;
    server = await startServer((req, res, url) => {
      if (url.pathname === "/entities/root.json") {
        rootReceivedAuth = req.headers.authorization;
        return sendJson(
          res,
          200,
          buildEntity("root:root", "root", {}, {
            x_relations: buildRelationSet([
              {
                rel: "related",
                target_type: "leaf",
                cardinality: "one",
                target: { id: "leaf:n0", url: `${target.baseUrl}/entities/leaf/n0.json` },
              },
            ]),
          })
        );
      }
      sendJson(res, 404, {});
    });

    try {
      await traverseRelations(`${server.baseUrl}/entities/root.json`, {
        ...PERMISSIVE,
        headers: { Authorization: "Bearer secret" },
      });
      expect(rootReceivedAuth).toBe("Bearer secret");
      expect(targetReceivedAuth).toBeUndefined();
    } finally {
      await target.close();
    }
  });

  it("keeps the header cross-origin once explicitly allow-listed via crossOriginSafeHeaders", async () => {
    let targetReceivedApiKey: string | undefined;
    const target = await startServer((req, res, url) => {
      targetReceivedApiKey = req.headers["x-api-key"] as string | undefined;
      if (url.pathname === "/entities/leaf/n0.json") return sendJson(res, 200, buildEntity("leaf:n0", "leaf", {}));
      sendJson(res, 404, {});
    });

    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/root.json") {
        return sendJson(
          res,
          200,
          buildEntity("root:root", "root", {}, {
            x_relations: buildRelationSet([
              {
                rel: "related",
                target_type: "leaf",
                cardinality: "one",
                target: { id: "leaf:n0", url: `${target.baseUrl}/entities/leaf/n0.json` },
              },
            ]),
          })
        );
      }
      sendJson(res, 404, {});
    });

    try {
      await traverseRelations(`${server.baseUrl}/entities/root.json`, {
        ...PERMISSIVE,
        headers: { "X-API-Key": "secret" },
        crossOriginSafeHeaders: ["X-API-Key"],
      });
      expect(targetReceivedApiKey).toBe("secret");
    } finally {
      await target.close();
    }
  });
});

describe("traverseRelations — deadline budget", () => {
  it("stops the walk once the shared deadline has already passed", async () => {
    server = await chainServer();
    const budget = createRelationsTraversalBudget({ deadlineMs: 5000 });
    (budget as { startedAt: number }).startedAt = Date.now() - 10_000;
    await expect(
      traverseRelations(`${server.baseUrl}/entities/character/a.json`, { ...PERMISSIVE, budget })
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });
});

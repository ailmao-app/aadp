/**
 * Edge matrix row 2: `x_relations.items[].collection`.
 *
 * A collection is opt-in (`followCollections`, default `false`), paged by the
 * RELEASED Relations client, and bounded by the budget's six dimensions alone —
 * there is no page limit anywhere in this API (ADR-0011 §12.1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";
import {
  createRelationsTraversalBudget,
  type RelationTargetV1,
} from "../../../src/modules/relations/v1.0/index.js";
import { checksumOf } from "../../../src/canonical-json/checksum.js";
import { canonicalize } from "../../../src/canonical-json/canonicalize.js";
import { relationsTraversalAdapter } from "../../../src/traversal/v1.0/adapters/relations.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import { createAdapterLookup } from "../../../src/traversal/v1.0/registry.js";
import { planNodeExpansions } from "../../../src/traversal/v1.0/edge-planner.js";
import {
  runTraversalWalk,
  walkTraversal,
  type TraversalCollectionPager,
} from "../../../src/traversal/v1.0/state-machine.js";
import { collectGraphV1, type GraphTraversalOptions } from "../../../src/traversal/v1.0/index.js";
import { sendJson, startServer, type TestServer } from "../../modules/answer/v1.0/client/server-helpers.js";
import { entityOf } from "./entity-helpers.js";

const lookup = createAdapterLookup({ adapters: BUILTIN_TRAVERSAL_ADAPTERS });

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const COLLECTION_URL = "https://example.com/collections/related";

function relationSetWithCollection(): Record<string, unknown> {
  return {
    module: "aadp:relations",
    version: "1.0",
    kind: "relation-set",
    items: [
      {
        rel: "related",
        target_type: "document",
        cardinality: "many",
        collection: { url: COLLECTION_URL, pagination: "cursor" },
      },
    ],
  };
}

const sourceEntity = entityOf({
  id: "answer:a",
  type: "answer",
  canonical_url: "https://example.com/entities/answer/a.json",
  x_relations: relationSetWithCollection(),
});

const context = {
  depth: 0,
  nodeKey: "answer:a",
  followCollections: false,
  includeGeneratedSummarySources: false,
};

describe("planning a collection", () => {
  it("plans nothing by default", () => {
    const plan = planNodeExpansions(sourceEntity, context, lookup);
    expect(plan.collections).toEqual([]);
    expect(plan.edges).toEqual([]);
    expect(plan.expansions[0]).toMatchObject({ outcome: "no-edges", plannedEdges: 0 });
  });

  it("reports the collection once the caller opts in, without fetching it", () => {
    const plan = planNodeExpansions(sourceEntity, { ...context, followCollections: true }, lookup);
    expect(plan.collections).toEqual([
      {
        edgeGroup: "relations.collection",
        url: COLLECTION_URL,
        declaredTargetType: "document",
        extensionField: "x_relations",
        adapter: relationsTraversalAdapter.key,
        expectation: { sourceId: "answer:a", sourceType: "answer", rel: "related", targetType: "document" },
      },
    ]);
    // A collection is planned work even before it is paged.
    expect(plan.expansions[0]).toMatchObject({ outcome: "planned", plannedEdges: 1 });
  });
});

describe("paging a collection", () => {
  const pagedTargets: RelationTargetV1[] = [
    { id: "document:a", url: "https://example.com/entities/document/a.json" },
    { id: "document:b", url: "https://example.com/entities/document/b.json" },
  ];

  function walkWith(pageCollection: TraversalCollectionPager | undefined, followCollections = true) {
    const requested: string[] = [];
    return runTraversalWalk(sourceEntity, {
      rootUrl: "https://example.com/entities/answer/a.json",
      lookup,
      resolve: async (request) => {
        requested.push(request.url);
        const target = pagedTargets.find((t) => t.url === request.url);
        return target
          ? {
              status: "resolved",
              entity: entityOf({ id: target.id, type: "document", canonical_url: target.url }),
            }
          : { status: "not-found" };
      },
      pageCollection,
      maxDepth: 3,
      followCollections,
      includeGeneratedSummarySources: false,
    }).then((outcome) => ({ ...outcome, requested }));
  }

  const pager: TraversalCollectionPager = async function* () {
    for (const target of pagedTargets) yield target;
  };

  it("turns each page item into one relations.collection edge, in wire order", async () => {
    const outcome = await walkWith(pager);
    const edges = outcome.events.filter((e) => e.type === "edge").map((e) => (e.type === "edge" ? e.edge : null!));
    expect(edges.map((e) => [e.edgeGroup, e.index, e.declaredTargetType, e.outcome])).toEqual([
      ["relations.collection", 0, "document", "expanded"],
      ["relations.collection", 1, "document", "expanded"],
    ]);
    expect(outcome.requested).toEqual(pagedTargets.map((t) => t.url));
  });

  it("passes the collection URL and expectation to the pager", async () => {
    const seen: Array<{ url: string; expectation: unknown }> = [];
    const recording: TraversalCollectionPager = async function* (request) {
      seen.push({ url: request.url, expectation: request.expectation });
      for (const target of pagedTargets) yield target;
    };
    await walkWith(recording);
    expect(seen).toEqual([
      {
        url: COLLECTION_URL,
        expectation: { sourceId: "answer:a", sourceType: "answer", rel: "related", targetType: "document" },
      },
    ]);
  });

  it("pages nothing when the caller did not opt in", async () => {
    let paged = false;
    const spy: TraversalCollectionPager = async function* () {
      paged = true;
    };
    const outcome = await walkWith(spy, false);
    expect(paged).toBe(false);
    expect(outcome.events.filter((e) => e.type === "edge")).toEqual([]);
  });

  it("contains a failing collection to itself instead of failing the node", async () => {
    const failing: TraversalCollectionPager = async function* () {
      throw new Error("collection endpoint is broken");
    };
    const outcome = await walkWith(failing);
    expect(outcome.events.filter((e) => e.type === "edge")).toEqual([]);
    expect(outcome.events.some((e) => e.type === "node")).toBe(true);
  });

  it("reports a failing collection on the expansion record that owns it", async () => {
    const failing: TraversalCollectionPager = async function* () {
      throw new Error("404 Not Found");
    };
    const outcome = await walkWith(failing);
    const expansion = outcome.events.find((e) => e.type === "expansion");
    // A whole branch disappearing with nothing to diagnose is the failure mode
    // this guards: the consumer must be able to see which collection failed.
    expect(expansion && expansion.type === "expansion" && expansion.expansion.message).toContain(COLLECTION_URL);
    expect(expansion && expansion.type === "expansion" && expansion.expansion.message).toContain("404 Not Found");
  });

  it("puts a late failure on the expansion event, never on the node already delivered", async () => {
    const failing: TraversalCollectionPager = async function* () {
      throw new Error("blocked by URL policy");
    };
    const outcome = await walkWith(failing);

    // The node is emitted from pure planning, before any page is fetched, so its
    // snapshot cannot know about a failure that had not happened yet — and it
    // must not be mutated behind the consumer's back either.
    const node = outcome.events.find((e) => e.type === "node");
    const snapshot = node && node.type === "node" ? node.node.expansions : undefined;
    expect(snapshot?.[0]?.message).toBeUndefined();

    const expansion = outcome.events.find((e) => e.type === "expansion");
    expect(expansion && expansion.type === "expansion" && expansion.expansion.message).toContain(
      "blocked by URL policy"
    );
  });

  it("streams collection items instead of materializing the whole collection first", async () => {
    // A pager that blocks after its first item: the node and that item's edge
    // must already be observable while later pages are still outstanding.
    let releaseSecond: (() => void) | undefined;
    const blocking: TraversalCollectionPager = async function* () {
      yield pagedTargets[0]!;
      await new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      yield pagedTargets[1]!;
    };

    const events: string[] = [];
    const walk = walkTraversal(sourceEntity, {
      rootUrl: "https://example.com/entities/answer/a.json",
      lookup,
      resolve: async (request) => {
        const target = pagedTargets.find((t) => t.url === request.url);
        return target
          ? { status: "resolved", entity: entityOf({ id: target.id, type: "document", canonical_url: target.url }) }
          : { status: "not-found" };
      },
      pageCollection: blocking,
      maxDepth: 3,
      followCollections: true,
      includeGeneratedSummarySources: false,
    });

    // Drive the walk in the background so the pull that blocks on the pager
    // cannot deadlock the assertions.
    const draining = (async () => {
      for await (const event of walk) events.push(event.type);
    })();

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    // The node and the first item's edge are already observable while the
    // collection is still open — the walk is not holding it in memory.
    expect(events).toContain("node");
    expect(events.filter((type) => type === "edge")).toHaveLength(1);
    expect(releaseSecond).toBeDefined();

    releaseSecond!();
    await draining;
    expect(events.filter((type) => type === "edge")).toHaveLength(2);
    expect(events.indexOf("node")).toBe(0);
  });

  it("stops the walk when paging exhausts the budget", async () => {
    const exhausting: TraversalCollectionPager = async function* () {
      const err = new Error("budget gone");
      err.name = "AadpDiscoveryBudgetExceededError";
      throw err;
    };
    const outcome = await walkWith(exhausting);
    expect(outcome.summary).toMatchObject({ stopReason: "budget", partial: true });
  });
});

describe("over HTTP", () => {
  /** Two cursor pages, so a real `cursor.next` hop is exercised. */
  async function startCollectionServer(): Promise<TestServer> {
    const started = await startServer((_req, res, url) => {
      if (url.pathname === "/answer.json") {
        return sendJson(res, 200, {
          aadp_version: "1.0",
          id: "answer:a",
          type: "answer",
          checksum: checksumOf({}),
          updated_at: "2026-08-06T00:00:00Z",
          canonical_url: "https://example.com/answers/a",
          data: {},
          x_relations: {
            module: "aadp:relations",
            version: "1.0",
            kind: "relation-set",
            items: [
              {
                rel: "related",
                target_type: "document",
                cardinality: "many",
                collection: { url: `${started.baseUrl}/collection.json`, pagination: "cursor" },
              },
            ],
          },
        });
      }
      if (url.pathname === "/collection.json") {
        const cursor = url.searchParams.get("cursor");
        const items =
          cursor === "p2"
            ? [{ id: "document:b", url: `${started.baseUrl}/document-b.json` }]
            : [{ id: "document:a", url: `${started.baseUrl}/document-a.json` }];
        return sendJson(
          res,
          200,
          canonicalize({
            aadp_version: "1.0",
            module: "aadp:relations",
            module_version: "1.0",
            kind: "relation-collection",
            source: { id: "answer:a", type: "answer" },
            rel: "related",
            target_type: "document",
            generated_at: "2026-08-06T00:00:00Z",
            checksum: checksumOf(items),
            items,
            cursor: { next: cursor === "p2" ? null : "p2" },
          })
        );
      }
      if (url.pathname === "/document-a.json" || url.pathname === "/document-b.json") {
        const id = url.pathname === "/document-a.json" ? "document:a" : "document:b";
        return sendJson(res, 200, {
          aadp_version: "1.0",
          id,
          type: "document",
          checksum: checksumOf({}),
          updated_at: "2026-08-06T00:00:00Z",
          canonical_url: `https://example.com/documents/${id.split(":")[1]}`,
          data: {},
        });
      }
      return sendJson(res, 404, { error: "not found" });
    });
    return started;
  }

  const urlPolicy = createPermissiveUrlPolicy();

  function options(over: Partial<GraphTraversalOptions> = {}): GraphTraversalOptions {
    return {
      budget: createRelationsTraversalBudget(),
      adapters: BUILTIN_TRAVERSAL_ADAPTERS,
      urlPolicy,
      ...over,
    };
  }

  it("follows the cursor across pages and expands every item", async () => {
    server = await startCollectionServer();
    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ followCollections: true }));

    expect(graph.edges.map((e) => `${e.edgeGroup}#${e.index}:${e.outcome}`)).toEqual([
      "relations.collection#0:expanded",
      "relations.collection#1:expanded",
    ]);
    expect(graph.nodes.map((n) => n.status)).toEqual(["resolved", "resolved", "resolved"]);
    expect(server.requestLog.filter((p) => p === "/collection.json")).toHaveLength(2);
  });

  it("does not touch the collection endpoint by default", async () => {
    server = await startCollectionServer();
    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options());
    expect(server.requestLog).toEqual(["/answer.json"]);
    expect(graph.edges).toEqual([]);
  });

  it("charges collection pages against the caller's budget", async () => {
    server = await startCollectionServer();
    const budget = createRelationsTraversalBudget();
    await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget, followCollections: true }));
    // Root, two pages and two documents — every hop went through the budget.
    expect(budget.requestsMade).toBe(5);
    expect(budget.nodesVisited).toBe(3);
  });
});

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

  it.each([
    ["404", () => new Error("404 Not Found")],
    ["blocked URL", () => Object.assign(new Error("blocked"), { name: "BlockedUrlError" })],
    ["invalid page", () => Object.assign(new Error("schema"), { name: "AadpSchemaValidationError" })],
    ["cursor cycle", () => Object.assign(new Error("cursor repeated"), { name: "RelationsCursorCycleError" })],
  ])("reports a walk truncated by %s as partial while the scheduler still exhausts", async (_label, makeError) => {
    const failing: TraversalCollectionPager = async function* () {
      throw makeError();
    };
    const outcome = await walkWith(failing);
    // The two fields answer different questions: the scheduler DID run out of
    // work, and the graph IS missing a branch.
    expect(outcome.summary.stopReason).toBe("exhausted");
    expect(outcome.summary.partial).toBe(true);
  });

  it("leaves a cleanly paged collection non-partial", async () => {
    const outcome = await walkWith(pager);
    expect(outcome.summary).toMatchObject({ stopReason: "exhausted", partial: false });
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

  /**
   * A root with BOTH a collection (`relations.collection`, rank 1) and an answer
   * reference (`answer.related_entity`, rank 2), so there is real later-group
   * work for a prefetch to reach across the collection boundary and start.
   *
   * `delays` lets the same graph be served with the two branches completing in
   * opposite orders.
   */
  async function startBoundaryServer(delays: { collection?: number; claim?: number } = {}): Promise<TestServer> {
    const sealedAnswer = (base: string) => {
      const wrapper: Record<string, unknown> = {
        module: "aadp:answer",
        version: "1.0",
        kind: "answer",
        question: "Does prefetch cross the collection boundary?",
        concise_answer: "It must not.",
        locale: "en",
        authorship: { kind: "source-authored", author: { name: "AADP tests" } },
        freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
        related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: `${base}/claim.json` } }],
      };
      return { ...wrapper, content_checksum: checksumOf(wrapper) };
    };

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
          x_answer: sealedAnswer(started.baseUrl),
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
        // An empty page: the collection costs one request and produces no item
        // that could compete for the budget itself.
        const body = canonicalize({
          aadp_version: "1.0",
          module: "aadp:relations",
          module_version: "1.0",
          kind: "relation-collection",
          source: { id: "answer:a", type: "answer" },
          rel: "related",
          target_type: "document",
          generated_at: "2026-08-06T00:00:00Z",
          checksum: checksumOf([]),
          items: [],
          cursor: { next: null },
        });
        if (delays.collection) return void setTimeout(() => sendJson(res, 200, body), delays.collection);
        return sendJson(res, 200, body);
      }
      if (url.pathname === "/claim.json") {
        const body = {
          aadp_version: "1.0",
          id: "claim:c1",
          type: "claim",
          checksum: checksumOf({}),
          updated_at: "2026-08-06T00:00:00Z",
          canonical_url: "https://example.com/claims/c1",
          data: {},
        };
        if (delays.claim) return void setTimeout(() => sendJson(res, 200, body), delays.claim);
        return sendJson(res, 200, body);
      }
      return sendJson(res, 404, { error: "not found" });
    });
    return started;
  }

  it("does not start a later-group fetch while a collection is still paging", async () => {
    server = await startBoundaryServer();
    // Room for the root and the collection page. A prefetch reaching across the
    // boundary would spend the second request on the claim instead, and which
    // branch survived would then depend on completion timing.
    const budget = createRelationsTraversalBudget({ maxRequests: 2 });
    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget, followCollections: true }));

    expect(server.requestLog).toEqual(["/answer.json", "/collection.json"]);
    expect(server.requestLog).not.toContain("/claim.json");

    // The later-group edge was planned and reported — it simply was never paid
    // for, which is what makes this a schedule boundary rather than a drop.
    const later = graph.edges.find((edge) => edge.edgeGroup === "answer.related_entity");
    expect(later).toBeDefined();
    expect(later!.status).toBe("budget-exhausted");
    expect(graph.summary.partial).toBe(true);
  });

  it("produces the same result whichever branch would have completed first", async () => {
    const shapeOf = (graph: Awaited<ReturnType<typeof collectGraphV1>>) =>
      graph.edges.map((edge) => `${edge.edgeGroup}#${edge.index}:${edge.outcome}:${edge.status ?? "-"}`);

    server = await startBoundaryServer({ collection: 25 });
    const slowCollection = await collectGraphV1(
      `${server.baseUrl}/answer.json`,
      options({ budget: createRelationsTraversalBudget({ maxRequests: 2 }), followCollections: true })
    );
    const slowCollectionLog = [...server.requestLog];
    await server.close();

    server = await startBoundaryServer({ claim: 25 });
    const slowClaim = await collectGraphV1(
      `${server.baseUrl}/answer.json`,
      options({ budget: createRelationsTraversalBudget({ maxRequests: 2 }), followCollections: true })
    );

    expect(shapeOf(slowClaim)).toEqual(shapeOf(slowCollection));
    expect(server.requestLog).toEqual(slowCollectionLog);
    expect(slowClaim.summary.stopReason).toBe(slowCollection.summary.stopReason);
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

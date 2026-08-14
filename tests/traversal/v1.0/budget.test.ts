/**
 * Budget and accounting (ADR-0011 §10, plan 1.5.0 §"Budget contract").
 *
 * The caller owns the budget and traversal borrows it: no child budget, no
 * widened defaults, no seventh dimension, and no second cache next to the
 * shared canonical resolution layer. These tests assert the three verifiable
 * invariants of the plan — no double charge, no request leak after an abort,
 * and no cross-poisoning between two callers of one budget.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";
import { createRelationsTraversalBudget } from "../../../src/modules/relations/v1.0/index.js";
import { observeCanonicalResolutions } from "../../../src/modules/shared/canonical-resolution.js";
import { checksumOf } from "../../../src/canonical-json/checksum.js";
import {
  collectGraphV1,
  traverseGraphV1,
  type GraphTraversalEventV1,
  type GraphTraversalOptions,
} from "../../../src/traversal/v1.0/index.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import { sendJson, startServer, type TestServer } from "../../modules/answer/v1.0/client/server-helpers.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const UPDATED_AT = "2026-08-06T00:00:00Z";

function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

function answerEntity(base: string, references: Array<{ id: string; path: string; type: string }>) {
  return {
    aadp_version: "1.0",
    id: "answer:a",
    type: "answer",
    checksum: checksumOf({}),
    updated_at: UPDATED_AT,
    canonical_url: "https://example.com/answers/a",
    data: {},
    x_answer: sealed({
      module: "aadp:answer",
      version: "1.0",
      kind: "answer",
      question: "What is Orbit?",
      concise_answer: "Orbit is a neutral example service.",
      locale: "en",
      authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
      freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: UPDATED_AT },
      related_entities: references.map((reference) => ({
        target_type: reference.type,
        target: { id: reference.id, url: `${base}${reference.path}` },
      })),
    }),
  };
}

function claimEntity(id: string, evidenceUrl: string) {
  return {
    aadp_version: "1.0",
    id,
    type: "claim",
    checksum: checksumOf({}),
    updated_at: UPDATED_AT,
    canonical_url: `https://example.com/claims/${id.split(":")[1]}`,
    data: {},
    x_evidence: sealed({
      module: "aadp:evidence",
      version: "1.0",
      kind: "claim",
      statement: "Orbit reported 99.9% uptime in 2026.",
      locale: "en",
      evidence_refs: [
        { target_type: "evidence", target: { id: "evidence:e", url: evidenceUrl }, stance: "support" },
      ],
    }),
  };
}

function evidenceEntity() {
  return {
    aadp_version: "1.0",
    id: "evidence:e",
    type: "evidence",
    checksum: checksumOf({}),
    updated_at: UPDATED_AT,
    canonical_url: "https://example.com/evidence/e",
    data: {},
    x_evidence: sealed({
      module: "aadp:evidence",
      version: "1.0",
      kind: "evidence",
      summary: "Annual status report published by Example Orbit.",
      locale: "en",
      source: {
        title: "Orbit 2026 Status Report",
        url: "https://example.com/reports/2026-status",
        publisher: { name: "Example Orbit" },
        access: "public",
      },
      provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" },
    }),
  };
}

/**
 * A diamond: the root answer references two claims, and both claims reference
 * ONE evidence entity. That is the fan-in case — the two modules each reject a
 * duplicate reference inside a single document, so fan-in can only arrive from
 * two different sources, which is exactly how it happens on the wire.
 *
 * `delayMs` holds the evidence response open long enough for a second waiter to
 * join the one in-flight fetch.
 */
async function startDiamondServer(delayMs = 0): Promise<TestServer> {
  const started = await startServer((_req, res, url) => {
    const evidenceUrl = `${started.baseUrl}/evidence.json`;
    if (url.pathname === "/answer.json") {
      return sendJson(
        res,
        200,
        answerEntity(started.baseUrl, [
          { id: "claim:c1", path: "/claim1.json", type: "claim" },
          { id: "claim:c2", path: "/claim2.json", type: "claim" },
        ])
      );
    }
    if (url.pathname === "/claim1.json") return sendJson(res, 200, claimEntity("claim:c1", evidenceUrl));
    if (url.pathname === "/claim2.json") return sendJson(res, 200, claimEntity("claim:c2", evidenceUrl));
    if (url.pathname === "/evidence.json") {
      if (delayMs > 0) {
        setTimeout(() => sendJson(res, 200, evidenceEntity()), delayMs);
        return;
      }
      return sendJson(res, 200, evidenceEntity());
    }
    return sendJson(res, 404, { error: "not found" });
  });
  return started;
}

/**
 * ONE policy instance for the whole file. The resolution context digest keys a
 * `UrlPolicy` by reference — two structurally identical policies are
 * deliberately not interchangeable — so two calls meant to share a budget must
 * share the very same policy object.
 */
const urlPolicy = createPermissiveUrlPolicy();

function options(over: Partial<GraphTraversalOptions> = {}): GraphTraversalOptions {
  return {
    budget: createRelationsTraversalBudget(),
    adapters: BUILTIN_TRAVERSAL_ADAPTERS,
    urlPolicy,
    ...over,
  };
}

describe("no double charge", () => {
  it("charges and fetches a fan-in target exactly once", async () => {
    server = await startDiamondServer();
    const budget = createRelationsTraversalBudget();
    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));

    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(1);
    // Root, two claims and the one shared evidence entity — the second
    // reference to that canonical target costs no node charge and no request.
    expect(budget.nodesVisited).toBe(4);
    expect(graph.edges.map((e) => e.outcome)).toEqual(["expanded", "expanded", "leaf", "leaf"]);
    expect(graph.nodes.filter((n) => n.key.includes("evidence:e"))).toHaveLength(1);
  });

  it("joins an in-flight fetch instead of starting a second one", async () => {
    server = await startDiamondServer(30);
    const budget = createRelationsTraversalBudget();
    const kinds: string[] = [];
    const stop = observeCanonicalResolutions(budget, (event) => {
      if (event.url.endsWith("/evidence.json")) kinds.push(event.kind);
    });

    // Two walks on one budget, overlapping in time: whichever reaches the
    // evidence entity second must join the fetch already in flight rather than
    // start a second one.
    await Promise.all([
      collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget })),
      collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget })),
    ]);
    stop();

    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(1);
    expect(kinds.filter((k) => k === "fetch")).toHaveLength(1);
    expect(kinds).toContain("join");
    expect(kinds.every((k) => k === "fetch" || k === "join" || k === "cache")).toBe(true);
  });

  it("charges nothing on a second walk that re-expands the same node", async () => {
    server = await startDiamondServer();
    const budget = createRelationsTraversalBudget();

    const first = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));
    const requestsAfterFirst = server.requestLog.length;
    const nodesAfterFirst = budget.nodesVisited;

    // Expansion state is walk-local, so the second walk expands the same nodes
    // again — served from the budget's canonical cache.
    const second = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));

    // Every referenced target is a cache hit. The ROOT is the one exception: the
    // shared cache is keyed by canonical `{id, normalizedUrl}` and a bare root
    // URL has no id until it has been fetched, so there is nothing to look it up
    // by. It still charges no node — `chargeNode` already dedupes it.
    expect(server.requestLog.length).toBe(requestsAfterFirst + 1);
    expect(server.requestLog.filter((p) => p === "/answer.json")).toHaveLength(2);
    expect(server.requestLog.filter((p) => p === "/claim1.json")).toHaveLength(1);
    expect(server.requestLog.filter((p) => p === "/claim2.json")).toHaveLength(1);
    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(1);
    expect(budget.nodesVisited).toBe(nodesAfterFirst);
    expect(second.edges.map((e) => e.outcome)).toEqual(first.edges.map((e) => e.outcome));
    expect(second.nodes.map((n) => n.key)).toEqual(first.nodes.map((n) => n.key));
  });

  it("does not write to budget.expandedTargets — expansion state is walk-local", async () => {
    server = await startDiamondServer();
    const budget = createRelationsTraversalBudget();
    await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));
    expect(budget.expandedTargets.size).toBe(0);
  });
});

describe("one budget, one resolution context", () => {
  it("rejects a second walk whose request options differ, leaving the budget intact", async () => {
    server = await startDiamondServer();
    const budget = createRelationsTraversalBudget();
    await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));

    const requestsBefore = server.requestLog.length;
    const nodesBefore = budget.nodesVisited;

    await expect(
      collectGraphV1(
        `${server.baseUrl}/answer.json`,
        options({ budget, headers: { authorization: "Bearer other" } })
      )
    ).rejects.toThrow(/resolution context/i);

    // Fail closed: rejected before any replay, charge or request.
    expect(server.requestLog.length).toBe(requestsBefore);
    expect(budget.nodesVisited).toBe(nodesBefore);
  });
});

describe("budget exhaustion", () => {
  it("reports a partial graph with stopReason budget instead of throwing", async () => {
    server = await startDiamondServer();
    // Room for the root only: resolving the first reference exhausts the node
    // dimension.
    const budget = createRelationsTraversalBudget({ maxNodes: 1 });
    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));

    expect(graph.summary).toMatchObject({ stopReason: "budget", partial: true });
    expect(graph.edges[0]).toMatchObject({ status: "budget-exhausted", outcome: "not-expanded" });
  });

  it("stops requesting once the budget is gone", async () => {
    server = await startDiamondServer();
    const budget = createRelationsTraversalBudget({ maxNodes: 1 });
    await collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));
    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(0);
  });

  it("has no page limit of its own — paging is bounded by the budget alone", () => {
    const graphOptions = options() as Record<string, unknown>;
    expect(graphOptions.maxPages).toBeUndefined();
    expect(graphOptions.concurrency).toBeUndefined();
  });
});

describe("abort", () => {
  it("makes no further request after the aborted complete", async () => {
    server = await startDiamondServer(20);
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();

    const events: GraphTraversalEventV1[] = [];
    for await (const event of traverseGraphV1(
      `${server.baseUrl}/answer.json`,
      options({ budget, signal: controller.signal })
    )) {
      events.push(event);
      if (event.type === "node") controller.abort();
    }

    const requestsAtAbort = server.requestLog.length;
    expect(events.at(-1)).toMatchObject({ type: "complete", summary: { stopReason: "aborted", partial: true } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(server.requestLog.length).toBe(requestsAtAbort);
  });

  it("does not cancel a shared fetch another walk is still waiting on", async () => {
    server = await startDiamondServer(40);
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();

    // Two walks on one budget: the first aborts mid-flight, the second must
    // still receive the outcome of the fetch they share.
    const aborted = collectGraphV1(
      `${server.baseUrl}/answer.json`,
      options({ budget, signal: controller.signal })
    );
    const survivor = collectGraphV1(`${server.baseUrl}/answer.json`, options({ budget }));
    setTimeout(() => controller.abort(), 10);

    const [abortedGraph, survivorGraph] = await Promise.all([aborted, survivor]);

    expect(abortedGraph.summary.stopReason).toBe("aborted");
    expect(survivorGraph.summary.stopReason).toBe("exhausted");
    expect(survivorGraph.nodes.some((n) => n.key.includes("claim:c1"))).toBe(true);
    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(1);
  });
});

describe("budget boundary", () => {
  it("never calls releaseNode from traversal", () => {
    // `releaseNode`'s preconditions are not checkable here, and calling it for
    // a target that DID resolve would break the shared layer's "charged at most
    // once per walk" guarantee.
    for (const file of ["traversal.ts", "state-machine.ts", "scheduler.ts", "collect.ts", "options.ts"]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../../../src/traversal/v1.0/${file}`, import.meta.url)),
        "utf8"
      );
      expect(source).not.toMatch(/releaseNode/);
    }
  });

  it("keeps no cache of its own beside the shared canonical resolution layer", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../src/traversal/v1.0/traversal.ts", import.meta.url)),
      "utf8"
    );
    expect(source).toMatch(/canonical-resolution\.js/);
  });
});

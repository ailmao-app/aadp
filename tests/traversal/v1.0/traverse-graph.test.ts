/**
 * `traverseGraphV1`/`collectGraphV1` end to end over a real HTTP server: the
 * public entry points, the shared canonical resolution behind them, and the
 * "stream and collected graph agree" property that makes `collectGraphV1` a
 * drain rather than a second traversal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";
import { createRelationsTraversalBudget } from "../../../src/modules/relations/v1.0/index.js";
import {
  collectGraphV1,
  InvalidGraphTraversalOptionsError,
  traverseGraphV1,
  type GraphTraversalEventV1,
  type GraphTraversalOptions,
} from "../../../src/traversal/v1.0/index.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import { checksumOf } from "../../../src/canonical-json/checksum.js";
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

/**
 * Serves an answer root that references a claim, and a claim that references an
 * evidence entity — the plan's sequence example, over HTTP.
 */
async function startGraphServer(): Promise<TestServer> {
  const started = await startServer((_req, res, url) => {
    const base = started.baseUrl;
    if (url.pathname === "/answer.json") {
      return sendJson(res, 200, {
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
          related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: `${base}/claim.json` } }],
        }),
      });
    }
    if (url.pathname === "/claim.json") {
      return sendJson(res, 200, {
        aadp_version: "1.0",
        id: "claim:c1",
        type: "claim",
        checksum: checksumOf({}),
        updated_at: UPDATED_AT,
        canonical_url: "https://example.com/claims/c1",
        data: {},
        x_evidence: sealed({
          module: "aadp:evidence",
          version: "1.0",
          kind: "claim",
          statement: "Orbit reported 99.9% uptime in 2026.",
          locale: "en",
          evidence_refs: [
            {
              target_type: "evidence",
              target: { id: "evidence:e", url: `${base}/evidence.json` },
              stance: "support",
            },
          ],
        }),
      });
    }
    if (url.pathname === "/evidence.json") {
      return sendJson(res, 200, {
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
      });
    }
    return sendJson(res, 404, { error: "not found" });
  });
  return started;
}

function options(over: Partial<GraphTraversalOptions> = {}): GraphTraversalOptions {
  return {
    budget: createRelationsTraversalBudget(),
    adapters: BUILTIN_TRAVERSAL_ADAPTERS,
    urlPolicy: createPermissiveUrlPolicy(),
    ...over,
  };
}

const shape = (events: GraphTraversalEventV1[]): string[] =>
  events.map((event) => {
    switch (event.type) {
      case "node":
        return `node:${event.node.key}:${event.node.status}`;
      case "reference":
        return `reference:${event.reference.edgeGroup}#${event.reference.index}:${event.reference.status}`;
      case "edge":
        return `edge:${event.edge.edgeGroup}#${event.edge.index}:${event.edge.outcome}`;
      case "expansion":
        return `expansion:${event.expansion.extensionField}:${event.expansion.outcome}`;
      case "complete":
        return `complete:${event.summary.stopReason}`;
    }
  });

describe("traverseGraphV1 over HTTP", () => {
  it("walks answer → claim → evidence and ends with one complete", async () => {
    server = await startGraphServer();
    const events: GraphTraversalEventV1[] = [];
    for await (const event of traverseGraphV1(`${server.baseUrl}/answer.json`, options())) {
      events.push(event);
    }

    expect(shape(events)).toEqual([
      "node:answer:a\0" + `${server.baseUrl}/answer.json:resolved`,
      "edge:answer.related_entity#0:expanded",
      "reference:answer.related_entity#0:resolved",
      "expansion:x_answer:planned",
      "node:claim:c1\0" + `${server.baseUrl}/claim.json:resolved`,
      "edge:evidence.evidence_ref#0:leaf",
      "expansion:x_evidence:planned",
      "node:evidence:e\0" + `${server.baseUrl}/evidence.json:resolved`,
      "complete:exhausted",
    ]);
  });

  it("fetches each entity exactly once", async () => {
    server = await startGraphServer();
    await collectGraphV1(`${server.baseUrl}/answer.json`, options());
    expect(server.requestLog.filter((p) => p === "/evidence.json")).toHaveLength(1);
    expect(server.requestLog.sort()).toEqual(["/answer.json", "/claim.json", "/evidence.json"]);
  });

  it("never fetches an evidence entity's source metadata", async () => {
    server = await startGraphServer();
    await collectGraphV1(`${server.baseUrl}/answer.json`, options());
    expect(server.requestLog).not.toContain("/reports/2026-status");
  });

  it("agrees with collectGraphV1 on content and order", async () => {
    server = await startGraphServer();
    const streamed: GraphTraversalEventV1[] = [];
    for await (const event of traverseGraphV1(`${server.baseUrl}/answer.json`, options())) {
      streamed.push(event);
    }
    const collected = await collectGraphV1(`${server.baseUrl}/answer.json`, options());

    expect(collected.nodes.map((n) => n.key)).toEqual(
      streamed.filter((e) => e.type === "node").map((e) => (e.type === "node" ? e.node.key : ""))
    );
    expect(collected.edges.map((e) => `${e.edgeGroup}#${e.index}:${e.outcome}`)).toEqual(
      streamed
        .filter((e) => e.type === "edge")
        .map((e) => (e.type === "edge" ? `${e.edge.edgeGroup}#${e.edge.index}:${e.edge.outcome}` : ""))
    );
    expect(collected.references).toHaveLength(1);
    expect(collected.expansions.map((x) => x.outcome)).toEqual(["planned", "planned"]);
    expect(collected.summary).toMatchObject({ stopReason: "exhausted", partial: false, nodes: 3, edges: 2 });
  });

  it("reports an unreachable target as a node status instead of throwing", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/answer.json") {
        return sendJson(res, 200, {
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
            related_entities: [
              { target_type: "claim", target: { id: "claim:missing", url: `${server!.baseUrl}/missing.json` } },
            ],
          }),
        });
      }
      return sendJson(res, 404, { error: "not found" });
    });

    const graph = await collectGraphV1(`${server.baseUrl}/answer.json`, options());
    expect(graph.edges[0]).toMatchObject({ outcome: "not-expanded", status: "not-found" });
    expect(graph.summary.partial).toBe(false);
  });

  it("reports a root that 404s as a node, with no edges", async () => {
    server = await startServer((_req, res) => sendJson(res, 404, { error: "not found" }));
    const graph = await collectGraphV1(`${server.baseUrl}/missing.json`, options());
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.status).toBe("not-found");
    expect(graph.edges).toEqual([]);
  });
});

describe("invalid options", () => {
  it("throws before the first request", async () => {
    server = await startGraphServer();
    expect(() =>
      traverseGraphV1(`${server!.baseUrl}/answer.json`, options({ rootOrigin: "https://other.example" }))
    ).toThrow(InvalidGraphTraversalOptionsError);
    expect(server.requestLog).toEqual([]);
  });

  it("throws synchronously from collectGraphV1 too", async () => {
    server = await startGraphServer();
    await expect(collectGraphV1(`${server.baseUrl}/answer.json`, options({ rootOrigin: "https://nope.example" }))).rejects.toThrow(
      InvalidGraphTraversalOptionsError
    );
    expect(server.requestLog).toEqual([]);
  });
});

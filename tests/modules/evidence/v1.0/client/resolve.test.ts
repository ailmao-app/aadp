/**
 * The Evidence `1.0` orchestration contract (specification.md §10.4-10.5):
 * the two-hop walk, fan-in deduplication, per-occurrence verdicts, dangling
 * classification, partial results, and the boundary that keeps
 * `authorship.source_targets` out of an Evidence walk.
 *
 * Entities are built INSIDE the request handler, after the server has bound
 * a port, because a claim has to cite an absolute URL on that very origin.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy, createStrictUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { resolveAnswerEvidenceV1, resolveClaimEvidenceV1 } from "../../../../../src/modules/evidence/v1.0/client/resolve.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import type { EvidenceClaimDocumentV1 } from "../../../../../src/modules/evidence/v1.0/types.js";
import type { EvidenceGraph } from "../../../../../src/modules/evidence/v1.0/client/types.js";
import {
  buildClaimEntity,
  buildClaimWrapper,
  buildEvidenceEntity,
  buildXAnswer,
  sendJson,
  startServer,
  type TestServer,
} from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

const claimPath = (slug: string) => `/entities/claim/${slug}.json`;
const evidencePath = (slug: string) => `/entities/evidence/${slug}.json`;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * A deployment of claims and evidence.
 *
 * `claims` maps a slug to the evidence slugs it cites; `evidence` lists the
 * evidence slugs that exist. `status` overrides a path with a bare HTTP
 * status, and `broken` serves a structurally invalid Evidence document.
 */
interface Deployment {
  claims?: Record<string, string[]>;
  evidence?: string[];
  status?: Record<string, number>;
  broken?: string[];
}

async function startDeployment(deployment: Deployment): Promise<TestServer> {
  let base = "";
  const created = await startServer((_req, res, url) => {
    const statusOverride = deployment.status?.[url.pathname];
    if (statusOverride !== undefined) return sendJson(res, statusOverride, { error: "denied" });

    for (const [slug, cites] of Object.entries(deployment.claims ?? {})) {
      if (url.pathname === claimPath(slug)) {
        return sendJson(
          res,
          200,
          buildClaimEntity(
            slug,
            cites.map((evidenceSlug) => ({ id: `evidence:${evidenceSlug}`, url: `${base}${evidencePath(evidenceSlug)}` }))
          )
        );
      }
    }
    for (const slug of deployment.evidence ?? []) {
      if (url.pathname === evidencePath(slug)) {
        if (deployment.broken?.includes(slug)) {
          // A 200 that is NOT a usable Evidence entity: `summary` is missing,
          // so the wrapper fails its own schema.
          return sendJson(res, 200, buildEvidenceEntity(slug, { x_evidence: { module: "aadp:evidence", version: "1.0", kind: "evidence" } }));
        }
        return sendJson(res, 200, buildEvidenceEntity(slug));
      }
    }
    sendJson(res, 404, { error: "not_found" });
  });
  base = created.baseUrl;
  return created;
}

function answerCiting(refs: Array<{ type: string; id: string; url: string }>, overrides: Record<string, unknown> = {}): AnswerDocumentV1 {
  return buildXAnswer({
    related_entities: refs.map((ref) => ({ target_type: ref.type, target: { id: ref.id, url: ref.url } })),
    ...overrides,
  }) as unknown as AnswerDocumentV1;
}

const budget = () => createRelationsTraversalBudget();

const countRequests = (log: string[], pathname: string) => log.filter((entry) => entry === pathname).length;

/** Order-insensitive shape, for the two mixed-ordering equivalence tests. */
function shapeOf(graph: EvidenceGraph) {
  const sortKey = (v: string) => v;
  return {
    nodes: graph.nodes
      .map((n) => ({ key: n.key, kind: n.kind, status: n.status }))
      .sort((a, b) => sortKey(a.key).localeCompare(sortKey(b.key))),
    edges: graph.edges
      .map((e) => ({ from: e.from, to: e.to, index: e.index, status: e.status }))
      .sort((a, b) => `${a.from}|${a.to}|${a.index}`.localeCompare(`${b.from}|${b.to}|${b.index}`)),
    references: graph.references
      .map((r) => ({ key: r.key, status: r.status, targetType: r.reference.target_type }))
      .sort((a, b) => `${a.key}|${a.targetType}`.localeCompare(`${b.key}|${b.targetType}`)),
    partial: graph.partial,
  };
}

describe("two-hop expansion", () => {
  it("resolves answer → claim → evidence, recording both nodes and the edge", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(graph.partial).toBe(false);
    expect(graph.references.map((r) => ({ index: r.index, status: r.status }))).toEqual([{ index: 0, status: "resolved" }]);
    expect(graph.nodes.map((n) => n.kind)).toEqual(["claim", "evidence"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ index: 0, stance: "support", status: "resolved", from: graph.nodes[0].key, to: graph.nodes[1].key });
  });

  it("does not expand past evidence — evidence is a leaf", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(countRequests(server.requestLog, evidencePath("report"))).toBe(1);
    expect(server.requestLog).toHaveLength(2);
  });

  it("ignores related_entities whose target_type is neither claim nor evidence, without fetching them", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const answer = answerCiting([
      { type: "note", id: "note:welcome", url: `${server.baseUrl}/entities/note/welcome.json` },
      { type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` },
    ]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(graph.references.map((r) => r.index)).toEqual([1]); // the ORIGINAL index, not a filtered one
    expect(server.requestLog).not.toContain("/entities/note/welcome.json");
  });
});

describe("fan-in deduplication", () => {
  it("fetches one evidence target exactly once however many claims cite it", async () => {
    server = await startDeployment({ claims: { first: ["report"], second: ["report"] }, evidence: ["report"] });
    const answer = answerCiting([
      { type: "claim", id: "claim:first", url: `${server.baseUrl}${claimPath("first")}` },
      { type: "claim", id: "claim:second", url: `${server.baseUrl}${claimPath("second")}` },
    ]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(countRequests(server.requestLog, evidencePath("report"))).toBe(1);
    // One node for the shared target, but both edges are kept.
    expect(graph.nodes.filter((n) => n.kind === "evidence")).toHaveLength(1);
    expect(graph.edges.map((e) => e.status)).toEqual(["resolved", "resolved"]);
    expect(new Set(graph.edges.map((e) => e.to)).size).toBe(1);
    expect(new Set(graph.edges.map((e) => e.from)).size).toBe(2);
  });

  it("orders edges by (claim discovery index, ref index)", async () => {
    server = await startDeployment({ claims: { first: ["a", "b"], second: ["b", "c"] }, evidence: ["a", "b", "c"] });
    const answer = answerCiting([
      { type: "claim", id: "claim:first", url: `${server.baseUrl}${claimPath("first")}` },
      { type: "claim", id: "claim:second", url: `${server.baseUrl}${claimPath("second")}` },
    ]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    const firstKey = graph.nodes.find((n) => n.entity?.id === "claim:first")!.key;
    const secondKey = graph.nodes.find((n) => n.entity?.id === "claim:second")!.key;
    expect(graph.edges.map((e) => [e.from === firstKey ? "first" : "second", e.index])).toEqual([
      ["first", 0],
      ["first", 1],
      ["second", 0],
      ["second", 1],
    ]);
  });
});

describe("mixed ordering and mixed types produce order-independent results", () => {
  it("gives an equivalent graph whether the answer cites E before C1 or after", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const evidenceRef = { type: "evidence", id: "evidence:report", url: `${server.baseUrl}${evidencePath("report")}` };
    const claimRef = { type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` };

    const evidenceFirst = await resolveAnswerEvidenceV1(answerCiting([evidenceRef, claimRef]), { ...PERMISSIVE, budget: budget() });
    const requestsA = countRequests(server.requestLog, evidencePath("report"));

    server.requestLog.length = 0;
    const claimFirst = await resolveAnswerEvidenceV1(answerCiting([claimRef, evidenceRef]), { ...PERMISSIVE, budget: budget() });
    const requestsB = countRequests(server.requestLog, evidencePath("report"));

    expect(shapeOf(evidenceFirst)).toEqual(shapeOf(claimFirst));
    expect([requestsA, requestsB]).toEqual([1, 1]);
  });

  it("keeps a wrong target_type verdict local to its own occurrence, in both orders", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    // The answer mis-declares the evidence target as a claim; the claim
    // declares the same canonical target correctly.
    const wrongTypeRef = { type: "claim", id: "evidence:report", url: `${server.baseUrl}${evidencePath("report")}` };
    const claimRef = { type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` };

    const wrongFirst = await resolveAnswerEvidenceV1(answerCiting([wrongTypeRef, claimRef]), { ...PERMISSIVE, budget: budget() });
    const requestsA = countRequests(server.requestLog, evidencePath("report"));
    server.requestLog.length = 0;
    const wrongLast = await resolveAnswerEvidenceV1(answerCiting([claimRef, wrongTypeRef]), { ...PERMISSIVE, budget: budget() });
    const requestsB = countRequests(server.requestLog, evidencePath("report"));

    for (const graph of [wrongFirst, wrongLast]) {
      // The mis-declared reference is invalid for ITSELF...
      const mistyped = graph.references.find((r) => r.reference.target.id === "evidence:report")!;
      expect(mistyped.status).toBe("invalid");
      // ...while the claim's own correctly-typed edge to the same canonical
      // target still resolves, off the same single fetch.
      expect(graph.edges.map((e) => e.status)).toEqual(["resolved"]);
      // The node itself carries the canonical outcome, never a verdict.
      expect(graph.nodes.find((n) => n.key === mistyped.key)!.status).toBe("resolved");
    }
    expect(shapeOf(wrongFirst)).toEqual(shapeOf(wrongLast));
    expect([requestsA, requestsB]).toEqual([1, 1]);
  });
});

describe("dangling classification (specification.md §10.2)", () => {
  it("classifies 404 as not-found (dangling)", async () => {
    server = await startDeployment({ claims: { uptime: ["missing"] }, evidence: [] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(graph.edges.map((e) => e.status)).toEqual(["not-found"]);
  });

  it("classifies 401/403 as forbidden — access control, not a broken graph", async () => {
    server = await startDeployment({
      claims: { uptime: ["locked", "denied"] },
      evidence: ["locked", "denied"],
      status: { [evidencePath("locked")]: 401, [evidencePath("denied")]: 403 },
    });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(graph.edges.map((e) => e.status)).toEqual(["forbidden", "forbidden"]);
  });

  it("classifies a 200 that is not a valid Evidence entity as invalid (dangling)", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"], broken: ["report"] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(graph.edges.map((e) => e.status)).toEqual(["invalid"]);
    expect(graph.edges[0].message).toContain("not a valid Evidence 1.0 entity");
  });

  it("classifies a target the URL policy refuses as forbidden, not a dangling reference", async () => {
    // 127.0.0.1 is a private address the strict policy blocks before any
    // request is made — access control, per specification.md §10.2.
    server = await startDeployment({ evidence: ["report"] });
    const claim = buildClaimWrapper([{ id: "evidence:report", url: `${server.baseUrl}${evidencePath("report")}` }]) as unknown as EvidenceClaimDocumentV1;

    const graph = await resolveClaimEvidenceV1(claim, { urlPolicy: createStrictUrlPolicy(), budget: budget() });

    expect(graph.edges.map((e) => e.status)).toEqual(["forbidden"]);
    expect(server.requestLog).toEqual([]);
  });

  it("keeps the edge even when its target node did not resolve", async () => {
    server = await startDeployment({ claims: { uptime: ["missing"] }, evidence: [] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    // "no ref" and "a ref whose fetch failed" must stay distinguishable.
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes.some((n) => n.key === graph.edges[0].to && n.status === "not-found")).toBe(true);
  });
});

describe("composition boundary with Answer", () => {
  it("never fetches authorship.source_targets", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const answer = buildXAnswer({
      related_entities: [{ target_type: "claim", target: { id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` } }],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Generator" },
        generated_at: "2026-08-01T00:00:00Z",
        source_targets: [{ target_type: "note", target: { id: "note:source", url: `${server.baseUrl}/entities/note/source.json` } }],
      },
    }) as unknown as AnswerDocumentV1;

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget() });

    expect(server.requestLog).not.toContain("/entities/note/source.json");
    expect(graph.references).toHaveLength(1);
    expect(graph.edges.map((e) => e.status)).toEqual(["resolved"]);
  });
});

describe("partial results", () => {
  it("reports every reference past a budget stop as budget-exhausted rather than dropping it", async () => {
    server = await startDeployment({ claims: { first: ["a"], second: ["b"] }, evidence: ["a", "b"] });
    const answer = answerCiting([
      { type: "claim", id: "claim:first", url: `${server.baseUrl}${claimPath("first")}` },
      { type: "claim", id: "claim:second", url: `${server.baseUrl}${claimPath("second")}` },
    ]);

    // One node's worth of budget: the first claim consumes it, everything
    // after must be reported, not silently omitted.
    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget({ maxNodes: 1 }) });

    expect(graph.partial).toBe(true);
    expect(graph.references).toHaveLength(2);
    expect(graph.references[1].status).toBe("budget-exhausted");
    expect(graph.edges.every((e) => e.status === "budget-exhausted")).toBe(true);
    // Every edge still points at a node, even past the stop.
    for (const edge of graph.edges) expect(graph.nodes.some((n) => n.key === edge.to)).toBe(true);
  });

  it("turns a caller abort into a partial result rather than an anonymous throw", async () => {
    server = await startDeployment({ claims: { uptime: ["report"] }, evidence: ["report"] });
    const answer = answerCiting([{ type: "claim", id: "claim:uptime", url: `${server.baseUrl}${claimPath("uptime")}` }]);
    const controller = new AbortController();
    controller.abort();

    const graph = await resolveAnswerEvidenceV1(answer, { ...PERMISSIVE, budget: budget(), signal: controller.signal });

    expect(graph.partial).toBe(true);
    expect(graph.references.map((r) => r.status)).toEqual(["budget-exhausted"]);
    expect(server.requestLog).toEqual([]);
  });
});

describe("resolveClaimEvidenceV1", () => {
  it("expands a claim already in hand, with the root marker as every edge's `from`", async () => {
    server = await startDeployment({ evidence: ["a", "b"] });
    const claim = buildClaimWrapper([
      { id: "evidence:a", url: `${server.baseUrl}${evidencePath("a")}`, stance: "support", confidence: 0.8 },
      { id: "evidence:b", url: `${server.baseUrl}${evidencePath("b")}`, stance: "contradict" },
    ]) as unknown as EvidenceClaimDocumentV1;

    const graph = await resolveClaimEvidenceV1(claim, { ...PERMISSIVE, budget: budget() });

    expect(graph.references).toEqual([]);
    expect(graph.edges.map((e) => e.from)).toEqual(["", ""]);
    expect(graph.edges.map((e) => e.status)).toEqual(["resolved", "resolved"]);
    expect(graph.edges[0].confidence).toBe(0.8);
    // "not declared" stays absent — never defaulted to 0 or 1.
    expect("confidence" in graph.edges[1]).toBe(false);
    expect(graph.edges.map((e) => e.stance)).toEqual(["support", "contradict"]);
  });
});

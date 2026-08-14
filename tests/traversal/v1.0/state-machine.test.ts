/**
 * The traversal state machine: the edge matrix, depth boundaries, cycle vs
 * fan-in, per-occurrence verdicts and blocked-edge behavior (ADR-0011 §3/§7/§8,
 * plan 1.5.0 §"Edge matrix" and §"Traversal state machine").
 *
 * Resolution is injected, so these tests describe transitions only — no
 * network, no budget. Phase 4 wires the real shared canonical resolution behind
 * the same seam.
 */
import { describe, expect, it } from "vitest";
import { runTraversalWalk, type TraversalNodeResolver } from "../../../src/traversal/v1.0/state-machine.js";
import { createAdapterLookup } from "../../../src/traversal/v1.0/registry.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import type { EntityV1 } from "../../../src/client/v1.0/index.js";
import type { GraphEdgeV1, GraphTraversalEventV1 } from "../../../src/traversal/v1.0/index.js";
import {
  answerWrapper,
  claimWrapper,
  entityOf,
  evidenceWrapper,
  generatedSummaryAuthorship,
} from "./entity-helpers.js";

const lookup = createAdapterLookup({ adapters: BUILTIN_TRAVERSAL_ADAPTERS });

const url = {
  answer: "https://example.com/entities/answer/a.json",
  claim: "https://example.com/entities/claim/c1.json",
  evidence: "https://example.com/entities/evidence/e.json",
  document: "https://example.com/entities/document/d.json",
  character: "https://example.com/entities/character/x.json",
};

/** Resolves from a fixed URL map and records every request it was asked to make. */
function resolverFor(byUrl: Record<string, EntityV1 | { status: "not-found" | "forbidden" | "invalid" }>) {
  const requested: string[] = [];
  const resolve: TraversalNodeResolver = async (request) => {
    requested.push(request.url);
    const found = byUrl[request.url];
    if (!found) return { status: "not-found", message: `no fixture for ${request.url}` };
    if ("status" in found && !("aadp_version" in found)) return found;
    return { status: "resolved", entity: found as EntityV1 };
  };
  return { resolve, requested };
}

function walk(
  root: string | EntityV1,
  byUrl: Record<string, EntityV1 | { status: "not-found" | "forbidden" | "invalid" }>,
  over: Partial<Parameters<typeof runTraversalWalk>[1]> = {}
) {
  const { resolve, requested } = resolverFor(byUrl);
  return runTraversalWalk(root, {
    rootUrl: typeof root === "string" ? root : (root.canonical_url as string),
    lookup,
    resolve,
    maxDepth: 3,
    followCollections: false,
    includeGeneratedSummarySources: false,
    ...over,
  }).then((outcome) => ({ ...outcome, requested }));
}

const edges = (events: GraphTraversalEventV1[]): GraphEdgeV1[] =>
  events.filter((e): e is Extract<GraphTraversalEventV1, { type: "edge" }> => e.type === "edge").map((e) => e.edge);

const kinds = (events: GraphTraversalEventV1[]) => events.map((e) => e.type);

/* ------------------------------------------------------------------------- *
 * Fixtures shaped like the plan's sequence example:
 *   A (answer) ─ related_entities[0] → C1 (claim) ─ evidence_refs[0] → E
 *              └ related_entities[1] → E
 * ------------------------------------------------------------------------- */

function answerRoot(over: Record<string, unknown> = {}): EntityV1 {
  return entityOf({
    id: "answer:a",
    type: "answer",
    canonical_url: url.answer,
    x_answer: answerWrapper({
      related_entities: [
        { target_type: "claim", target: { id: "claim:c1", url: url.claim } },
        { target_type: "evidence", target: { id: "evidence:e", url: url.evidence } },
      ],
      ...over,
    }),
  });
}

const claimC1 = entityOf({
  id: "claim:c1",
  type: "claim",
  canonical_url: url.claim,
  x_evidence: claimWrapper({
    evidence_refs: [
      { target_type: "evidence", target: { id: "evidence:e", url: url.evidence }, stance: "support" },
    ],
  }),
});

const evidenceE = entityOf({
  id: "evidence:e",
  type: "evidence",
  canonical_url: url.evidence,
  x_evidence: evidenceWrapper(),
});

describe("edge matrix", () => {
  it("walks answer.related_entity and evidence.evidence_ref to a leaf", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });

    expect(edges(outcome.events).map((e) => [e.edgeGroup, e.index, e.outcome])).toEqual([
      ["answer.related_entity", 0, "expanded"],
      ["answer.related_entity", 1, "expanded"],
      ["evidence.evidence_ref", 0, "already-expanded"],
    ]);
    expect(outcome.summary).toMatchObject({ stopReason: "exhausted", partial: false, nodes: 3, edges: 3 });
  });

  it("fetches a fan-in target exactly once", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    expect(outcome.requested.filter((u) => u === url.evidence)).toHaveLength(1);
    expect(outcome.summary.requests).toBe(2);
  });

  it("treats an evidence entity as a leaf and never fetches its source metadata", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    expect(outcome.requested).not.toContain("https://example.com/reports/2026-status");
    expect(outcome.requested).not.toContain("https://example.com");
    const evidenceExpansions = outcome.events.filter(
      (e) => e.type === "expansion" && e.expansion.key.includes("evidence:e")
    );
    expect(evidenceExpansions).toHaveLength(1);
  });

  it("marks an expandable:false occurrence as leaf when it is the first to reach the target", async () => {
    // Root is the claim, so the only path to E is the evidence_ref itself.
    const outcome = await walk(claimC1, { [url.evidence]: evidenceE });
    expect(edges(outcome.events).map((e) => [e.edgeGroup, e.outcome, e.status])).toEqual([
      ["evidence.evidence_ref", "leaf", "resolved"],
    ]);
  });

  it("keeps answer.source_target off by default and follows it on opt-in", async () => {
    const root = answerRoot({ authorship: generatedSummaryAuthorship() });
    const documentD = entityOf({ id: "document:orbit-overview", type: "document", canonical_url: url.document });
    const fixtures = {
      [url.claim]: claimC1,
      [url.evidence]: evidenceE,
      "https://example.com/entities/document/orbit-overview.json": documentD,
    };

    const off = await walk(root, fixtures);
    expect(edges(off.events).some((e) => e.edgeGroup === "answer.source_target")).toBe(false);

    const on = await walk(root, fixtures, { includeGeneratedSummarySources: true });
    expect(edges(on.events).filter((e) => e.edgeGroup === "answer.source_target")).toHaveLength(1);
  });

  it("plans relations.item edges from any entity type", async () => {
    const root = entityOf({
      id: "answer:a",
      canonical_url: url.answer,
      x_relations: {
        module: "aadp:relations",
        version: "1.0",
        kind: "relation-set",
        items: [
          {
            rel: "creator",
            target_type: "character",
            cardinality: "one",
            target: { id: "character:x", url: url.character },
          },
        ],
      },
    });
    const outcome = await walk(root, {
      [url.character]: entityOf({ id: "character:x", type: "character", canonical_url: url.character }),
    });
    expect(edges(outcome.events).map((e) => [e.edgeGroup, e.outcome])).toEqual([["relations.item", "expanded"]]);
  });
});

describe("depth boundary", () => {
  it("emits the root and blocks every edge at maxDepth 0", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE }, { maxDepth: 0 });
    expect(kinds(outcome.events)).toEqual(["node", "edge", "edge", "expansion"]);
    expect(edges(outcome.events).every((e) => e.outcome === "depth-limit")).toBe(true);
    expect(outcome.requested).toEqual([]);
  });

  it("still fetches and expands a node landing exactly ON maxDepth", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE }, { maxDepth: 1 });
    const byGroup = edges(outcome.events).map((e) => [e.edgeGroup, e.outcome]);
    expect(byGroup).toContainEqual(["answer.related_entity", "expanded"]);
    // C1 landed exactly ON maxDepth: it is fetched, emitted and expanded — its
    // own child edge is what the limit blocks, one level further down.
    expect(outcome.requested).toContain(url.claim);
    expect(outcome.events.some((e) => e.type === "expansion" && e.expansion.key.includes("claim:c1"))).toBe(true);
    expect(byGroup).toContainEqual(["evidence.evidence_ref", "depth-limit"]);
  });

  it("blocks an edge whose landing depth exceeds maxDepth without a request", async () => {
    const documentD = entityOf({ id: "document:d", type: "document", canonical_url: url.document });
    const claimWithDeepRef = entityOf({
      id: "claim:c1",
      type: "claim",
      canonical_url: url.claim,
      x_evidence: claimWrapper({
        evidence_refs: [{ target_type: "evidence", target: { id: "evidence:e", url: url.evidence }, stance: "support" }],
      }),
    });
    const outcome = await walk(
      answerRoot({
        related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: url.claim } }],
      }),
      { [url.claim]: claimWithDeepRef, [url.evidence]: evidenceE, [url.document]: documentD },
      { maxDepth: 1 }
    );

    const deep = edges(outcome.events).find((e) => e.edgeGroup === "evidence.evidence_ref")!;
    expect(deep.outcome).toBe("depth-limit");
    expect(deep.status).toBeUndefined();
    expect(outcome.requested).not.toContain(url.evidence);
  });
});

describe("cycle vs fan-in", () => {
  it("reports a real cycle when the target is on the occurrence's ancestor path", async () => {
    const backToRoot = entityOf({
      id: "claim:c1",
      type: "claim",
      canonical_url: url.claim,
      x_relations: {
        module: "aadp:relations",
        version: "1.0",
        kind: "relation-set",
        items: [
          { rel: "about", target_type: "answer", cardinality: "one", target: { id: "answer:a", url: url.answer } },
        ],
      },
    });
    const outcome = await walk(
      answerRoot({ related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: url.claim } }] }),
      { [url.claim]: backToRoot }
    );

    const back = edges(outcome.events).find((e) => e.edgeGroup === "relations.item")!;
    expect(back.outcome).toBe("cycle");
    expect(back.status).toBeUndefined();
  });

  it("reports a diamond re-entry as already-expanded, not as a cycle", async () => {
    // A → C1 → E and A → E: the second path to E has no route back to an
    // ancestor, so calling it a cycle would misreport the topology.
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    const reentry = edges(outcome.events).find((e) => e.edgeGroup === "evidence.evidence_ref")!;
    expect(reentry.outcome).toBe("already-expanded");
    expect(reentry.status).toBeUndefined();
  });

  it("expands a node at most once per walk even under fan-in", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    const evidenceNodes = outcome.events.filter((e) => e.type === "node" && e.node.key.includes("evidence:e"));
    expect(evidenceNodes).toHaveLength(1);
  });
});

describe("per-occurrence verdicts", () => {
  it("marks a type mismatch invalid for that reference alone", async () => {
    const root = answerRoot({
      related_entities: [
        { target_type: "claim", target: { id: "claim:c1", url: url.claim } },
        { target_type: "claim", target: { id: "claim:mislabelled", url: url.document } },
      ],
    });
    const documentD = entityOf({ id: "claim:mislabelled", type: "document", canonical_url: url.document });
    const outcome = await walk(root, { [url.claim]: claimC1, [url.evidence]: evidenceE, [url.document]: documentD });

    const mismatch = edges(outcome.events).find((e) => e.index === 1)!;
    expect(mismatch).toMatchObject({ status: "invalid", outcome: "not-expanded" });

    // The canonical node keeps the outcome every other reference to it sees.
    const node = outcome.events.find((e) => e.type === "node" && e.node.key.includes("claim:mislabelled"));
    expect(node && node.type === "node" && node.node.status).toBe("resolved");
  });

  it("reports an unresolvable target as not-expanded with its own status", async () => {
    const outcome = await walk(answerRoot(), { [url.evidence]: evidenceE });
    const missing = edges(outcome.events).find((e) => e.index === 0)!;
    expect(missing).toMatchObject({ status: "not-found", outcome: "not-expanded" });
    expect(outcome.events.some((e) => e.type === "node" && e.node.status === "not-found")).toBe(true);
  });

  it("emits a node for a root that never resolved and stops there", async () => {
    const outcome = await walk("https://example.com/entities/answer/missing.json", {});
    expect(kinds(outcome.events)).toEqual(["node"]);
    expect(outcome.summary).toMatchObject({ nodes: 1, edges: 0, requests: 1 });
  });
});

describe("emission order", () => {
  it("emits a node before its edges and its expansions after them", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    // Each root-level edge is followed by its `reference` — the same occurrence
    // seen from the root's point of view — and the node's expansions come last.
    expect(kinds(outcome.events).slice(0, 6)).toEqual([
      "node",
      "edge",
      "reference",
      "edge",
      "reference",
      "expansion",
    ]);
  });

  it("orders edges by edge-group rank, not by adapter registration or property order", async () => {
    const root = entityOf({
      id: "answer:a",
      type: "answer",
      canonical_url: url.answer,
      // Property order deliberately puts x_answer first; relations.item still
      // ranks ahead of answer.related_entity.
      x_answer: answerWrapper({
        related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: url.claim } }],
      }),
      x_relations: {
        module: "aadp:relations",
        version: "1.0",
        kind: "relation-set",
        items: [
          {
            rel: "creator",
            target_type: "character",
            cardinality: "one",
            target: { id: "character:x", url: url.character },
          },
        ],
      },
    });
    const outcome = await walk(root, {
      [url.claim]: claimC1,
      [url.evidence]: evidenceE,
      [url.character]: entityOf({ id: "character:x", type: "character", canonical_url: url.character }),
    });
    expect(edges(outcome.events).slice(0, 2).map((e) => e.edgeGroup)).toEqual([
      "relations.item",
      "answer.related_entity",
    ]);
  });

  it("produces the same nodes, edges and request count when references are reversed", async () => {
    const forward = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    const reversed = await walk(
      answerRoot({
        related_entities: [
          { target_type: "evidence", target: { id: "evidence:e", url: url.evidence } },
          { target_type: "claim", target: { id: "claim:c1", url: url.claim } },
        ],
      }),
      { [url.claim]: claimC1, [url.evidence]: evidenceE }
    );

    expect(reversed.summary.requests).toBe(forward.summary.requests);
    expect(reversed.summary.nodes).toBe(forward.summary.nodes);
    expect(reversed.summary.edges).toBe(forward.summary.edges);
    const keys = (events: GraphTraversalEventV1[]) =>
      new Set(events.filter((e) => e.type === "node").map((e) => (e.type === "node" ? e.node.key : "")));
    expect(keys(reversed.events)).toEqual(keys(forward.events));
  });
});

describe("root-level references", () => {
  it("records one reference per root occurrence that reached a resolution", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE });
    expect(outcome.references.map((r) => [r.edgeGroup, r.index, r.status])).toEqual([
      ["answer.related_entity", 0, "resolved"],
      ["answer.related_entity", 1, "resolved"],
    ]);
  });

  it("omits a blocked root occurrence — it has no resolution verdict", async () => {
    const outcome = await walk(answerRoot(), { [url.claim]: claimC1, [url.evidence]: evidenceE }, { maxDepth: 0 });
    expect(outcome.references).toEqual([]);
  });
});

describe("unsupported modules", () => {
  it("tallies unsupported extensions by their declared module id without failing the walk", async () => {
    const root = entityOf({
      id: "answer:a",
      type: "answer",
      canonical_url: url.answer,
      x_answer: answerWrapper({
        related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: url.claim } }],
      }),
      x_vendor: { module: "vendor:thing", version: "9.9" },
    });
    const outcome = await walk(root, { [url.claim]: claimC1, [url.evidence]: evidenceE });
    expect(outcome.summary.unsupportedModules).toEqual({ "vendor:thing": 1 });
    expect(edges(outcome.events).some((e) => e.outcome === "expanded")).toBe(true);
  });
});

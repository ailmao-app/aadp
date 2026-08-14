/**
 * The three built-in adapters: they validate with the RELEASED module
 * validators, plan the edge-matrix rows they own, and stay pure — no request,
 * no clock, no mutation (ADR-0011 §2/§3).
 */
import { describe, expect, it, vi } from "vitest";
import { relationsTraversalAdapter } from "../../../src/traversal/v1.0/adapters/relations.js";
import { answerTraversalAdapter } from "../../../src/traversal/v1.0/adapters/answer.js";
import { evidenceTraversalAdapter } from "../../../src/traversal/v1.0/adapters/evidence.js";
import type { EntityV1 } from "../../../src/client/v1.0/index.js";
import type {
  TraversalAdapter,
  TraversalEdgePlan,
  TraversalPlanContext,
} from "../../../src/traversal/v1.0/index.js";
import {
  answerEntity,
  answerWrapper,
  claimEntity,
  claimWrapper,
  entityOf,
  evidenceEntity,
  generatedSummaryAuthorship,
  relationSet,
} from "./entity-helpers.js";

function context(over: Partial<TraversalPlanContext> = {}): TraversalPlanContext {
  return {
    depth: 0,
    nodeKey: "answer:what-is-orbit@https://example.com/entities/answer/what-is-orbit.json",
    followCollections: false,
    includeGeneratedSummarySources: false,
    ...over,
  };
}

/** Parses and plans in one step, failing loudly if the fixture is not valid. */
function plan<TDoc>(
  adapter: TraversalAdapter<TDoc>,
  entity: EntityV1,
  ctx: TraversalPlanContext = context()
): TraversalEdgePlan[] {
  const parsed = adapter.parseExtension(entity);
  if (!parsed.ok) {
    throw new Error(
      `fixture is not valid for this adapter: ${JSON.stringify([...parsed.errors, ...parsed.semanticIssues])}`
    );
  }
  return adapter.planEdges(parsed.document, entity, ctx);
}

describe("relations adapter", () => {
  it("plans one edge per inline target, in wire order", () => {
    const edges = plan(relationsTraversalAdapter, entityOf({ x_relations: relationSet() }));
    expect(edges.map((e) => [e.edgeGroup, e.index, e.target.id, e.declaredTargetType])).toEqual([
      ["relations.item", 0, "character:phu_diep", "character"],
      ["relations.item", 1, "document:a", "document"],
      ["relations.item", 2, "document:b", "document"],
    ]);
    expect(edges.every((e) => e.expandable)).toBe(true);
  });

  it("rejects a malformed relation-set with the released validator's own issues", () => {
    const broken = relationSet({
      items: [{ rel: "not a token", target_type: "document", cardinality: "one", target: { id: "document:a", url: "https://example.com/a.json" } }],
    });
    const parsed = relationsTraversalAdapter.parseExtension(entityOf({ x_relations: broken }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect([...parsed.errors, ...parsed.semanticIssues].length).toBeGreaterThan(0);
  });

  it("rejects an entity with no x_relations at all", () => {
    expect(relationsTraversalAdapter.parseExtension(entityOf()).ok).toBe(false);
  });
});

describe("answer adapter", () => {
  it("plans related_entities unconditionally (edge matrix row 3)", () => {
    const edges = plan(answerTraversalAdapter, answerEntity());
    expect(edges).toEqual([
      expect.objectContaining({ edgeGroup: "answer.related_entity", index: 0, declaredTargetType: "claim" }),
    ]);
  });

  it("does NOT plan authorship.source_targets by default (row 4 opt-in)", () => {
    const entity = entityOf({ x_answer: answerWrapper({ authorship: generatedSummaryAuthorship() }) });
    const edges = plan(answerTraversalAdapter, entity);
    expect(edges.some((e) => e.edgeGroup === "answer.source_target")).toBe(false);
  });

  it("plans authorship.source_targets once the caller opts in", () => {
    const entity = entityOf({ x_answer: answerWrapper({ authorship: generatedSummaryAuthorship() }) });
    const edges = plan(answerTraversalAdapter, entity, context({ includeGeneratedSummarySources: true }));
    expect(edges.map((e) => [e.edgeGroup, e.index, e.target.id])).toEqual([
      ["answer.related_entity", 0, "claim:orbit-uptime-2026"],
      ["answer.source_target", 0, "document:orbit-overview"],
    ]);
  });

  it("plans no source_target for source-authored answers even when opted in", () => {
    const edges = plan(answerTraversalAdapter, answerEntity(), context({ includeGeneratedSummarySources: true }));
    expect(edges.some((e) => e.edgeGroup === "answer.source_target")).toBe(false);
  });

  it("rejects an x_answer whose content_checksum does not seal the wrapper", () => {
    const wrapper = { ...answerWrapper(), question: "Tampered?" };
    const parsed = answerTraversalAdapter.parseExtension(entityOf({ x_answer: wrapper }));
    expect(parsed.ok).toBe(false);
  });

  it("rejects x_answer on an entity whose type is not answer — same rule as the module client", () => {
    const parsed = answerTraversalAdapter.parseExtension(entityOf({ type: "document", x_answer: answerWrapper() }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.semanticIssues.map((i) => i.code)).toContain("answer.semantic.entity_type_mismatch");
  });
});

describe("evidence adapter", () => {
  it("plans one leaf edge per evidence_ref on a claim (row 5)", () => {
    const edges = plan(evidenceTraversalAdapter, claimEntity());
    expect(edges).toEqual([
      expect.objectContaining({
        edgeGroup: "evidence.evidence_ref",
        index: 0,
        declaredTargetType: "evidence",
        expandable: false,
      }),
    ]);
  });

  it("plans nothing on an evidence entity — source.url is never an edge (row 6)", () => {
    const edges = plan(evidenceTraversalAdapter, evidenceEntity());
    expect(edges).toEqual([]);
  });

  it("keeps evidence_refs in wire order", () => {
    const entity = claimEntity({
      x_evidence: claimWrapper({
        evidence_refs: [
          { target_type: "evidence", target: { id: "evidence:b", url: "https://example.com/b.json" }, stance: "support" },
          { target_type: "evidence", target: { id: "evidence:a", url: "https://example.com/a.json" }, stance: "contradict" },
        ],
      }),
    });
    expect(plan(evidenceTraversalAdapter, entity).map((e) => [e.index, e.target.id])).toEqual([
      [0, "evidence:b"],
      [1, "evidence:a"],
    ]);
  });

  it("rejects a claim whose x_evidence fails the released validator", () => {
    const entity = claimEntity({ x_evidence: { ...claimWrapper(), statement: "tampered" } });
    const parsed = evidenceTraversalAdapter.parseExtension(entity);
    expect(parsed.ok).toBe(false);
  });
});

describe("adapter purity", () => {
  it("makes no request while parsing or planning any of the three extensions", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    plan(relationsTraversalAdapter, entityOf({ x_relations: relationSet() }));
    plan(answerTraversalAdapter, answerEntity(), context({ includeGeneratedSummarySources: true }));
    plan(evidenceTraversalAdapter, claimEntity());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not mutate the entity it is given", () => {
    const entity = answerEntity();
    const before = JSON.stringify(entity);
    plan(answerTraversalAdapter, entity, context({ includeGeneratedSummarySources: true }));
    expect(JSON.stringify(entity)).toBe(before);
  });
});

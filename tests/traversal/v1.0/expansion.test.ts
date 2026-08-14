/**
 * The validation phase: capability negotiation, per-extension scoping and
 * extension-field ordering for one resolved node (ADR-0011 §2/§2a/§5, plan
 * 1.5.0 §"Validation phase" and §"Capability negotiation").
 */
import { describe, expect, it, vi } from "vitest";
import { planNodeExpansions } from "../../../src/traversal/v1.0/edge-planner.js";
import { createAdapterLookup } from "../../../src/traversal/v1.0/registry.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import type { TraversalPlanContext } from "../../../src/traversal/v1.0/index.js";
import {
  answerWrapper,
  claimWrapper,
  entityOf,
  evidenceWrapper,
  generatedSummaryAuthorship,
  relationSet,
} from "./entity-helpers.js";

const NODE_KEY = "answer:what-is-orbit@https://example.com/entities/answer/what-is-orbit.json";

/** The built-ins, resolved per call — never the process-wide registry. */
const builtins = createAdapterLookup({ adapters: BUILTIN_TRAVERSAL_ADAPTERS });

function context(over: Partial<TraversalPlanContext> = {}): TraversalPlanContext {
  return {
    depth: 0,
    nodeKey: NODE_KEY,
    followCollections: false,
    includeGeneratedSummarySources: false,
    ...over,
  };
}

describe("per-extension scoping", () => {
  it("plans Answer edges even when an unsupported vendor extension sits beside them", () => {
    const entity = entityOf({ x_answer: answerWrapper(), x_vendor: { module: "vendor:thing", version: "9.9" } });
    const result = planNodeExpansions(entity, context(), builtins);

    expect(result.expansions.map((e) => [e.extensionField, e.outcome])).toEqual([
      ["x_answer", "planned"],
      ["x_vendor", "unsupported-module"],
    ]);
    expect(result.edges.map((e) => e.plan.edgeGroup)).toEqual(["answer.related_entity"]);
  });

  it("plans both groups when one entity carries x_relations and x_answer", () => {
    const entity = entityOf({ x_answer: answerWrapper(), x_relations: relationSet() });
    const result = planNodeExpansions(entity, context(), builtins);

    expect(result.expansions.every((e) => e.outcome === "planned")).toBe(true);
    expect(new Set(result.edges.map((e) => e.plan.edgeGroup))).toEqual(
      new Set(["answer.related_entity", "relations.item"])
    );
  });

  it("blocks only the broken adapter when one extension is invalid and another is valid", () => {
    const entity = entityOf({
      x_answer: { ...answerWrapper(), question: "tampered" },
      x_relations: relationSet(),
    });
    const result = planNodeExpansions(entity, context(), builtins);

    expect(result.expansions.map((e) => [e.extensionField, e.outcome])).toEqual([
      ["x_answer", "invalid-extension"],
      ["x_relations", "planned"],
    ]);
    // No Answer edge was planned; the Relations edges are untouched.
    expect(result.edges.every((e) => e.extensionField === "x_relations")).toBe(true);
    expect(result.edges).toHaveLength(3);
  });

  it("keeps both validator channels on an invalid extension", () => {
    // A schema-only failure populates `errors` and leaves `semanticIssues`
    // empty; merging the two would leave `invalid-extension` with no reason.
    const schemaBroken = planNodeExpansions(
      entityOf({ x_evidence: { ...claimWrapper(), unknown_field: true }, type: "claim" }),
      context(),
      builtins
    ).expansions[0]!;
    expect(schemaBroken.outcome).toBe("invalid-extension");
    expect(schemaBroken.errors).toBeDefined();
    expect(schemaBroken.semanticIssues).toBeDefined();

    // A semantic-only failure (checksum no longer seals the wrapper) reports
    // through the other channel, and both are always present.
    const semanticBroken = planNodeExpansions(
      entityOf({ x_answer: { ...answerWrapper(), question: "tampered" } }),
      context(),
      builtins
    ).expansions[0]!;
    expect(semanticBroken.semanticIssues?.length).toBeGreaterThan(0);
  });

  it("records an adapter that planned nothing as no-edges, not as a failure", () => {
    const entity = entityOf({
      id: "evidence:orbit-report",
      type: "evidence",
      canonical_url: "https://example.com/entities/evidence/orbit-report.json",
      x_evidence: evidenceWrapper(),
    });
    const result = planNodeExpansions(entity, context({ nodeKey: "evidence:orbit-report@u" }), builtins);
    expect(result.expansions.map((e) => e.outcome)).toEqual(["no-edges"]);
    expect(result.edges).toEqual([]);
  });

  it("emits one edge record per occurrence while the extension record stays planned", () => {
    const result = planNodeExpansions(entityOf({ x_relations: relationSet() }), context(), builtins);
    expect(result.edges).toHaveLength(3);
    expect(result.expansions).toEqual([
      expect.objectContaining({ extensionField: "x_relations", outcome: "planned", plannedEdges: 3 }),
    ]);
  });

  it("keys an expansion record by node and extension field", () => {
    const result = planNodeExpansions(entityOf({ x_answer: answerWrapper() }), context(), builtins);
    expect(result.expansions[0]!.key).toBe(`${NODE_KEY}#x_answer`);
  });
});

describe("extension ordering", () => {
  it("orders records by extension-field name, not by JSON property order", () => {
    const forward = entityOf({
      x_answer: answerWrapper(),
      x_relations: relationSet(),
      x_vendor_a: 1,
      x_vendor_b: {},
    });
    // Same extensions, serialized in the opposite property order, including two
    // fields with no module envelope at all — those have no adapter key to rank
    // by, which is why the sort key is the field name.
    const reversed = entityOf({
      x_vendor_b: {},
      x_vendor_a: 1,
      x_relations: relationSet(),
      x_answer: answerWrapper(),
    });

    const fields = (entity: ReturnType<typeof entityOf>) =>
      planNodeExpansions(entity, context(), builtins).expansions.map((e) => [e.extensionField, e.outcome]);

    expect(fields(forward)).toEqual([
      ["x_answer", "planned"],
      ["x_relations", "planned"],
      ["x_vendor_a", "unsupported-module"],
      ["x_vendor_b", "unsupported-module"],
    ]);
    expect(fields(reversed)).toEqual(fields(forward));
    expect(planNodeExpansions(reversed, context(), builtins).edges.map((e) => e.plan.target.id)).toEqual(
      planNodeExpansions(forward, context(), builtins).edges.map((e) => e.plan.target.id)
    );
  });

  it("ignores non-extension entity fields", () => {
    const result = planNodeExpansions(entityOf({ x_answer: answerWrapper() }), context(), builtins);
    expect(result.expansions).toHaveLength(1);
  });
});

describe("capability negotiation", () => {
  it("reports an unknown module as unsupported-module without throwing", () => {
    const entity = entityOf({ x_vendor: { module: "vendor:unknown", version: "1.0" } });
    const result = planNodeExpansions(entity, context(), builtins);
    expect(result.expansions[0]!.outcome).toBe("unsupported-module");
    expect(result.expansions[0]!.adapter).toBeUndefined();
  });

  it("reports an unsupported VERSION of a supported module the same way", () => {
    const entity = entityOf({ x_answer: { ...answerWrapper(), version: "2.0" } });
    const result = planNodeExpansions(entity, context(), builtins);
    expect(result.expansions[0]!.outcome).toBe("unsupported-module");
  });

  it("reports an extension with no module envelope as unsupported-module", () => {
    for (const payload of [1, "text", [], null, { version: "1.0" }, { module: "vendor:x" }]) {
      const result = planNodeExpansions(entityOf({ x_thing: payload }), context(), builtins);
      expect(result.expansions).toEqual([
        expect.objectContaining({ extensionField: "x_thing", outcome: "unsupported-module", plannedEdges: 0 }),
      ]);
    }
  });

  it("gives an allowlisted-out module the same outcome as an unimplemented one", () => {
    const narrowed = createAdapterLookup({
      adapters: BUILTIN_TRAVERSAL_ADAPTERS,
      capabilities: [{ moduleId: "aadp:relations", version: "1.0" }],
    });
    const entity = entityOf({ x_answer: answerWrapper(), x_relations: relationSet() });
    const result = planNodeExpansions(entity, context(), narrowed);

    expect(result.expansions.map((e) => [e.extensionField, e.outcome])).toEqual([
      ["x_answer", "unsupported-module"],
      ["x_relations", "planned"],
    ]);
    expect(result.edges.every((e) => e.extensionField === "x_relations")).toBe(true);
  });

  it("still lists the declared module of an extension it cannot dispatch", () => {
    const entity = entityOf({ x_answer: answerWrapper(), x_vendor: { module: "vendor:thing", version: "9.9" } });
    const result = planNodeExpansions(entity, context(), builtins);
    expect(result.modules).toEqual([
      { id: "aadp:answer", version: "1.0", extensionField: "x_answer" },
      { id: "vendor:thing", version: "9.9", extensionField: "x_vendor" },
    ]);
  });
});

describe("negotiation purity", () => {
  it("emits no request for the child edges of a malformed extension", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const entity of [
      entityOf({ x_relations: relationSet({ items: [{ rel: "not a token", target_type: "document", cardinality: "one" }] }) }),
      entityOf({ x_answer: { ...answerWrapper(), version: "1.0", question: "tampered" } }),
      entityOf({ type: "claim", x_evidence: { ...claimWrapper(), statement: "tampered" } }),
    ]) {
      const result = planNodeExpansions(entity, context(), builtins);
      expect(result.expansions[0]!.outcome).toBe("invalid-extension");
      expect(result.edges).toEqual([]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("plans the same edges whether or not the caller opted into source targets", () => {
    const entity = entityOf({ x_answer: answerWrapper({ authorship: generatedSummaryAuthorship() }) });
    const withoutOptIn = planNodeExpansions(entity, context(), builtins);
    const withOptIn = planNodeExpansions(entity, context({ includeGeneratedSummarySources: true }), builtins);

    expect(withoutOptIn.edges.map((e) => e.plan.edgeGroup)).toEqual(["answer.related_entity"]);
    expect(withOptIn.edges.map((e) => e.plan.edgeGroup)).toEqual([
      "answer.related_entity",
      "answer.source_target",
    ]);
  });
});

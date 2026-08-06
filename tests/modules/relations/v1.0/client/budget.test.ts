import { describe, expect, it } from "vitest";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";

/**
 * ADR-0008 "Reference defaults" — locks the six-dimension defaults
 * `createRelationsTraversalBudget()` applies when a caller supplies no
 * options at all, so a future change to any one of them is a deliberate,
 * reviewed edit to this test rather than a silent regression.
 */
describe("createRelationsTraversalBudget — ADR-0008 reference defaults", () => {
  it("applies the exact reference defaults with no options", () => {
    const budget = createRelationsTraversalBudget();
    expect(budget.maxDepth).toBe(3);
    expect(budget.maxNodes).toBe(1_000);
    expect(budget.maxRequests).toBe(2_000);
    expect(budget.maxTotalBytes).toBe(64 * 1024 * 1024);
    expect(budget.deadlineMs).toBe(5 * 60_000);
    expect(budget.maxCrossOriginRequests).toBe(100);
  });

  it("lets a caller override any one dimension without disturbing the others' defaults", () => {
    const budget = createRelationsTraversalBudget({ maxNodes: 5 });
    expect(budget.maxNodes).toBe(5);
    expect(budget.maxDepth).toBe(3);
    expect(budget.maxRequests).toBe(2_000);
    expect(budget.maxTotalBytes).toBe(64 * 1024 * 1024);
    expect(budget.maxCrossOriginRequests).toBe(100);
  });
});

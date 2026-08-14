/**
 * Acceptance rules for a Phase 6 interoperability run
 * (`scripts/interop-acceptance.mjs`).
 *
 * The traversal contract reports 404s, forbidden targets, invalid documents,
 * budget stops and truncated collections as RESULTS, not exceptions — so "the
 * run did not throw" is not evidence of interoperability. These tests pin the
 * conditions that are, and the ones that disqualify a run from closing the
 * release gate.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, deliberately not part of the TS build
import { evaluateAcceptance, BUDGET_DIMENSIONS } from "../../scripts/interop-acceptance.mjs";

const effectiveLimits = {
  maxDepth: 3,
  maxNodes: 50,
  maxRequests: 100,
  maxTotalBytes: 67108864,
  maxCrossOriginRequests: 100,
  deadlineMs: 300000,
};

function goodRun(over: Record<string, unknown> = {}) {
  return {
    graph: {
      nodes: [{ key: "answer:a\0https://example.com/a.json", depth: 0, status: "resolved" }],
      summary: { stopReason: "exhausted", partial: false, nodes: 3, edges: 2, requests: 3 },
    },
    failure: null,
    profile: { status: "passed", summary: { total: 26, passed: 26, failed: 0 } },
    effectiveLimits,
    loopback: false,
    linkedNodeModules: false,
    atEnginesFloor: true,
    rootUrl: "https://example.com/a.json",
    ...over,
  };
}

describe("a run that counts as release evidence", () => {
  it("accepts a resolved, complete walk with a passing profile", () => {
    const verdict = evaluateAcceptance(goodRun());
    expect(verdict.result).toBe("passed");
    expect(verdict.eligible_for_release_gate).toBe(true);
    expect(verdict.failed_checks).toEqual([]);
  });

  it("names every condition it checked, passed or not", () => {
    const verdict = evaluateAcceptance(goodRun());
    expect(verdict.checks.map((c: { id: string }) => c.id)).toEqual([
      "walk.did_not_throw",
      "walk.produced_graph",
      "graph.root_resolved",
      "graph.exhausted",
      "graph.not_partial",
      "profile.passed",
      "budget.six_limits_recorded",
      "run.real_deployment",
      "run.clean_install",
      "run.at_engines_floor",
    ]);
  });
});

describe("runs that must not close the gate", () => {
  it("rejects a root that did not resolve", () => {
    const verdict = evaluateAcceptance(
      goodRun({
        graph: {
          nodes: [{ key: "\0https://example.com/missing.json", depth: 0, status: "not-found" }],
          summary: { stopReason: "exhausted", partial: false, nodes: 1, edges: 0, requests: 1 },
        },
      })
    );
    expect(verdict.eligible_for_release_gate).toBe(false);
    expect(verdict.failed_checks).toContain("graph.root_resolved");
    expect(verdict.result).toBe("failed");
  });

  it("rejects a partial graph even when the scheduler exhausted its queue", () => {
    const run = goodRun();
    const verdict = evaluateAcceptance({
      ...run,
      graph: { ...run.graph, summary: { ...run.graph.summary, partial: true } },
    });
    expect(verdict.failed_checks).toContain("graph.not_partial");
  });

  it("rejects a walk stopped by the budget", () => {
    const run = goodRun();
    const verdict = evaluateAcceptance({
      ...run,
      graph: { ...run.graph, summary: { ...run.graph.summary, stopReason: "budget", partial: true } },
    });
    expect(verdict.failed_checks).toEqual(expect.arrayContaining(["graph.exhausted", "graph.not_partial"]));
  });

  it("rejects a run whose conformance profile did not pass", () => {
    const verdict = evaluateAcceptance(
      goodRun({ profile: { status: "failed", summary: { total: 26, passed: 25, failed: 1 } } })
    );
    expect(verdict.failed_checks).toContain("profile.passed");
  });

  it("rejects a walk that threw", () => {
    const verdict = evaluateAcceptance(
      goodRun({ graph: null, failure: { name: "AadpRequestError", message: "503" } })
    );
    expect(verdict.failed_checks).toEqual(
      expect.arrayContaining(["walk.did_not_throw", "walk.produced_graph", "graph.root_resolved"])
    );
  });

  it.each(BUDGET_DIMENSIONS)("rejects evidence missing the %s budget limit", (missing: string) => {
    const partial = { ...effectiveLimits } as Record<string, number>;
    delete partial[missing];
    const verdict = evaluateAcceptance(goodRun({ effectiveLimits: partial }));
    expect(verdict.failed_checks).toContain("budget.six_limits_recorded");
  });
});

describe("pipeline-validation runs", () => {
  it("marks a loopback run as validation, never as evidence", () => {
    const verdict = evaluateAcceptance(goodRun({ loopback: true }));
    expect(verdict.eligible_for_release_gate).toBe(false);
    expect(verdict.result).toBe("pipeline-validation");
    expect(verdict.failed_checks).toContain("run.real_deployment");
  });

  it("marks a linked-node_modules run as validation, never as evidence", () => {
    const verdict = evaluateAcceptance(goodRun({ linkedNodeModules: true }));
    expect(verdict.result).toBe("pipeline-validation");
    expect(verdict.failed_checks).toContain("run.clean_install");
  });
});

describe("the engines floor", () => {
  it("reports a run above the floor without disqualifying it", () => {
    const verdict = evaluateAcceptance(goodRun({ atEnginesFloor: false }));
    // Not required: a newer Node may be run in addition. The record still needs
    // one run AT the floor, which this flag is what makes visible.
    expect(verdict.eligible_for_release_gate).toBe(true);
    const floorCheck = verdict.checks.find((c: { id: string }) => c.id === "run.at_engines_floor");
    expect(floorCheck).toMatchObject({ required: false, passed: false });
  });
});

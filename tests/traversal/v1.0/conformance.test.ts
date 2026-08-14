/**
 * The `aadp:graph-traversal@1.0` conformance profile: every stable check ID,
 * the report shape, option validation and the shared runner controls
 * (plan 1.5.0 §"Conformance contract").
 */
import { describe, expect, it, vi } from "vitest";
import {
  GRAPH_TRAVERSAL_CHECKS,
  InvalidGraphTraversalConformanceOptionsError,
  runGraphTraversalConformance,
} from "../../../src/traversal/v1.0/index.js";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";
import { createRelationsTraversalBudget } from "../../../src/modules/relations/v1.0/index.js";
import type { CheckResult } from "../../../src/conformance/index.js";

/** The stable check IDs. Changing one is a package-API break, so they are pinned here. */
const EXPECTED_CHECK_IDS = [
  "graph.capability.no_manifest_request",
  "graph.capability.unsupported_is_not_error",
  "graph.capability.exact_match",
  "graph.traversal.extension_validated",
  "graph.traversal.extension_scoped",
  "graph.traversal.edge_matrix",
  "graph.traversal.source_targets_opt_in",
  "graph.traversal.metadata_not_fetched",
  "graph.traversal.cycle_contained",
  "graph.traversal.fanin_not_cycle",
  "graph.traversal.depth_boundary",
  "graph.traversal.edge_outcome_per_occurrence",
  "graph.traversal.blocked_edge_emitted",
  "graph.traversal.root_identity",
  "graph.traversal.type_mismatch_scoped",
  "graph.ordering.property_order_independent",
  "graph.ordering.deterministic",
  "graph.ordering.mixed_order_equivalence",
  "graph.budget.walk_local_expansion",
  "graph.budget.no_double_charge",
  "graph.budget.partial_not_complete",
  "graph.budget.no_request_after_abort",
  "graph.streaming.terminal_event",
  "graph.streaming.bounded_memory",
  "graph.compat.core_only_unchanged",
];

describe("check registry", () => {
  it("publishes exactly the stable check IDs of the plan", () => {
    expect(GRAPH_TRAVERSAL_CHECKS.map((check) => check.id).sort()).toEqual([...EXPECTED_CHECK_IDS].sort());
  });

  it("gives every check a group, a title and a level", () => {
    for (const check of GRAPH_TRAVERSAL_CHECKS) {
      expect(check.group, check.id).toBe(check.id.split(".").slice(0, 2).join("."));
      expect(check.title.length, check.id).toBeGreaterThan(0);
      expect(["error", "warning"], check.id).toContain(check.level);
    }
  });

  it("keeps bounded_memory the only warning-level check", () => {
    const warnings = GRAPH_TRAVERSAL_CHECKS.filter((check) => check.level === "warning").map((check) => check.id);
    expect(warnings).toEqual(["graph.streaming.bounded_memory"]);
  });
});

describe("running the profile", () => {
  it("passes against this package's own traversal implementation", async () => {
    const report = await runGraphTraversalConformance();
    expect(report.status).toBe("passed");
    expect(report.summary).toMatchObject({ total: EXPECTED_CHECK_IDS.length, failed: 0, inconclusive: 0 });
  });

  it("reports as a profile, never as a module", async () => {
    const report = await runGraphTraversalConformance();
    expect(report.profile).toEqual({ id: "aadp:graph-traversal", version: "1.0" });
    expect(report).not.toHaveProperty("module");
    expect(report.report_version).toBe("1");
    expect(report.aadp_version).toBe("1.0");
  });

  it("records the deployment a run was performed for", async () => {
    const report = await runGraphTraversalConformance({ baseUrl: "https://example.com" });
    expect(report.base_url).toBe("https://example.com");
  });

  it("records the effective limits, including the caller's budget dimensions", async () => {
    const budget = createRelationsTraversalBudget({ maxDepth: 2, maxNodes: 7 });
    const report = await runGraphTraversalConformance({ budget, timeoutMs: 5_000 });
    expect(report.effective_limits).toMatchObject({ maxDepth: 2, maxNodes: 7, timeoutMs: 5_000 });
  });

  it("emits every result through onCheck, in report order", async () => {
    const seen: CheckResult[] = [];
    const report = await runGraphTraversalConformance({ onCheck: (result) => seen.push(result) });
    expect(seen.map((r) => r.id)).toEqual(report.checks.map((r) => r.id));
  });

  it("never lets an onCheck callback decide the verdict", async () => {
    const report = await runGraphTraversalConformance({
      onCheck: () => {
        throw new Error("reporting blew up");
      },
    });
    expect(report.status).toBe("passed");
  });

  it("accepts the same shared controls the released runners take", async () => {
    const report = await runGraphTraversalConformance({
      urlPolicy: createPermissiveUrlPolicy(),
      allowPrivateNetwork: true,
      retry: { maxAttempts: 2 },
      headers: { authorization: "Bearer test" },
      crossOriginSafeHeaders: ["accept"],
      maxRedirects: 0,
      maxResponseBytes: 1024,
    });
    expect(report.status).toBe("passed");
  });
});

describe("cancellation", () => {
  it("records checks it never started as inconclusive skips, not as passes", async () => {
    const controller = new AbortController();
    controller.abort();
    const report = await runGraphTraversalConformance({ signal: controller.signal });

    expect(report.checks.every((check) => check.status === "skipped")).toBe(true);
    expect(report.summary.inconclusive).toBe(EXPECTED_CHECK_IDS.length);
    // A stopped run is never certified as conformant.
    expect(report.status).toBe("inconclusive");
  });

  it("stops mid-run when the signal fires between checks", async () => {
    const controller = new AbortController();
    const report = await runGraphTraversalConformance({
      signal: controller.signal,
      onCheck: (result) => {
        if (result.id === "graph.capability.exact_match") controller.abort();
      },
    });
    expect(report.summary.inconclusive).toBeGreaterThan(0);
    expect(report.summary.passed).toBeGreaterThan(0);
    expect(report.status).toBe("inconclusive");
  });
});

describe("failOnWarning", () => {
  it("leaves a clean run passing", async () => {
    const report = await runGraphTraversalConformance({ failOnWarning: true });
    expect(report.status).toBe("passed");
    expect(report.summary.warnings).toBe(0);
  });
});

describe("invalid options", () => {
  it.each([
    ["timeoutMs", { timeoutMs: 0 }],
    ["timeoutMs", { timeoutMs: 1.5 }],
    ["maxResponseBytes", { maxResponseBytes: -1 }],
    ["maxRedirects", { maxRedirects: -1 }],
    ["retry.maxAttempts", { retry: { maxAttempts: 0 } }],
    ["baseUrl", { baseUrl: "not-a-url" }],
    ["sampleRootUrl", { sampleRootUrl: "ftp://example.com/a.json" }],
    ["onCheck", { onCheck: "nope" }],
  ])("rejects %s before running any check", async (_option, options) => {
    await expect(runGraphTraversalConformance(options as never)).rejects.toThrow(
      InvalidGraphTraversalConformanceOptionsError
    );
  });

  it("throws before the first check runs", async () => {
    const onCheck = vi.fn();
    await expect(runGraphTraversalConformance({ timeoutMs: 0, onCheck })).rejects.toThrow();
    expect(onCheck).not.toHaveBeenCalled();
  });
});

describe("options the profile deliberately does not have", () => {
  it.each(["maxPages", "concurrency", "maxDepth", "maxNodes", "maxRequests", "maxTotalBytes", "maxCrossOriginRequests", "deadlineMs"])(
    "%s is not an option of this profile",
    async (option) => {
      // Not a type-level assertion (the type gate covers that) but a runtime
      // one: an unknown field must not silently change how the run is bounded.
      const report = await runGraphTraversalConformance({ [option]: 1 } as never);
      expect(report.effective_limits).not.toHaveProperty(option === "maxRedirects" ? "__never" : option);
    }
  );
});

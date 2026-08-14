/**
 * Acceptance rules for a Phase 6 interoperability run.
 *
 * Kept pure and separate from the runner so the decision "does this run count as
 * release evidence" is testable without packing a tarball — and so it is one
 * explicit list rather than an implicit consequence of nothing having thrown.
 *
 * The traversal contract deliberately reports 404s, forbidden targets, invalid
 * documents, budget stops and truncated collections as RESULTS rather than
 * exceptions. A run that completed without throwing therefore says nothing on
 * its own: every condition below has to be checked by name.
 */

/** The six budget dimensions of ADR-0008, by their released field names. */
export const BUDGET_DIMENSIONS = [
  "maxDepth",
  "maxNodes",
  "maxRequests",
  "maxTotalBytes",
  "maxCrossOriginRequests",
  "deadlineMs",
];

/**
 * @param {object} input
 * @param {object|null} input.graph        Collected graph, or null when the walk threw.
 * @param {object|null} input.failure      `{name, message}` when the walk threw.
 * @param {object} input.profile           `runGraphTraversalConformance` report summary.
 * @param {object} input.effectiveLimits   The budget's own limits, read back from its state.
 * @param {boolean} input.loopback         Ran against a loopback fixture.
 * @param {boolean} input.linkedNodeModules Ran without a real clean install.
 * @param {boolean} input.atEnginesFloor   Ran on the `engines.node` floor.
 * @param {string} input.rootUrl
 */
export function evaluateAcceptance(input) {
  const { graph, failure, profile, effectiveLimits, loopback, linkedNodeModules, atEnginesFloor } = input;
  const summary = graph?.summary;
  const rootNode = graph?.nodes?.[0];

  /** @type {{id: string, required: boolean, passed: boolean, message?: string}[]} */
  const checks = [
    {
      id: "walk.did_not_throw",
      required: true,
      passed: !failure,
      message: failure ? `${failure.name}: ${failure.message}` : undefined,
    },
    {
      id: "walk.produced_graph",
      required: true,
      passed: Boolean(graph),
    },
    {
      id: "graph.root_resolved",
      required: true,
      passed: rootNode?.status === "resolved",
      message: rootNode ? `root status ${rootNode.status}` : "no root node was emitted",
    },
    {
      id: "graph.exhausted",
      required: true,
      passed: summary?.stopReason === "exhausted",
      message: summary ? `stopReason ${summary.stopReason}` : undefined,
    },
    {
      // A graph missing a branch is not interoperability evidence, even though
      // the scheduler ran out of work (ADR-0011 §9).
      id: "graph.not_partial",
      required: true,
      passed: summary?.partial === false,
      message: summary ? `partial ${summary.partial}` : undefined,
    },
    {
      id: "profile.passed",
      required: true,
      passed: profile?.status === "passed" && profile?.summary?.failed === 0,
      message: profile ? `profile ${profile.status}, ${profile.summary?.failed ?? "?"} failed` : undefined,
    },
    {
      id: "budget.six_limits_recorded",
      required: true,
      passed: BUDGET_DIMENSIONS.every((name) => Number.isFinite(effectiveLimits?.[name])),
      message: `recorded ${Object.keys(effectiveLimits ?? {}).join(", ") || "nothing"}`,
    },
    {
      id: "run.real_deployment",
      required: true,
      passed: !loopback,
      message: loopback ? "ran against a loopback fixture" : undefined,
    },
    {
      id: "run.clean_install",
      required: true,
      passed: !linkedNodeModules,
      message: linkedNodeModules ? "the repo's node_modules was linked instead of installed" : undefined,
    },
    {
      // Not required for the run to be meaningful, but the release gate wants
      // evidence at the floor, so a run above it is reported as such.
      id: "run.at_engines_floor",
      required: false,
      passed: atEnginesFloor,
      message: atEnginesFloor ? undefined : "ran above the engines.node floor",
    },
  ];

  const failedRequired = checks.filter((check) => check.required && !check.passed);
  const eligible = failedRequired.length === 0;

  return {
    checks,
    eligible_for_release_gate: eligible,
    result: eligible ? "passed" : loopback || linkedNodeModules ? "pipeline-validation" : "failed",
    failed_checks: failedRequired.map((check) => check.id),
  };
}

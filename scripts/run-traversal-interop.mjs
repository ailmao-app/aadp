#!/usr/bin/env node
/**
 * Phase 6 interoperability runner for `ail-aadp/traversal/v1.0`.
 *
 * Drives ONE neutral data set from a packed-tarball clean install and writes the
 * raw evidence the 1.5.0 implementation record must cite. It never invents a
 * result: every field it records comes from a run that actually happened, and
 * any failure exits non-zero without writing a report.
 *
 * Usage:
 *   node scripts/run-traversal-interop.mjs \
 *     --name "Example Orbit" \
 *     --url  "https://example.com/ai/v1.0/entities/answer/pricing.json" \
 *     --owner "Example Orbit Ltd" \
 *     --maintainer-operated false
 *
 * Options:
 *   --out <dir>          Evidence directory. Default docs/records/conformance/1.5.0
 *   --max-depth <n>      Budget maxDepth. Default 3
 *   --max-nodes <n>      Budget maxNodes. Default 50
 *   --max-requests <n>   Budget maxRequests. Default 100
 *   --offline-node-modules
 *                        Link the repo's node_modules instead of installing from
 *                        the registry. For validating THIS script's pipeline
 *                        offline only — never for real Phase 6 evidence, which
 *                        must come from a genuine clean install.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAcceptance } from "./interop-acceptance.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`run-traversal-interop: ${message}`);
  process.exit(1);
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

const args = parseArgs(process.argv.slice(2));

for (const required of ["name", "url", "owner", "maintainer-operated"]) {
  if (!args[required]) {
    fail(
      `--${required} is required. A data set with no name, URL or owner cannot be reproduced or audited, ` +
        "and the release gate exists to prevent exactly that."
    );
  }
}

let target;
try {
  target = new URL(args.url);
} catch {
  fail(`--url is not a valid URL: ${args.url}`);
}
// Pipeline validation against a loopback fixture is the ONLY reason to accept
// anything but HTTPS, and such a run is stamped as non-evidence below.
const loopback = ["127.0.0.1", "::1", "localhost"].includes(target.hostname);
const allowLoopback = args["allow-loopback"] === "true" && loopback;
if (target.protocol !== "https:" && !allowLoopback) {
  fail(
    `--url must be HTTPS for interoperability evidence, got ${target.protocol}` +
      (loopback ? " (pass --allow-loopback to validate this script against a local fixture)" : "")
  );
}
if (!["true", "false"].includes(args["maintainer-operated"])) {
  fail("--maintainer-operated must be true or false");
}

const outDir = path.resolve(repoRoot, args.out ?? path.join("docs", "records", "conformance", "1.5.0"));

/**
 * Any of the six ADR-0008 dimensions may be set; the rest keep the budget
 * factory's own reference defaults. Whatever the caller passes, the report
 * records the limits read back from the BUDGET, not these inputs — that is what
 * makes a run reproducible from its own evidence.
 */
const budgetLimits = {};
for (const [flag, field, minimum] of [
  ["max-depth", "maxDepth", 0],
  ["max-nodes", "maxNodes", 0],
  ["max-requests", "maxRequests", 1],
  ["max-total-bytes", "maxTotalBytes", 1],
  ["max-cross-origin-requests", "maxCrossOriginRequests", 0],
  ["deadline-ms", "deadlineMs", 1],
]) {
  if (args[flag] === undefined) continue;
  const value = Number(args[flag]);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    fail(`--${flag} must be an integer >= ${minimum}, got ${JSON.stringify(args[flag])}`);
  }
  budgetLimits[field] = value;
}
// Keep a walk against someone else's deployment modest unless told otherwise.
budgetLimits.maxDepth ??= 3;
budgetLimits.maxNodes ??= 50;
budgetLimits.maxRequests ??= 100;

const enginesFloor = (
  JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).engines?.node ?? ""
).replace(/^[^\d]*/, "");
if (process.version !== `v${enginesFloor}`) {
  // Not fatal — a newer Node MAY be run in addition — but the release gate
  // requires evidence at the floor, so a run that is not at it says so loudly.
  console.warn(
    `run-traversal-interop: running Node ${process.version}, not the engines floor v${enginesFloor}. ` +
      "Phase 6 requires evidence at the floor; run this again there before closing the gate."
  );
}

console.log(`[1/5] building and packing ${repoRoot}`);
run("npm", ["run", "build"], repoRoot);
const packDir = mkdtempSync(path.join(tmpdir(), "aadp-interop-pack-"));
const packed = run("npm", ["pack", "--pack-destination", packDir], repoRoot).trim().split("\n").pop().trim();
const tarballPath = path.join(packDir, packed);
const tarballDigest = `sha256:${createHash("sha256").update(readFileSync(tarballPath)).digest("hex")}`;
console.log(`      ${packed}\n      ${tarballDigest}`);

console.log("[2/5] creating a clean install from the tarball");
const installDir = mkdtempSync(path.join(tmpdir(), "aadp-interop-install-"));
writeFileSync(
  path.join(installDir, "package.json"),
  `${JSON.stringify({ name: "aadp-interop-consumer", private: true, type: "module", version: "0.0.0" }, null, 2)}\n`
);
copyFileSync(tarballPath, path.join(installDir, packed));

if (args["offline-node-modules"] === "true") {
  // Pipeline validation only. Extracts the tarball and borrows the repo's
  // dependency tree, exactly as the package tests do, so the script itself can
  // be exercised without a registry. Recorded in the evidence so a reader can
  // never mistake such a run for a real clean install.
  run("tar", ["-xzf", packed], installDir);
  const extracted = path.join(installDir, "package");
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(extracted, "node_modules"), "junction");
  mkdirSync(path.join(installDir, "node_modules"), { recursive: true });
  symlinkSync(extracted, path.join(installDir, "node_modules", "ail-aadp"), "junction");
} else {
  run("npm", ["install", packed, "--omit=dev", "--no-audit", "--no-fund"], installDir);
}

console.log("[3/5] running the traversal walk from the installed package");
// The probe imports ONLY published subpaths: the traversal entry point, and the
// Relations one for the budget factory the caller is required to own.
const probe = `
import { createRelationsTraversalBudget } from "ail-aadp/modules/relations/v1.0";
${allowLoopback ? 'import { createPermissiveUrlPolicy } from "ail-aadp/client/v1.0";' : ""}
import {
  registerBuiltinTraversalAdapters,
  collectGraphV1,
  runGraphTraversalConformance,
} from "ail-aadp/traversal/v1.0";

registerBuiltinTraversalAdapters();

const walkOptions = ${allowLoopback ? "{ urlPolicy: createPermissiveUrlPolicy() }" : "{}"};
const budget = createRelationsTraversalBudget(${JSON.stringify(budgetLimits)});
const startedAt = new Date().toISOString();
const started = Date.now();

let graph;
let failure;
try {
  graph = await collectGraphV1(${JSON.stringify(args.url)}, { ...walkOptions, budget });
} catch (err) {
  failure = { name: err?.name ?? "Error", message: err?.message ?? String(err) };
}

const profile = await runGraphTraversalConformance();

console.log(
  "@@RESULT@@" +
    JSON.stringify({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      node_version: process.version,
      failure,
      graph: graph
        ? {
            summary: graph.summary,
            nodes: graph.nodes.map((n) => ({ key: n.key, depth: n.depth, status: n.status })),
            edges: graph.edges.map((e) => ({
              edgeGroup: e.edgeGroup,
              index: e.index,
              outcome: e.outcome,
              status: e.status ?? null,
            })),
            expansions: graph.expansions.map((x) => ({
              extensionField: x.extensionField,
              outcome: x.outcome,
              plannedEdges: x.plannedEdges,
            })),
          }
        : null,
      budget: {
        // Read back from the budget itself, so every one of ADR-0008's six
        // dimensions is recorded at the value actually in force — including the
        // ones the caller never passed.
        effective_limits: {
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
          maxRequests: budget.maxRequests,
          maxTotalBytes: budget.maxTotalBytes,
          maxCrossOriginRequests: budget.maxCrossOriginRequests,
          deadlineMs: budget.deadlineMs,
        },
        requested_limits: ${JSON.stringify(budgetLimits)},
        nodesVisited: budget.nodesVisited,
        requestsMade: budget.requestsMade,
        crossOriginRequestsMade: budget.crossOriginRequestsMade,
        bytesFetched: budget.bytesFetched,
      },
      profile: { status: profile.status, summary: profile.summary, package_version: profile.package_version },
    })
);
`;
writeFileSync(path.join(installDir, "probe.mjs"), probe);

let stdout;
try {
  stdout = execFileSync(process.execPath, ["probe.mjs"], {
    cwd: installDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (err) {
  fail(`the probe failed to run: ${err.message}`);
}

const marker = stdout.indexOf("@@RESULT@@");
if (marker === -1) fail("the probe produced no result");
const result = JSON.parse(stdout.slice(marker + "@@RESULT@@".length));

console.log("[4/5] recording evidence");
const slug = args.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
mkdirSync(outDir, { recursive: true });

const acceptance = evaluateAcceptance({
  graph: result.graph,
  failure: result.failure,
  profile: result.profile,
  effectiveLimits: result.budget.effective_limits,
  loopback: allowLoopback,
  linkedNodeModules: args["offline-node-modules"] === "true",
  atEnginesFloor: result.node_version === `v${enginesFloor}`,
  rootUrl: args.url,
});

const evidence = {
  phase: "1.5.0 Phase 6 — neutral interoperability",
  data_set: {
    name: args.name,
    url: args.url,
    owner: args.owner,
    operated_by_aadp_maintainers: args["maintainer-operated"] === "true",
  },
  run: {
    node_version: result.node_version,
    tarball: packed,
    tarball_digest: tarballDigest,
    clean_install: args["offline-node-modules"] === "true" ? "NO — repo node_modules linked (pipeline validation only)" : "yes",
    // Stamped so no reader can mistake a smoke run for interoperability
    // evidence. A real Phase 6 run has neither of these.
    ...(allowLoopback ? { evidence: "NO — loopback fixture, pipeline validation only" } : {}),
    // The invocation as it actually ran, flags included — a reconstructed
    // "canonical" command could hide the very flags that make a run
    // non-evidence.
    command: ["node", "scripts/run-traversal-interop.mjs", ...process.argv.slice(2)].join(" "),
    node_engines_floor: enginesFloor,
    node_at_engines_floor: result.node_version === `v${enginesFloor}`,
    imports: ["ail-aadp/traversal/v1.0", "ail-aadp/modules/relations/v1.0"],
    started_at: result.started_at,
    finished_at: result.finished_at,
    duration_ms: result.duration_ms,
  },
  budget: result.budget,
  // The two counters mean different things (ADR-0011 §9): `summary.requests`
  // counts logical canonical-target resolutions this walk started, while
  // `budget.requestsMade` counts physical HTTP attempts.
  accounting: {
    summary_requests: result.graph?.summary?.requests ?? null,
    budget_requests_made: result.budget.requestsMade,
  },
  graph: result.graph,
  conformance_profile: result.profile,
  failure: result.failure ?? null,
  // Every acceptance condition by name — a run is evidence only when all the
  // required ones hold, never merely because nothing threw.
  acceptance_checks: acceptance.checks,
  failed_checks: acceptance.failed_checks,
  eligible_for_release_gate: acceptance.eligible_for_release_gate,
  result: acceptance.result,
};

// Timestamp + tarball digest in the name: a rerun on another Node, another
// tarball or other options is a DIFFERENT run, and raw evidence is append-only.
const stamp = result.started_at.replace(/[:.]/g, "-");
const shortDigest = tarballDigest.slice("sha256:".length, "sha256:".length + 12);
const evidenceFile = path.join(outDir, `${slug}-${stamp}-${shortDigest}.json`);
writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);

console.log("[5/5] done");
console.log(`      evidence: ${path.relative(repoRoot, evidenceFile)}`);
console.log(`      result:   ${evidence.result} (release-gate eligible: ${evidence.eligible_for_release_gate})`);
console.log(`      nodes ${result.graph?.summary?.nodes ?? 0}, edges ${result.graph?.summary?.edges ?? 0}, ` +
  `summary.requests ${evidence.accounting.summary_requests}, budget.requestsMade ${evidence.accounting.budget_requests_made}`);
console.log(`      profile: ${result.profile.status} (${result.profile.summary.passed}/${result.profile.summary.total})`);
for (const check of acceptance.checks.filter((c) => !c.passed)) {
  console.log(`      ${check.required ? "FAILED" : "note"}  ${check.id}${check.message ? ` — ${check.message}` : ""}`);
}

rmSync(packDir, { recursive: true, force: true });
rmSync(installDir, { recursive: true, force: true });

// A failed run keeps its report — it is how a deployment's problem gets
// diagnosed — but the exit code never lets it be mistaken for a closed gate.
if (!evidence.eligible_for_release_gate) process.exit(1);

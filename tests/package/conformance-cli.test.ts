import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle } from "../conformance/v1.0/mock-server.js";
import { packAndExtractTarball, cleanupTarball, runPackedCli, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Clean-install verification for the `aadp-conformance` CLI
 * (AADP-CONFORMANCE-002): builds the package, packs the real tarball,
 * unpacks it somewhere else, and runs the binary from *there* against a
 * live server. Running the CLI out of the source tree would prove nothing
 * about what a consumer receives — the defect this guards against is a
 * CLI that works in-repo but is missing from `files`/`bin`, or that
 * imports something only the source tree has.
 *
 * Dependencies are linked from the repo's own `node_modules` rather than
 * installed from the network, so this stays hermetic and offline: what is
 * being verified is the tarball's contents and entry points, not npm's
 * ability to resolve `ajv`.
 */

let server: MockServerHandle;
let tarball: PackedTarball;

function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return runPackedCli(tarball.packageDir, path.join("dist", "conformance", "cli.js"), args);
}

/**
 * The runner never derives a URL for the negative-path checks, so a run
 * meant to reach a conclusive verdict has to name them (see
 * `ConformanceOptions.negativeTargets`).
 */
const NEGATIVE_TARGET_FLAGS = (): string[] => [
  "--unknown-entity-url",
  `${server.baseUrl}/ai/v1.0/entities/example/aadp-conformance-does-not-exist.json`,
  "--unknown-type-url",
  `${server.baseUrl}/ai/v1.0/sitemaps/aadp-conformance-unknown-type.json`,
];

beforeAll(async () => {
  server = await startMockServer();
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await server?.close();
  if (tarball) cleanupTarball(tarball);
});

describe("aadp-conformance, run from the packed tarball", () => {
  it("ships the CLI entry point the bin field points at", () => {
    const pkg = JSON.parse(readFileSync(path.join(tarball.packageDir, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin["aadp-conformance"]).toBe("dist/conformance/cli.js");
    expect(existsSync(path.join(tarball.packageDir, pkg.bin["aadp-conformance"]))).toBe(true);
  });

  it("prints usage without reaching the network", async () => {
    const result = await runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("aadp-conformance");
    expect(result.stdout).toContain("--allow-private-network");
    expect(result.stdout).toContain("Exit codes");
  });

  it("exits 0 and prints a passing text report for a conformant deployment", async () => {
    const result = await runCli([server.baseUrl, "--allow-private-network", ...NEGATIVE_TARGET_FLAGS()]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("manifest.http");
    expect(result.stdout).toContain("RESULT: PASSED");
  });

  it("emits a parseable report on stdout with --json, and nothing else", async () => {
    const result = await runCli([server.baseUrl, "--allow-private-network", "--json", ...NEGATIVE_TARGET_FLAGS()]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as { report_version: string; status: string; checks: unknown[] };
    expect(report.report_version).toBe("1");
    expect(report.status).toBe("passed");
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it("writes a JUnit XML report to --junit without disturbing stdout", async () => {
    const junitPath = path.join(tarball.workDir, "report.junit.xml");
    const result = await runCli([
      server.baseUrl,
      "--allow-private-network",
      "--junit",
      junitPath,
      ...NEGATIVE_TARGET_FLAGS(),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("RESULT: PASSED");
    const junit = readFileSync(junitPath, "utf8");
    expect(junit).toContain("<?xml version=\"1.0\"");
    expect(junit).toContain("<testsuite ");
    expect(junit).toContain("manifest.http");
  });

  it("exits 1 when a check fails", async () => {
    // --fail-on-warning turns the mock's instruction-shaped usage_guidance
    // warning into a failing verdict, without needing a broken fixture.
    const result = await runCli([
      server.baseUrl,
      "--allow-private-network",
      "--fail-on-warning",
      ...NEGATIVE_TARGET_FLAGS(),
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("RESULT: FAILED");
  });

  it("exits 4 when a traversal budget leaves the run unfinished", async () => {
    const result = await runCli([server.baseUrl, "--allow-private-network", "--max-pages", "1"]);
    expect(result.status).toBe(4);
    expect(result.stdout).toContain("RESULT: INCONCLUSIVE");
  });

  it("exits 4 when the error envelope was never exercised", async () => {
    // No --unknown-entity-url/--unknown-type-url: those checks reach no
    // verdict, so the run must not report success.
    const result = await runCli([server.baseUrl, "--allow-private-network"]);
    expect(result.status).toBe(4);
    expect(result.stdout).toContain("RESULT: INCONCLUSIVE");
  });

  it("exits 2 for an option value the runner cannot use", async () => {
    const result = await runCli([server.baseUrl, "--allow-private-network", "--max-pages", "0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid conformance option");
  });

  it("exits 2, never 0, for a malformed --header — an action error must never look like an untouched success", async () => {
    // parseHeaders() throws from inside the action callback, not through
    // Commander's own argv parser/exitOverride() — regression for a run
    // that never happened being silently reported as exit 0 with no
    // stdout/stderr.
    const result = await runCli([server.baseUrl, "--allow-private-network", "--header", "malformed"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--header must be "Name: value"');
    expect(result.stdout).toBe("");
  });

  it("exits 2 when the run cannot be performed", async () => {
    // Default strict policy refuses the loopback origin: the run never
    // reaches a verdict, which must not look like a pass.
    const result = await runCli([server.baseUrl]);
    expect(result.status).toBe(2);
  });

  it("exits 3 for a version this runner cannot exercise", async () => {
    const result = await runCli([server.baseUrl, "--allow-private-network", "--protocol-version", "0.1"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("Unsupported AADP conformance version");
  });

  it("exits 2, never 1, for an unusable argv — a bad flag must never look like a failed conformance run", async () => {
    // Exit 1 is documented as "one or more checks failed" — a run that
    // never started (missing argument, unknown flag, or an unparseable
    // numeric option) belongs in exit 2 ("could not be performed") instead,
    // the same class `InvalidConformanceOptionsError` uses. A CI job that
    // greps `$? === 1` for "nonconformant" must not misread a typo'd flag
    // as a real failure.
    const missingArg = await runCli([]);
    expect(missingArg.status).toBe(2);

    const unknownFlag = await runCli([server.baseUrl, "--not-a-real-flag"]);
    expect(unknownFlag.status).toBe(2);
  });

  it.each([
    ["--timeout", "abc"],
    ["--timeout", "Infinity"],
    ["--timeout", "-1"],
    ["--timeout", "1.5"],
    ["--max-redirects", "NaN"],
    ["--max-response-bytes", "abc"],
    ["--max-entities", "1.5"],
    ["--max-sitemaps", "-3"],
    ["--deadline", "Infinity"],
  ])("exits 2 for %s %s — never 1, never a silent success", async (flag, value) => {
    const result = await runCli([server.baseUrl, "--allow-private-network", flag, value]);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("RESULT: PASSED");
  });

  it("exits 2 and never fakes a passing report when --junit cannot be written", async () => {
    const unwritablePath = path.join(tarball.workDir, "no-such-directory", "report.junit.xml");
    const result = await runCli([
      server.baseUrl,
      "--allow-private-network",
      "--junit",
      unwritablePath,
      ...NEGATIVE_TARGET_FLAGS(),
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("RESULT: PASSED");
    expect(result.stderr).toContain("Could not write JUnit report");
    expect(existsSync(unwritablePath)).toBe(false);
  });

  it("exits 2 and never fakes a passing report when --output cannot be written", async () => {
    const unwritablePath = path.join(tarball.workDir, "no-such-directory", "report.json");
    const result = await runCli([
      server.baseUrl,
      "--allow-private-network",
      "--output",
      unwritablePath,
      ...NEGATIVE_TARGET_FLAGS(),
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("RESULT: PASSED");
    expect(existsSync(unwritablePath)).toBe(false);
  });
});

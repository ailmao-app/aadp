import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle } from "../conformance/v1.0/mock-server.js";

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD_TIMEOUT_MS = 180_000;

let server: MockServerHandle;
let packageDir: string;
let workDir: string;

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Runs the packed CLI, resolving with its exit code and streams instead
 * of throwing. Deliberately asynchronous: the mock server runs in *this*
 * process, so a synchronous spawn would block the event loop that has to
 * answer the CLI's requests, and every run would time out.
 */
function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(packageDir, "dist", "conformance", "cli.js"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
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

  run("npm", ["run", "build"], repoRoot);
  workDir = mkdtempSync(path.join(tmpdir(), "aadp-cli-"));
  run("npm", ["pack", "--pack-destination", JSON.stringify(workDir)], repoRoot);
  const tarball = readdirSync(workDir).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack produced no tarball in ${workDir}`);
  // Relative name, extracted from `workDir`: a Windows absolute path
  // (`C:\...`) makes GNU tar read the drive letter as a remote host.
  run("tar", ["-xzf", tarball], workDir);

  packageDir = path.join(workDir, "package");
  // `junction` needs no elevation on Windows, unlike a directory symlink.
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(packageDir, "node_modules"), "junction");
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
  await server?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("aadp-conformance, run from the packed tarball", () => {
  it("ships the CLI entry point the bin field points at", () => {
    const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin["aadp-conformance"]).toBe("dist/conformance/cli.js");
    expect(existsSync(path.join(packageDir, pkg.bin["aadp-conformance"]))).toBe(true);
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
});

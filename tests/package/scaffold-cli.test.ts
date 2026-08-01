import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Clean-install exit-code contract for the `aadp` scaffold CLI
 * (AADP-COMPAT-001 §4.2): `init`/`add-resource` succeed (exit 0) on a
 * fresh directory and fail with exit 1 when a target file already exists
 * and `--force` is not passed, run from the packed tarball.
 *
 * Scaffold writes relative to `process.cwd()`, so each case needs its own
 * working directory — `runPackedCli` from `tarball-helpers.ts` always runs
 * with the harness's own cwd, so this spawns directly instead.
 */

let tarball: PackedTarball;
let workDir: string;

function runScaffold(args: string[], cwd: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(tarball.packageDir, "dist", "scaffold", "cli.js"), ...args], {
      cwd,
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

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("aadp scaffold CLI, run from the packed tarball", () => {
  it("`aadp init` writes a starter config and exits 0", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "aadp-scaffold-"));
    const result = await runScaffold(["init"], workDir);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(workDir, "aadp", "aadp.server.ts"))).toBe(true);
  });

  it("`aadp init` exits 1 without --force when the file already exists", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "aadp-scaffold-"));
    await runScaffold(["init"], workDir);
    const result = await runScaffold(["init"], workDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("`aadp add-resource <type>` writes a starter resource file and exits 0", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "aadp-scaffold-"));
    await runScaffold(["init"], workDir);
    const result = await runScaffold(["add-resource", "post"], workDir);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(workDir, "aadp", "resources", "post.ts"))).toBe(true);
  });

  it("`aadp add-resource <type>` exits 1 without --force when the file already exists", async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "aadp-scaffold-"));
    await runScaffold(["init"], workDir);
    await runScaffold(["add-resource", "post"], workDir);
    const result = await runScaffold(["add-resource", "post"], workDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already exists");
  });
});

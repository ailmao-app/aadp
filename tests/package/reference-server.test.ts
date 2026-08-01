import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, runPackedCli, repoRoot, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Interop smoke test for `examples/reference-server` (AADP-INTEROP-001
 * §5.3/§5.4): copies the example out of the repo, installs `ail-aadp` from
 * the packed tarball (a `node_modules` symlink into the extracted tarball,
 * same hermetic substitute the other package tests use instead of a real
 * network install), starts it as a child process, and runs the packed
 * `aadp-conformance` CLI against it end to end. Proves the example never
 * reaches into `src/`/the workspace, and that the server it produces is
 * actually conformant — not just that it starts.
 */

const READY_DEADLINE_MS = 15_000;
const STARTUP_TIMEOUT_MS = 180_000;

let tarball: PackedTarball;
let exampleDir: string;
let server: ChildProcess | undefined;

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

afterEach(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server?.once("exit", resolve));
  }
  server = undefined;
  if (exampleDir) rmSync(exampleDir, { recursive: true, force: true });
});

function installExample(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aadp-reference-server-"));
  cpSync(path.join(repoRoot, "examples", "reference-server"), dir, { recursive: true });
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  // `junction` needs no elevation on Windows, unlike a directory symlink.
  symlinkSync(tarball.packageDir, path.join(dir, "node_modules", "ail-aadp"), "junction");
  return dir;
}

/** Starts `src/server.js` on an ephemeral port and resolves once it prints its base URL. */
function startExample(dir: string, env: Record<string, string> = {}): Promise<{ baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: dir,
      env: { ...process.env, PORT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server = child;

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Reference server did not report readiness within ${READY_DEADLINE_MS}ms.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, READY_DEADLINE_MS);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      const match = /listening on (http:\/\/\S+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve({ baseUrl: match[1] });
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Reference server exited before reporting readiness (code ${code}).\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}

async function runConformance(baseUrl: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return runPackedCli(tarball.packageDir, path.join("dist", "conformance", "cli.js"), [
    baseUrl,
    "--allow-private-network",
    "--unknown-entity-url",
    `${baseUrl}/ai/v1.0/entities/note/aadp-conformance-does-not-exist.json`,
    "--unknown-type-url",
    `${baseUrl}/ai/v1.0/sitemaps/aadp-conformance-unknown-type.json`,
  ]);
}

describe("examples/reference-server, installed from the packed tarball", () => {
  it(
    "starts, publishes a conformant manifest->sitemap->entity chain at the default routes",
    async () => {
      exampleDir = installExample();
      const { baseUrl } = await startExample(exampleDir);
      const result = await runConformance(baseUrl);
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("RESULT: PASSED");
    },
    STARTUP_TIMEOUT_MS
  );

  it(
    "publishes the same conformant chain at custom routes when AADP_CUSTOM_ROUTES=1",
    async () => {
      exampleDir = installExample();
      const { baseUrl } = await startExample(exampleDir, { AADP_CUSTOM_ROUTES: "1" });
      const manifestRes = await fetch(`${baseUrl}/.well-known/ai-manifest.json`);
      const manifest = (await manifestRes.json()) as { discovery: { sitemap_index: string } };
      expect(manifest.discovery.sitemap_index).toBe(`${baseUrl}/discovery/index.json`);

      const result = await runPackedCli(tarball.packageDir, path.join("dist", "conformance", "cli.js"), [
        baseUrl,
        "--allow-private-network",
        "--unknown-entity-url",
        `${baseUrl}/discovery/entities/note/aadp-conformance-does-not-exist.json`,
        "--unknown-type-url",
        `${baseUrl}/discovery/sitemaps/aadp-conformance-unknown-type.json`,
      ]);
      expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    },
    STARTUP_TIMEOUT_MS
  );
});

import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, runPackedCli, repoRoot, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";
// The example itself only ever imports `ail-aadp` from the packed tarball;
// this is the test's own checker, so importing it from source is fine.
import { validateAnswerEntityV1 } from "../../src/modules/answer/v1.0/entity.js";

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

/**
 * Starts `src/server.js` on an ephemeral port and resolves once it prints
 * its base URL. `boundUrl` is where the process can actually be reached —
 * the same as `baseUrl` unless `AADP_BASE_URL` publishes a different origin
 * (the reverse-proxy case), which is how a run can publish HTTPS URLs while
 * the test still talks to it over the local socket.
 */
function startExample(dir: string, env: Record<string, string> = {}): Promise<{ baseUrl: string; boundUrl: string }> {
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
      const match = /listening on (\S+)/.exec(stdout);
      // The optional `Bound to` line sits between these two, so keying
      // readiness off the last line printed avoids resolving before it.
      if (!match || !/^Manifest: /m.test(stdout)) return;
      const bound = /Bound to (http:\/\/\S+)/.exec(stdout);
      clearTimeout(timer);
      resolve({ baseUrl: match[1], boundUrl: bound ? bound[1] : match[1] });
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

  it(
    "publishes an Answer 1.0 entity through the generic module support, declared in the manifest",
    async () => {
      exampleDir = installExample();
      // Answer 1.0 requires an absolute HTTPS `canonical_url`, so publish
      // under an HTTPS origin (the reverse-proxy configuration) while still
      // talking to the process over its local socket.
      const publishedBaseUrl = "https://reference-server.example.com";
      const { baseUrl, boundUrl } = await startExample(exampleDir, { AADP_BASE_URL: publishedBaseUrl });
      expect(baseUrl).toBe(publishedBaseUrl);

      const manifest = (await (await fetch(`${boundUrl}/.well-known/ai-manifest.json`)).json()) as {
        modules?: { id: string; version: string; schema: string }[];
      };
      expect(manifest.modules).toEqual([
        { id: "aadp:answer", version: "1.0", schema: "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json" },
      ]);

      const entity = await (await fetch(`${boundUrl}/ai/v1.0/entities/answer/what-is-aadp.json`)).json();

      // End-to-end proof the example's `x_answer` really is Answer 1.0:
      // core envelope, wrapper schema, every pure semantic invariant
      // (including `content_checksum`), the canonical-URL policy, and
      // `freshness.updated_at === entity.updated_at`.
      const validation = validateAnswerEntityV1(entity);
      expect(
        { errors: validation.errors, semanticIssues: validation.semanticIssues },
        "published answer entity failed Answer 1.0 entity-context validation"
      ).toEqual({ errors: [], semanticIssues: [] });
      expect(validation.valid).toBe(true);
      expect(validation.entity?.entity.canonical_url).toBe(`${publishedBaseUrl}/answers/what-is-aadp`);

      // Related targets are the note entities this same deployment serves,
      // so they must be fetchable rather than decorative.
      const references = validation.entity?.answer.related_entities ?? [];
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference.target.url.startsWith(publishedBaseUrl)).toBe(true);
        const target = await fetch(reference.target.url.replace(publishedBaseUrl, boundUrl));
        expect(target.status, `target ${reference.target.id}`).toBe(200);
        expect(((await target.json()) as { id: string }).id).toBe(reference.target.id);
      }
    },
    STARTUP_TIMEOUT_MS
  );

  it(
    "never publishes a URL derived from a request's Host header, even as the first request",
    async () => {
      exampleDir = installExample();
      const { baseUrl } = await startExample(exampleDir);

      // First request ever handled names an attacker-controlled Host.
      // Regression: the server used to build its `defineAADP()` instance
      // lazily from the first request's Host header and cache it for the
      // process lifetime, so this alone would permanently repoint every
      // published discovery URL at "attacker.example" — for this request
      // and every one after it.
      const poisoned = await fetch(`${baseUrl}/.well-known/ai-manifest.json`, {
        headers: { Host: "attacker.example" },
      });
      const poisonedManifest = (await poisoned.json()) as { discovery: { sitemap_index: string } };
      expect(poisonedManifest.discovery.sitemap_index).toBe(`${baseUrl}/ai/v1.0/sitemap-index.json`);
      expect(poisonedManifest.discovery.sitemap_index).not.toContain("attacker.example");

      // A normal request afterward must see the same, unpoisoned origin.
      const normal = await fetch(`${baseUrl}/.well-known/ai-manifest.json`);
      const normalManifest = (await normal.json()) as { discovery: { sitemap_index: string } };
      expect(normalManifest.discovery.sitemap_index).toBe(`${baseUrl}/ai/v1.0/sitemap-index.json`);
    },
    STARTUP_TIMEOUT_MS
  );
});

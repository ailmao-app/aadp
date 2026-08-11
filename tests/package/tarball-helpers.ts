import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "vitest";

/**
 * Shared clean-install fixture for every "does the published tarball
 * actually work" test (AADP-COMPAT-001/AADP-109-002): builds the package,
 * packs the real tarball, and unpacks it into its own directory. Consumers
 * import/spawn from `packageDir`, never from the repo's `src/`, so a public
 * export or CLI entry point that only works in-repo (missing from `files`
 * or `bin`) fails here instead of in a real install.
 *
 * `node_modules` is a junction into the repo's own install rather than a
 * real `npm install`, so this stays hermetic and offline — what's under
 * test is the tarball's own contents and entry points, not npm's ability to
 * resolve `ajv`/`undici`/etc. from the network.
 */

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILD_TIMEOUT_MS = 180_000;

/**
 * Per-test budget for suites that import or spawn out of an extracted
 * tarball, applied with `vi.setConfig` so it stays scoped to those files
 * instead of loosening the default 5s every other suite relies on to catch
 * a hang.
 *
 * The default is not a meaningful budget here: the first import in a file
 * pays for a cold read of a just-unpacked 259-file package, and for the
 * root entry point that means the whole `dist/` graph in one call. On a
 * slow or contended filesystem — Windows with an on-access virus scanner,
 * a loaded CI runner — that alone exceeded 5s and failed
 * `exports.test.ts`'s first case while every later case, served from the
 * module cache, finished in milliseconds. Nothing here asserts speed, so
 * the timeout only needs to be far enough above the real cost to stop
 * reporting machine load as a missing export.
 */
export const PACKED_IMPORT_TIMEOUT_MS = 30_000;

export interface PackedTarball {
  packageDir: string;
  workDir: string;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Extracts a copy of the tarball built once for the whole run (see
 * `global-setup.ts`) into its own throwaway directory. Call once per suite
 * in `beforeAll`.
 *
 * The build+pack itself does NOT happen here anymore: it used to, and since
 * Vitest runs test files in parallel workers, one file's `npm run build`
 * could rewrite `dist/**` mid-read of another file's concurrent `npm pack`
 * against the same shared `repoRoot`, an intermittent `npm error code EOF`
 * (CI, 2026-08-03). `global-setup.ts` now builds/packs exactly once, before
 * any worker starts, and hands every worker the resulting `.tgz` path
 * through `provide()`/`inject()` — this function only ever copies and
 * extracts that already-built artifact, so no two workers can race on it.
 */
export function packAndExtractTarball(): PackedTarball {
  const sharedTarballPath = inject("sharedTarballPath");
  const workDir = mkdtempSync(path.join(tmpdir(), "aadp-pkg-"));
  const tarball = path.basename(sharedTarballPath);
  copyFileSync(sharedTarballPath, path.join(workDir, tarball));
  // Relative name, extracted from `workDir`: a Windows absolute path
  // (`C:\...`) makes GNU tar read the drive letter as a remote host.
  run("tar", ["-xzf", tarball], workDir);

  const packageDir = path.join(workDir, "package");
  // `junction` needs no elevation on Windows, unlike a directory symlink.
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(packageDir, "node_modules"), "junction");

  return { packageDir, workDir };
}

export function cleanupTarball({ workDir }: PackedTarball): void {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}

/**
 * Runs a packed binary (a `dist/.../cli.js` entry point), resolving with
 * its exit code and streams instead of throwing. Deliberately asynchronous
 * so a caller can run a server in the same process the CLI talks to
 * without deadlocking the event loop.
 */
export function runPackedCli(
  packageDir: string,
  binRelPath: string,
  args: string[]
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(packageDir, binRelPath), ...args], {
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

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export interface PackedTarball {
  packageDir: string;
  workDir: string;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

/** Builds `dist/`, packs the tarball, and extracts it. Call once per suite in `beforeAll`. */
export function packAndExtractTarball(): PackedTarball {
  run("npm", ["run", "build"], repoRoot);
  const workDir = mkdtempSync(path.join(tmpdir(), "aadp-pkg-"));
  run("npm", ["pack", "--pack-destination", JSON.stringify(workDir)], repoRoot);
  const tarball = readdirSync(workDir).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error(`npm pack produced no tarball in ${workDir}`);
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

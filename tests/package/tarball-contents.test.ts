import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, inject } from "vitest";

/**
 * What the tarball CONTAINS, asserted against the real `npm pack` output
 * rather than against the `files` config — the two are not the same thing,
 * and this suite exists because they diverged.
 *
 * `files` lists `examples`, and npm's built-in "never pack node_modules"
 * rule does NOT apply inside a directory the allow-list names explicitly.
 * So installing dependencies under `examples/reference-server` — which
 * running that example requires — silently turned the release candidate
 * into 1,294 files / 5.2 MB with a recursive copy of `ail-aadp` and its
 * whole dependency tree inside it (2026-08-10 release review). Nothing
 * failed: `npm pack` exited 0, and a clean CI checkout has no such
 * directory, so the defect was invisible exactly where it mattered — on
 * the maintainer's machine, at publish time.
 *
 * The fix is the `node_modules` negation entry in `files`; this asserts the
 * result, so the guarantee survives a future `files` edit that reintroduces
 * a broad directory entry.
 */

/** Entry paths inside the shared tarball built once in `global-setup.ts`. */
function tarballEntries(): string[] {
  const tarballPath = inject("sharedTarballPath");
  // Relative name, listed from its own directory: a Windows absolute path
  // (`C:\...`) makes GNU tar read the drive letter as a remote host — the
  // same reason `packAndExtractTarball()` extracts by basename.
  const output = execFileSync("tar", ["-tzf", path.basename(tarballPath)], {
    cwd: path.dirname(tarballPath),
    encoding: "utf8",
    shell: true,
  });
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

describe("packed tarball contents", () => {
  it("ships no node_modules directory, at any depth", () => {
    const offenders = tarballEntries().filter((entry) => entry.split("/").includes("node_modules"));
    expect(offenders).toEqual([]);
  });

  it("still ships the example source the exclusion sits next to", () => {
    // The negation must not over-exclude: `examples/` is packaged on
    // purpose (a consumer reads it as the reference deployment), and an
    // exclusion that quietly took the whole directory with it would leave
    // this suite green while shipping a broken example.
    const entries = tarballEntries();
    for (const expected of [
      "package/examples/reference-server/package.json",
      "package/examples/reference-server/src/server.js",
      "package/examples/reference-server/README.md",
    ]) {
      expect(entries).toContain(expected);
    }
  });

  it("ships only paths under the package root", () => {
    const stray = tarballEntries().filter((entry) => !entry.startsWith("package/"));
    expect(stray).toEqual([]);
  });
});

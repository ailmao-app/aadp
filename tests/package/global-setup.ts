import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { repoRoot } from "./tarball-helpers.js";

/**
 * Builds `dist/` and packs the tarball exactly once, before any test file's
 * worker starts, and hands the resulting `.tgz` path to every worker via
 * `provide()`.
 *
 * Previously each `tests/package/*.test.ts` file ran its own
 * `npm run build && npm pack` against this same `repoRoot` in `beforeAll`
 * (`packAndExtractTarball()` in `tarball-helpers.ts`). Vitest runs test
 * files in parallel workers by default, so one file's `tsc` build could
 * rewrite `dist/**` mid-read of another file's concurrent `npm pack`,
 * surfacing as a flaky `npm error code EOF` reading a `dist/*.js` file (seen
 * in CI 2026-08-03). Doing the build/pack once here, serially, before any
 * worker exists removes the overlap entirely: `packAndExtractTarball()` now
 * only extracts (`tar -xzf`) this already-built shared tarball into its own
 * throwaway directory per test file.
 */
export default async function setup({ provide }: TestProject): Promise<void> {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit", shell: true });

  const packDestination = mkdtempSync(path.join(tmpdir(), "aadp-shared-pack-"));
  execFileSync("npm", ["pack", "--pack-destination", JSON.stringify(packDestination)], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  const tarballName = readdirSync(packDestination).find((entry) => entry.endsWith(".tgz"));
  if (!tarballName) throw new Error(`npm pack produced no tarball in ${packDestination}`);

  provide("sharedTarballPath", path.join(packDestination, tarballName));
}

declare module "vitest" {
  export interface ProvidedContext {
    sharedTarballPath: string;
  }
}

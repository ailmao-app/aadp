import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, runPackedCli, repoRoot, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Clean-install exit-code contract for `aadp-validate` (AADP-COMPAT-001
 * §4.2): every documented exit code (0/1/2/3), run from the packed tarball
 * against local fixture files, so a change to the CLI's exit codes is
 * caught the way a consumer's CI (which greps `$?`, not stdout prose)
 * would notice it.
 */

let tarball: PackedTarball;
let fixtureDir: string;

function runValidate(args: string[]) {
  return runPackedCli(tarball.packageDir, path.join("dist", "validator", "cli.js"), args);
}

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

afterEach(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixture(name: string, contents: string): string {
  fixtureDir = mkdtempSync(path.join(tmpdir(), "aadp-validate-"));
  const filePath = path.join(fixtureDir, name);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

describe("aadp-validate, run from the packed tarball", () => {
  it("exits 0 for a valid document", async () => {
    const manifestPath = path.join(repoRoot, "examples", "v1.0", "manifest.json");
    const result = await runValidate(["manifest", manifestPath]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  it("exits 1 when the document fails schema validation", async () => {
    const badPath = writeFixture("bad-manifest.json", JSON.stringify({ aadp_version: "1.0" }));
    const result = await runValidate(["manifest", badPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("INVALID");
  });

  it("exits 2 for an unknown kind", async () => {
    const anyPath = writeFixture("anything.json", "{}");
    const result = await runValidate(["not-a-kind", anyPath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown kind");
  });

  it("exits 2 for malformed JSON in the local file", async () => {
    const brokenPath = writeFixture("broken.json", "{not json");
    const result = await runValidate(["manifest", brokenPath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid JSON");
  });

  it("exits 2 when the AADP version cannot be determined", async () => {
    const noVersionPath = writeFixture("no-version.json", JSON.stringify({ foo: "bar" }));
    const result = await runValidate(["manifest", noVersionPath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Could not determine AADP version");
  });

  it("exits 3 for a version this validator does not support", async () => {
    const futurePath = writeFixture("future.json", JSON.stringify({ aadp_version: "9.9" }));
    const result = await runValidate(["manifest", futurePath]);
    expect(result.status).toBe(3);
  });
});

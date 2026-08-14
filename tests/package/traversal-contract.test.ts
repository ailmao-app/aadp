import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  packAndExtractTarball,
  cleanupTarball,
  BUILD_TIMEOUT_MS,
  PACKED_IMPORT_TIMEOUT_MS,
  type PackedTarball,
} from "./tarball-helpers.js";

/**
 * The `ail-aadp/traversal/v1.0` compatibility gate (ADR-0011 §11), exercised at
 * the boundary a real consumer installs against: the packed tarball's own
 * published subpath, never `src/`.
 *
 * Two halves, both only meaningful from a FRESH process:
 *
 * 1. Importing the traversal subpath registers nothing. Adapter registration is
 *    a global side effect, so "a consumer who never called
 *    `registerBuiltinTraversalAdapters()` has no adapters" cannot be observed
 *    from a module graph another test may already have contaminated.
 * 2. A core-only consumer is untouched: nothing about traversal loads, and the
 *    conformance profile a consumer runs in their own CI passes from the
 *    installed package with no network.
 */

let tarball: PackedTarball;

vi.setConfig({ testTimeout: PACKED_IMPORT_TIMEOUT_MS });

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

/** Runs `source` as an ESM script inside the extracted package, in a fresh Node process. */
function runInPackage(source: string): any {
  const scriptPath = path.join(tarball.packageDir, `traversal-probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(scriptPath, source, "utf8");
  const stdout = execFileSync(process.execPath, [scriptPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(stdout);
}

const TRAVERSAL_ENTRY = () => pathToFileURL(path.join(tarball.packageDir, "dist", "traversal", "v1.0", "index.js")).href;

describe("published traversal subpath", () => {
  it("registers no adapter merely by being imported", () => {
    const result = runInPackage(`
      const traversal = await import(${JSON.stringify(TRAVERSAL_ENTRY())});
      const before = traversal.listTraversalAdapters().length;
      traversal.registerBuiltinTraversalAdapters();
      const after = traversal.listTraversalAdapters().length;
      traversal.registerBuiltinTraversalAdapters();
      const afterTwice = traversal.listTraversalAdapters().length;
      console.log(JSON.stringify({ before, after, afterTwice }));
    `);
    expect(result).toEqual({ before: 0, after: 3, afterTwice: 3 });
  });

  it("runs the conformance profile from the installed package with no network", () => {
    const result = runInPackage(`
      const { runGraphTraversalConformance } = await import(${JSON.stringify(TRAVERSAL_ENTRY())});
      const report = await runGraphTraversalConformance();
      console.log(JSON.stringify({
        status: report.status,
        profile: report.profile,
        total: report.summary.total,
        failed: report.summary.failed,
        packageVersion: typeof report.package_version,
      }));
    `);
    expect(result).toEqual({
      status: "passed",
      profile: { id: "aadp:graph-traversal", version: "1.0" },
      total: 25,
      failed: 0,
      packageVersion: "string",
    });
  });

  it("collects a graph from an in-memory root using only the public subpath", () => {
    const result = runInPackage(`
      const traversal = await import(${JSON.stringify(TRAVERSAL_ENTRY())});
      const relations = await import(${JSON.stringify(
        pathToFileURL(path.join(tarball.packageDir, "dist", "modules", "relations", "v1.0", "index.js")).href
      )});
      const canonical = await import(${JSON.stringify(
        pathToFileURL(path.join(tarball.packageDir, "dist", "canonical-json", "index.js")).href
      )});

      traversal.registerBuiltinTraversalAdapters();
      const entity = {
        aadp_version: "1.0",
        id: "document:root",
        type: "document",
        checksum: canonical.checksumOf({}),
        updated_at: "2026-08-06T00:00:00Z",
        canonical_url: "https://example.com/entities/document/root.json",
        data: {},
      };
      const graph = await traversal.collectGraphV1(entity, { budget: relations.createRelationsTraversalBudget() });
      console.log(JSON.stringify({
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        stopReason: graph.summary.stopReason,
        partial: graph.summary.partial,
      }));
    `);
    expect(result).toEqual({ nodes: 1, edges: 0, stopReason: "exhausted", partial: false });
  });

  it("leaves a core-only consumer's validation unchanged by the presence of x_relations", () => {
    // The compatibility half of ADR-0011 §11: a consumer that never imports the
    // traversal subpath sees an entity carrying a module extension exactly as it
    // saw one before this release — no traversal code participates.
    const result = runInPackage(`
      const validator = await import(${JSON.stringify(
        pathToFileURL(path.join(tarball.packageDir, "dist", "validator", "index.js")).href
      )});
      const base = {
        aadp_version: "1.0",
        id: "document:root",
        type: "document",
        checksum: "sha256:" + "0".repeat(64),
        updated_at: "2026-08-06T00:00:00Z",
        canonical_url: "https://example.com/entities/document/root.json",
        data: {},
      };
      const withExtension = {
        ...base,
        x_relations: { module: "aadp:relations", version: "1.0", kind: "relation-set", items: [] },
      };
      const plain = validator.validateDocument({ version: "1.0", kind: "entity", data: base });
      const extended = validator.validateDocument({ version: "1.0", kind: "entity", data: withExtension });
      console.log(JSON.stringify({ same: JSON.stringify(plain) === JSON.stringify(extended), valid: extended.valid }));
    `);
    expect(result).toEqual({ same: true, valid: true });
  });
});

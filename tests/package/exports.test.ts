import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Locks the public export surface (AADP-COMPAT-001 §4.1): every subpath in
 * `package.json` `exports` must resolve from the packed tarball, and every
 * name a consumer is documented to import must actually be there. Imports
 * happen against `tarball.packageDir`'s own `dist/`, never `src/`, so a
 * subpath that only works because vitest resolves the repo's TS source
 * would fail here the way it would for a real npm install.
 */

let tarball: PackedTarball;

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

function importFromTarball(subpath: string): Promise<Record<string, unknown>> {
  const distFile = path.join(tarball.packageDir, "dist", subpath, "index.js");
  return import(pathToFileURL(distFile).href);
}

describe("published package: every public entry point resolves from the tarball", () => {
  const namedExports: Record<string, string[]> = {
    ".": [
      "discover",
      "fetchSitemapIndex",
      "fetchSitemap",
      "iterateSitemap",
      "fetchEntity",
      "discoverAllEntities",
      "validateDocument",
      "UnsupportedAadpVersionError",
      "canonicalize",
      "checksumOf",
      "runConformance",
      "renderTextReport",
      "renderJsonReport",
      "renderJUnitReport",
      "exitCodeFor",
      "CHECKS",
      "defineAADP",
      "defineResource",
    ],
    "client": ["discover", "fetchSitemapIndex", "fetchSitemap", "iterateSitemap", "fetchEntity", "discoverAllEntities", "v1"],
    "client/v0.1": ["discover", "fetchSitemapIndex", "fetchSitemap", "iterateSitemap", "fetchEntity", "discoverAllEntities"],
    "client/v1.0": ["discover", "fetchSitemapIndex", "fetchSitemap", "iterateSitemap", "fetchEntity", "discoverAllEntities", "AadpSemanticValidationError"],
    "validator": ["validateDocument", "validate", "validateManifest", "UnsupportedAadpVersionError", "SUPPORTED_VERSIONS", "KINDS", "checkManifestSemantics", "hasSemanticErrors"],
    "conformance": ["runConformance", "renderTextReport", "renderJsonReport", "renderJUnitReport", "exitCodeFor", "CHECKS", "collectAdvertisedUrls", "InvalidConformanceOptionsError", "UnsupportedConformanceVersionError", "SUPPORTED_CONFORMANCE_VERSIONS"],
    "server": ["defineAADP", "defineResource", "AadpServerError", "notFound", "invalidRequest", "unsupportedType", "upstreamUnavailable", "rateLimited", "unauthorized", "forbidden"],
    "scaffold": ["scaffoldInit", "scaffoldAddResource", "ScaffoldFileExistsError", "initTemplate", "resourceTemplate", "toCamelCase"],
    "canonical-json": ["canonicalize", "checksumOf"],
  };

  it.each(Object.entries(namedExports))('entry point "%s" exports every documented name', async (subpath, names) => {
    const mod = await importFromTarball(subpath);
    for (const name of names) {
      expect(mod, `"${name}" missing from ail-aadp/${subpath === "." ? "" : subpath}`).toHaveProperty(name);
    }
  });

  it("does not re-export scaffold from the root entry point", async () => {
    const mod = await importFromTarball(".");
    expect(mod).not.toHaveProperty("scaffoldInit");
  });

  it("ships every schema path exports declares", () => {
    for (const version of ["v0.1", "v1.0"]) {
      for (const kind of ["manifest", "sitemap-index", "sitemap", "entity", "error"]) {
        const schemaFile = path.join(tarball.packageDir, "schemas", version, `${kind}.schema.json`);
        expect(existsSync(schemaFile), schemaFile).toBe(true);
      }
    }
  });

  it("resolves package.json itself as a subpath export", () => {
    expect(existsSync(path.join(tarball.packageDir, "package.json"))).toBe(true);
  });

  it("ships all three documented binaries", () => {
    for (const relBin of ["dist/validator/cli.js", "dist/conformance/cli.js", "dist/scaffold/cli.js"]) {
      expect(existsSync(path.join(tarball.packageDir, relBin)), relBin).toBe(true);
    }
  });
});

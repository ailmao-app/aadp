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
    "validator": ["validateDocument", "validate", "validateManifest", "UnsupportedAadpVersionError", "SUPPORTED_VERSIONS", "KINDS", "checkManifestSemantics", "hasSemanticErrors", "isExtensionKey", "EXTENSION_KEY_GRAMMAR"],
    "module-registry": [
      "registerModule",
      "getModuleEntry",
      "validateModuleDocument",
      "assertValidModuleDocument",
      "isModuleRegistered",
      "isValidModuleId",
      "MODULE_ID_PATTERN",
      "hasModuleSemanticErrors",
      "UnsupportedModuleError",
      "UnsupportedModuleVersionError",
      "UnsupportedModuleKindError",
      "InvalidModuleDocumentError",
    ],
    "modules/relations/v1.0": [
      "validateRelationsDocument",
      "registerRelationsModule",
      "checkRelationSetSemantics",
      "checkRelationCollectionSemantics",
      "checkRelationRegistrySemantics",
      "isValidRelationToken",
      "STANDARD_RELATION_TOKENS",
      "relationSetSchema",
      "relationCollectionSchema",
      "relationRegistrySchema",
      "relationItemSchema",
      "targetSchema",
      "collectionLinkSchema",
      "moduleDispatchSchema",
      "relationsSchemasByKind",
      "RELATIONS_DOCUMENT_KINDS",
      // Client/traversal (AADP-REL-005)
      "createRelationsTraversalBudget",
      "resolveRelationTarget",
      "resolveRelationItem",
      "iterateRelationCollection",
      "traverseRelations",
      "fetchAndValidateRelationsDocument",
      "RelationsSchemaValidationError",
      "RelationsIntegrityMismatchError",
      "RelationsCursorCycleError",
      // Conformance (AADP-REL-006)
      "runRelationsConformance",
      "renderRelationsTextReport",
      "renderRelationsJsonReport",
      "renderRelationsJUnitReport",
      "relationsExitCodeFor",
      "RELATIONS_CHECKS",
      "RELATIONS_CONFORMANCE_PROFILES",
      "InvalidRelationsConformanceOptionsError",
    ],
    "modules/answer/v1.0": [
      "registerAnswerModule",
      "validateAnswerV1",
      "validateAnswerEntityV1",
      "parseAnswerEntityV1",
      "AnswerEntityValidationError",
      "checkAnswerSemantics",
      "isValidAnswerLocale",
      "checkUrlPolicy",
      "ANSWER_LOCALE_PATTERN",
      "answerSchema",
      "authorshipSchema",
      "freshnessSchema",
      "applicabilitySchema",
      "answerReferenceSchema",
      "moduleDispatchSchema",
      "answerSchemasByKind",
      "ANSWER_DOCUMENT_KINDS",
      // Client (fetch / freshness / target resolution)
      "fetchAnswerEntityV1",
      "classifyAnswerFreshness",
      "resolveAnswerTargets",
      "AnswerEntityFetchValidationError",
      // Conformance
      "runAnswerConformance",
      "renderAnswerTextReport",
      "renderAnswerJsonReport",
      "renderAnswerJUnitReport",
      "answerExitCodeFor",
      "ANSWER_CHECKS",
      "InvalidAnswerConformanceOptionsError",
    ],
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

  it("does not re-export Relations-specific names from the root entry point (ADR-0007 'Package exports')", async () => {
    const mod = await importFromTarball(".");
    for (const name of [
      "validateRelationsDocument",
      "registerRelationsModule",
      "checkRelationSetSemantics",
      "relationSetSchema",
      "traverseRelations",
      "runRelationsConformance",
    ]) {
      expect(mod, `"${name}" must not be re-exported from the package root`).not.toHaveProperty(name);
    }
    // The generic registry engine itself IS a root export (it is
    // infrastructure, not a concrete module's API) — see src/index.ts.
    expect(mod).toHaveProperty("registerModule");
  });

  it("does not re-export Answer-specific names from the root entry point (ADR-0007 'Package exports')", async () => {
    const mod = await importFromTarball(".");
    for (const name of ["validateAnswerV1", "validateAnswerEntityV1", "registerAnswerModule", "answerSchema", "runAnswerConformance"]) {
      expect(mod, `"${name}" must not be re-exported from the package root`).not.toHaveProperty(name);
    }
  });

  it("ships every schema path exports declares", () => {
    for (const version of ["v0.1", "v1.0"]) {
      for (const kind of ["manifest", "sitemap-index", "sitemap", "entity", "error"]) {
        const schemaFile = path.join(tarball.packageDir, "schemas", version, `${kind}.schema.json`);
        expect(existsSync(schemaFile), schemaFile).toBe(true);
      }
    }
    for (const file of [
      "module.schema.json",
      "relation-set.schema.json",
      "relation-item.schema.json",
      "target.schema.json",
      "collection-link.schema.json",
      "relation-collection.schema.json",
      "relation-registry.schema.json",
    ]) {
      const schemaFile = path.join(tarball.packageDir, "schemas", "modules", "relations", "v1.0", file);
      expect(existsSync(schemaFile), schemaFile).toBe(true);
    }
    for (const file of [
      "module.schema.json",
      "answer.schema.json",
      "answer-reference.schema.json",
      "authorship.schema.json",
      "freshness.schema.json",
      "applicability.schema.json",
    ]) {
      const schemaFile = path.join(tarball.packageDir, "schemas", "modules", "answer", "v1.0", file);
      expect(existsSync(schemaFile), schemaFile).toBe(true);
    }
  });

  it("resolves ail-aadp/modules/relations/v1.0 from a clean tarball install and validates all three document kinds", async () => {
    const mod = await importFromTarball("modules/relations/v1.0");
    const relationSet = { module: "aadp:relations", version: "1.0", kind: "relation-set", items: [] };
    const relationCollection = {
      aadp_version: "1.0",
      module: "aadp:relations",
      module_version: "1.0",
      kind: "relation-collection",
      source: { id: "character:alice", type: "character" },
      rel: "posts",
      target_type: "post",
      generated_at: "2026-08-05T00:00:00Z",
      checksum: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      items: [],
      cursor: { next: null },
    };
    const relationRegistry = {
      aadp_version: "1.0",
      module: "aadp:relations",
      module_version: "1.0",
      kind: "relation-registry",
      generated_at: "2026-08-05T00:00:00Z",
      checksum: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      relations: [],
    };
    const validateRelationsDocument = mod.validateRelationsDocument as (
      kind: string,
      data: unknown
    ) => { valid: boolean };
    expect(validateRelationsDocument("relation-set", relationSet).valid).toBe(true);
    expect(validateRelationsDocument("relation-collection", relationCollection).valid).toBe(true);
    expect(validateRelationsDocument("relation-registry", relationRegistry).valid).toBe(true);
  });

  it("runs runRelationsConformance from a clean tarball install (AADP-REL-006 neutral implementation gate)", async () => {
    const mod = await importFromTarball("modules/relations/v1.0");
    const runRelationsConformance = mod.runRelationsConformance as (options: unknown) => Promise<{
      module: unknown;
      status: string;
      checks: unknown[];
    }>;
    // No baseUrl/sample URLs supplied, and profile: relations-full so the
    // packaged runner schedules its full check set (default profile is
    // the narrower relations-core): every check must reach a verdict of
    // its own (skipped/inconclusive), not throw — proving the packaged
    // runner is self-contained and distinguishes skipped/inconclusive from
    // passed, per the conformance.md "Neutral implementation gate".
    const report = await runRelationsConformance({ profile: "relations-full" });
    expect(report.module).toEqual({ id: "aadp:relations", version: "1.0" });
    expect(report.status).toBe("inconclusive");
    expect(report.checks.length).toBeGreaterThan(15);
  });

  it("resolves ail-aadp/modules/answer/v1.0 from a clean tarball install and validates a well-formed wrapper", async () => {
    const mod = await importFromTarball("modules/answer/v1.0");
    const checksumOf = (await importFromTarball("canonical-json")).checksumOf as (v: unknown) => string;
    const base = {
      module: "aadp:answer",
      version: "1.0",
      kind: "answer",
      question: "What is Orbit?",
      concise_answer: "Orbit is a neutral example service.",
      locale: "en",
      authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
      freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    };
    const xAnswer = { ...base, content_checksum: checksumOf(base) };
    const validateAnswerV1 = mod.validateAnswerV1 as (data: unknown) => { valid: boolean };
    expect(validateAnswerV1(xAnswer).valid).toBe(true);
    expect(validateAnswerV1({ ...xAnswer, question: undefined }).valid).toBe(false);
  });

  it("runs runAnswerConformance from a clean tarball install (neutral implementation gate)", async () => {
    const mod = await importFromTarball("modules/answer/v1.0");
    const runAnswerConformance = mod.runAnswerConformance as (options: unknown) => Promise<{
      module: unknown;
      status: string;
      checks: unknown[];
    }>;
    // No baseUrl/sampleEntityUrl supplied: every check must reach a verdict
    // of its own (skipped/inconclusive), not throw — proving the packaged
    // runner is self-contained.
    const report = await runAnswerConformance({});
    expect(report.module).toEqual({ id: "aadp:answer", version: "1.0" });
    expect(report.status).toBe("inconclusive");
    expect(report.checks.length).toBeGreaterThan(5);
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

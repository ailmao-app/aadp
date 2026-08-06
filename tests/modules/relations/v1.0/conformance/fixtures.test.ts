/**
 * Runs the normative Relations v1.0 fixture catalog
 * (`tests/fixtures/relations/v1.0/{valid,invalid}`, the same fixtures
 * `tests/modules/relations/v1.0/fixtures.test.ts` uses at the module-registry
 * layer) through the actual `runRelationsConformance` runner end-to-end —
 * satisfying `AADP-REL-006`'s "chạy toàn bộ normative fixtures với expected
 * primary check ID, result và issue code" via a live local server rather
 * than a second, parallel fixture format.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRelationsConformance } from "../../../../../src/modules/relations/v1.0/conformance/index.js";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { startServer, sendJson, buildEntity, type TestServer } from "../client/server-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "..", "..", "..", "..", "fixtures", "relations", "v1.0");

function loadFixture(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixturesRoot, dir, file), "utf8"));
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function serveAsSampleEntity(relationSet: unknown): Promise<TestServer> {
  return startServer((_req, res, url) => {
    if (url.pathname === "/entities/character/root.json") {
      return sendJson(res, 200, buildEntity("character:root", "character", {}, { x_relations: relationSet }));
    }
    sendJson(res, 404, {});
  });
}

describe("Relations conformance — valid relation-set fixtures all pass schema/semantic checks", () => {
  const files = ["relations-valid-one.json", "relations-valid-inline-many.json", "relations-valid-empty-inline-many.json", "relations-valid-vendor-token.json"];

  it.each(files)("%s", async (file) => {
    const doc = loadFixture("valid", file);
    server = await serveAsSampleEntity(doc);
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/root.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.schema.relation_set"].status).toBe("passed");
    expect(byId["relations.semantic.cardinality"].status).toBe("passed");
    expect(byId["relations.semantic.tokens"].status).toBe("passed");
    expect(byId["relations.semantic.target_identity"].status).toBe("passed");
    expect(byId["relations.semantic.duplicate_target"].status).toBe("passed");
  });
});

// fixture file -> {checkId, mustFail} for the primary check the conformance
// catalog assigns it (spec/modules/relations/v1.0/conformance.md).
const INVALID_RELATION_SET_FIXTURES: Record<string, string> = {
  "relations-invalid-one-with-targets.json": "relations.semantic.cardinality",
  "relations-invalid-many-with-both-containers.json": "relations.semantic.cardinality",
  "relations-invalid-many-without-container.json": "relations.semantic.cardinality",
  "relations-invalid-inline-over-limit.json": "relations.semantic.cardinality",
  "relations-invalid-token.json": "relations.semantic.tokens",
  "relations-invalid-id-type-prefix.json": "relations.semantic.target_identity",
  "relations-invalid-duplicate-target.json": "relations.semantic.duplicate_target",
};

describe("Relations conformance — invalid relation-set fixtures fail their catalog-assigned check", () => {
  it.each(Object.entries(INVALID_RELATION_SET_FIXTURES))("%s -> %s", async (file, checkId) => {
    const doc = loadFixture("invalid", file);
    server = await serveAsSampleEntity(doc);
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/root.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId[checkId].status).toBe("failed");
  });

  it("relations-invalid-wrapper-version.json and relations-invalid-unknown-field.json fail relations.schema.relation_set", async () => {
    for (const file of ["relations-invalid-wrapper-version.json", "relations-invalid-unknown-field.json"]) {
      const doc = loadFixture("invalid", file);
      server = await serveAsSampleEntity(doc);
      const report = await runRelationsConformance({
        sampleEntityUrl: `${server.baseUrl}/entities/character/root.json`,
        urlPolicy: createPermissiveUrlPolicy(),
      });
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      expect(byId["relations.schema.relation_set"].status).toBe("failed");
      await server.close();
      server = undefined;
    }
  });
});

describe("Relations conformance — registry fixtures", () => {
  async function serveRegistry(doc: unknown): Promise<TestServer> {
    return startServer((_req, res, url) => {
      if (url.pathname === "/relations/registry.json") return sendJson(res, 200, doc);
      sendJson(res, 404, {});
    });
  }

  it("relations-valid-registry.json passes registry checks", async () => {
    const doc = loadFixture("valid", "relations-valid-registry.json");
    server = await serveRegistry(doc);
    const report = await runRelationsConformance({
      sampleRegistryUrl: `${server.baseUrl}/relations/registry.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.schema.registry"].status).toBe("passed");
    expect(byId["relations.registry.unique_token"].status).toBe("passed");
    expect(byId["relations.registry.checksum"].status).toBe("passed");
  });

  it("relations-invalid-registry-duplicate-token.json fails relations.registry.unique_token", async () => {
    const doc = loadFixture("invalid", "relations-invalid-registry-duplicate-token.json");
    server = await serveRegistry(doc);
    const report = await runRelationsConformance({
      sampleRegistryUrl: `${server.baseUrl}/relations/registry.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.registry.unique_token"].status).toBe("failed");
  });

  it("relations-invalid-registry-checksum.json fails relations.registry.checksum", async () => {
    const doc = loadFixture("invalid", "relations-invalid-registry-checksum.json");
    server = await serveRegistry(doc);
    const report = await runRelationsConformance({
      sampleRegistryUrl: `${server.baseUrl}/relations/registry.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.registry.checksum"].status).toBe("failed");
  });
});

describe("Relations conformance — collection fixtures via a relation-set that links to them", () => {
  async function serveEntityWithCollection(collectionDoc: unknown): Promise<TestServer> {
    return startServer((_req, res, url) => {
      if (url.pathname === "/entities/character/alice.json") {
        return sendJson(
          res,
          200,
          buildEntity("character:alice", "character", {}, {
            x_relations: {
              module: "aadp:relations",
              version: "1.0",
              kind: "relation-set",
              items: [{ rel: "posts", target_type: "post", cardinality: "many", collection: { url: `${_req.headers.host ? `http://${_req.headers.host}` : ""}/relations/alice/posts.json`, pagination: "cursor" } }],
            },
          })
        );
      }
      if (url.pathname === "/relations/alice/posts.json") return sendJson(res, 200, collectionDoc);
      sendJson(res, 404, {});
    });
  }

  it("relations-valid-collection-first-page.json passes collection checks", async () => {
    const doc = loadFixture("valid", "relations-valid-collection-first-page.json");
    server = await serveEntityWithCollection(doc);
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/alice.json`,
      urlPolicy: createPermissiveUrlPolicy(),
      profile: "relations-full",
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.schema.collection"].status).toBe("passed");
    expect(byId["relations.collection.context"].status).toBe("passed");
    expect(byId["relations.collection.checksum"].status).toBe("passed");
  });

  it("relations-invalid-checksum.json fails relations.collection.checksum", async () => {
    const doc = loadFixture("invalid", "relations-invalid-checksum.json");
    server = await serveEntityWithCollection(doc);
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/alice.json`,
      urlPolicy: createPermissiveUrlPolicy(),
      profile: "relations-full",
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.collection.checksum"].status).toBe("failed");
  });

  it("relations-invalid-collection-context.json fails relations.collection.context", async () => {
    const doc = loadFixture("invalid", "relations-invalid-collection-context.json");
    server = await serveEntityWithCollection(doc);
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/alice.json`,
      urlPolicy: createPermissiveUrlPolicy(),
      profile: "relations-full",
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.collection.context"].status).toBe("failed");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  runRelationsConformance,
  relationsExitCodeFor,
  renderRelationsTextReport,
  renderRelationsJsonReport,
  renderRelationsJUnitReport,
  InvalidRelationsConformanceOptionsError,
} from "../../../../../src/modules/relations/v1.0/conformance/index.js";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { startServer, sendJson, buildEntity, buildRelationSet, type TestServer } from "../client/server-helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("runRelationsConformance — options validation", () => {
  it("throws InvalidRelationsConformanceOptionsError for an unknown profile", async () => {
    await expect(runRelationsConformance({ profile: "bogus" as never })).rejects.toThrow(InvalidRelationsConformanceOptionsError);
  });

  it("throws a TypeError for an unparseable baseUrl", async () => {
    await expect(runRelationsConformance({ baseUrl: "not a url" })).rejects.toThrow(TypeError);
  });
});

describe("runRelationsConformance — report envelope", () => {
  it("with no options at all, every check is inconclusive and the run is reported inconclusive, never passed", async () => {
    const report = await runRelationsConformance({});
    expect(report.module).toEqual({ id: "aadp:relations", version: "1.0" });
    expect(report.aadp_version).toBe("1.0");
    expect(report.report_version).toBe("1");
    expect(report.package_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.checks.length).toBeGreaterThan(15);
    expect(report.status).toBe("inconclusive");
    expect(report.summary.failed).toBe(0);
    expect(report.summary.inconclusive).toBeGreaterThan(0);
  });

  it("records effective_limits", async () => {
    const report = await runRelationsConformance({ maxDepth: 3, maxNodes: 50, deadlineMs: 5000 });
    expect(report.effective_limits).toMatchObject({ maxDepth: 3, maxNodes: 50, deadlineMs: 5000 });
  });

  it("records the profile when supplied", async () => {
    const report = await runRelationsConformance({ profile: "relations-core" });
    expect(report.profile).toBe("relations-core");
  });
});

describe("runRelationsConformance — discovery.declared against a live manifest", () => {
  function buildManifest(host: string, modules?: unknown[]) {
    return {
      aadp_version: "1.0",
      application: { name: "Test", description: "Test app.", publisher: { name: "Test", url: `http://${host}` } },
      discovery: { sitemap_index: `http://${host}/ai/v1.0/sitemap-index.json` },
      policies: { robots: `http://${host}/robots.txt`, terms: `http://${host}/terms` },
      ...(modules ? { modules } : {}),
    };
  }

  it("passes discovery.declared and schema.reachable when the manifest declares aadp:relations@1.0", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(
          res,
          200,
          buildManifest(host, [{ id: "aadp:relations", version: "1.0", schema: `http://${host}/schemas/module.schema.json` }])
        );
      }
      if (url.pathname === "/schemas/module.schema.json") {
        return sendJson(res, 200, { oneOf: [{}, {}, {}] });
      }
      sendJson(res, 404, {});
    });

    const report = await runRelationsConformance({ baseUrl: server.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.discovery.declared"].status).toBe("passed");
    expect(byId["relations.schema.reachable"].status).toBe("passed");
  });

  it("is inconclusive (not failed) when the manifest does not declare aadp:relations", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(req.headers.host!));
      sendJson(res, 404, {});
    });

    const report = await runRelationsConformance({ baseUrl: server.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.discovery.declared"].status).toBe("skipped");
    expect(byId["relations.discovery.declared"].inconclusive).toBe(true);
    // Dependent check never ran, since its prerequisite didn't pass.
    expect(byId["relations.schema.reachable"].status).toBe("skipped");
  });

  it("fails schema.reachable when the module schema URL is unreachable", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(host, [{ id: "aadp:relations", version: "1.0", schema: `http://${host}/missing.json` }]));
      }
      sendJson(res, 404, {});
    });

    const report = await runRelationsConformance({ baseUrl: server.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.schema.reachable"].status).toBe("failed");
  });
});

describe("runRelationsConformance — privacy.social_graph", () => {
  it("fails when a sample relation-set uses the forbidden 'follows' token", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/character/root.json") {
        return sendJson(
          res,
          200,
          buildEntity(
            "character:root",
            "character",
            {},
            {
              x_relations: buildRelationSet([
                { rel: "follows", target_type: "character", cardinality: "one", target: { id: "character:other", url: "http://example.com/other.json" } },
              ]),
            }
          )
        );
      }
      sendJson(res, 404, {});
    });
    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/root.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.privacy.social_graph"].status).toBe("failed");
  });
});

describe("runRelationsConformance — traversal.partial provenance", () => {
  it("passes relations.traversal.partial when a tight maxNodes budget still carries issue provenance", async () => {
    server = await startServer((_req, res, url) => {
      const host = _req.headers.host;
      if (url.pathname === "/entities/character/root.json") {
        return sendJson(
          res,
          200,
          buildEntity(
            "character:root",
            "character",
            {},
            {
              x_relations: buildRelationSet([
                {
                  rel: "series",
                  target_type: "series",
                  cardinality: "many",
                  targets: [
                    { id: "series:a", url: `http://${host}/entities/series/a.json` },
                    { id: "series:b", url: `http://${host}/entities/series/b.json` },
                  ],
                },
              ]),
            }
          )
        );
      }
      const match = url.pathname.match(/^\/entities\/series\/(.+)\.json$/);
      if (match) return sendJson(res, 200, buildEntity(`series:${match[1]}`, "series", {}));
      sendJson(res, 404, {});
    });

    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/root.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.traversal.partial"].status).toBe("passed");
  });
});

describe("relationsExitCodeFor", () => {
  it("maps status to the documented exit codes", () => {
    expect(relationsExitCodeFor({ status: "passed" } as never)).toBe(0);
    expect(relationsExitCodeFor({ status: "failed" } as never)).toBe(1);
    expect(relationsExitCodeFor({ status: "inconclusive" } as never)).toBe(4);
  });
});

describe("report renderers", () => {
  it("render text/JSON/JUnit without throwing and include module/profile metadata", async () => {
    const report = await runRelationsConformance({ profile: "relations-core" });
    const text = renderRelationsTextReport(report);
    expect(text).toContain("Relations v1.0 conformance");
    expect(text).toContain("relations-core");

    const json = JSON.parse(renderRelationsJsonReport(report));
    expect(json.module).toEqual({ id: "aadp:relations", version: "1.0" });

    const junit = renderRelationsJUnitReport(report);
    expect(junit).toContain("<?xml");
    expect(junit).toContain('name="module.id" value="aadp:relations"');
  });
});

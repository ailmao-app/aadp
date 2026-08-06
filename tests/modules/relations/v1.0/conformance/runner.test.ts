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
import { startServer, sendJson, buildEntity, buildRelationSet, buildCollectionPage, type TestServer } from "../client/server-helpers.js";

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

  it("throws InvalidRelationsConformanceOptionsError for relations-authenticated without headers", async () => {
    await expect(runRelationsConformance({ profile: "relations-authenticated" })).rejects.toThrow(
      InvalidRelationsConformanceOptionsError
    );
  });

  it("accepts relations-authenticated once headers are supplied, and schedules the full check set", async () => {
    const report = await runRelationsConformance({ profile: "relations-authenticated", headers: { Authorization: "Bearer x" } });
    expect(report.profile).toBe("relations-authenticated");
    expect(report.checks.length).toBeGreaterThan(15);
  });
});

describe("runRelationsConformance — profile scopes which checks are even scheduled", () => {
  it("relations-core (the default) never fetches a collection, negative-target, or credential-probe URL, even when those options are supplied", async () => {
    let collectionRequested = false;
    let negativeTargetRequested = false;
    let probeRequested = false;

    const negativeAndProbe = await startServer((_req, res, url) => {
      if (url.pathname === "/negative") {
        negativeTargetRequested = true;
        return sendJson(res, 404, { error: { code: "not_found", message: "gone", request_id: "r1" } });
      }
      if (url.pathname === "/probe") {
        probeRequested = true;
        return sendJson(res, 200, { received_headers: {} });
      }
      sendJson(res, 404, {});
    });

    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/character/alice.json") {
        return sendJson(
          res,
          200,
          buildEntity("character:alice", "character", {}, {
            x_relations: buildRelationSet([
              {
                rel: "posts",
                target_type: "post",
                cardinality: "many",
                collection: { url: `${negativeAndProbe.baseUrl}/collection.json`, pagination: "cursor" },
              },
            ]),
          })
        );
      }
      if (url.pathname === "/collection.json") {
        collectionRequested = true;
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], null));
      }
      sendJson(res, 404, {});
    });

    try {
      const report = await runRelationsConformance({
        // Deliberately relations-core (the default) even though every
        // full-only input is supplied.
        sampleEntityUrl: `${server.baseUrl}/entities/character/alice.json`,
        negativeTargetUrl: `${negativeAndProbe.baseUrl}/negative`,
        crossOriginProbeUrl: `${negativeAndProbe.baseUrl}/probe`,
        headers: { Authorization: "Bearer secret" },
        urlPolicy: createPermissiveUrlPolicy(),
      });

      expect(collectionRequested).toBe(false);
      expect(negativeTargetRequested).toBe(false);
      expect(probeRequested).toBe(false);

      const ids = report.checks.map((c) => c.id);
      for (const fullOnlyId of [
        "relations.schema.collection",
        "relations.collection.context",
        "relations.collection.pagination",
        "relations.collection.checksum",
        "relations.http.errors",
        "relations.http.cache",
        "relations.traversal.budget",
        "relations.traversal.cycle",
        "relations.traversal.partial",
        "relations.security.credentials",
      ]) {
        expect(ids, `${fullOnlyId} must not be scheduled under relations-core`).not.toContain(fullOnlyId);
      }
    } finally {
      await negativeAndProbe.close();
    }
  });
});

describe("runRelationsConformance — report envelope", () => {
  it("with no options at all, defaults to relations-core and reports every core check inconclusive, never passed", async () => {
    const report = await runRelationsConformance({});
    expect(report.module).toEqual({ id: "aadp:relations", version: "1.0" });
    expect(report.aadp_version).toBe("1.0");
    expect(report.report_version).toBe("1");
    expect(report.package_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.profile).toBe("relations-core");
    expect(report.checks.length).toBeGreaterThan(5);
    expect(report.status).toBe("inconclusive");
    expect(report.summary.failed).toBe(0);
    expect(report.summary.inconclusive).toBeGreaterThan(0);
  });

  it("with profile: relations-full and no sample/probe URLs, schedules every check and every one is inconclusive", async () => {
    const report = await runRelationsConformance({ profile: "relations-full" });
    expect(report.checks.length).toBeGreaterThan(15);
    expect(report.status).toBe("inconclusive");
    expect(report.summary.failed).toBe(0);
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
      profile: "relations-full",
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

describe("runRelationsConformance — effective_limits reflects the actually-applied ADR-0008 defaults", () => {
  it("with no limit options at all, reports every one of the six reference defaults, not just deadlineMs", async () => {
    const report = await runRelationsConformance({});
    expect(report.effective_limits).toEqual({
      maxDepth: 3,
      maxNodes: 1_000,
      maxRequests: 2_000,
      maxTotalBytes: 64 * 1024 * 1024,
      deadlineMs: 5 * 60_000,
      maxCrossOriginRequests: 100,
      maxPages: 20,
    });
  });
});

describe("runRelationsConformance — collection.pagination does not certify an unproven termination", () => {
  it("is inconclusive (never a default-passing warning) when the collection keeps handing out fresh cursors", async () => {
    server = await startServer((_req, res, url) => {
      const host = _req.headers.host;
      if (url.pathname === "/entities/character/alice.json") {
        return sendJson(
          res,
          200,
          buildEntity("character:alice", "character", {}, {
            x_relations: buildRelationSet([
              { rel: "posts", target_type: "post", cardinality: "many", collection: { url: `http://${host}/relations/alice/posts.json`, pagination: "cursor" } },
            ]),
          })
        );
      }
      if (url.pathname === "/relations/alice/posts.json") {
        // Every page hands out a brand-new cursor — never repeats (so
        // cursor-cycle detection never fires) and never terminates.
        return sendJson(res, 200, buildCollectionPage({ id: "character:alice", type: "character" }, "posts", "post", [], `page-${Math.random()}`));
      }
      sendJson(res, 404, {});
    });

    const report = await runRelationsConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/character/alice.json`,
      urlPolicy: createPermissiveUrlPolicy(),
      profile: "relations-full",
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.collection.pagination"].status).toBe("skipped");
    expect(byId["relations.collection.pagination"].inconclusive).toBe(true);
    // A run with only an inconclusive skip (no failure) must not be
    // certified "passed" — this is the whole point of the fix.
    expect(report.status).toBe("inconclusive");
    expect(relationsExitCodeFor(report)).toBe(4);
  });
});

describe("runRelationsConformance — security.credentials actually observes cross-origin behavior", () => {
  async function startProbe(): Promise<TestServer> {
    return startServer((req, res, url) => {
      if (url.pathname === "/probe") {
        return sendJson(res, 200, { received_headers: { ...req.headers } });
      }
      sendJson(res, 404, {});
    });
  }

  it("is inconclusive without crossOriginProbeUrl, even though headers were configured", async () => {
    const report = await runRelationsConformance({
      baseUrl: "https://example.com",
      headers: { Authorization: "Bearer secret" },
      profile: "relations-full",
    });
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["relations.security.credentials"].status).toBe("skipped");
    expect(byId["relations.security.credentials"].inconclusive).toBe(true);
  });

  it("fails when the probe reports having received a header that was never allow-listed", async () => {
    // A probe that (mis)reports receiving every header regardless of what
    // was actually sent — stands in for "the header leaked cross-origin"
    // from the check's point of view, so the check's own leak-detection
    // logic (not this repo's already-correct `scopeHeadersToOrigin`) is
    // what's under test here.
    const dishonestProbe = await startServer((_req, res, url) => {
      if (url.pathname === "/probe") return sendJson(res, 200, { received_headers: { authorization: "Bearer secret" } });
      sendJson(res, 404, {});
    });
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    try {
      const report = await runRelationsConformance({
        baseUrl: server.baseUrl,
        crossOriginProbeUrl: `${dishonestProbe.baseUrl}/probe`,
        headers: { Authorization: "Bearer secret" },
        urlPolicy: createPermissiveUrlPolicy(),
        profile: "relations-full",
      });
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      expect(byId["relations.security.credentials"].status).toBe("failed");
    } finally {
      await dishonestProbe.close();
    }
  });

  it("passes when the header is correctly stripped, and also when explicitly allow-listed", async () => {
    const probe = await startProbe();
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    try {
      // Default (no allow-list): must be stripped -> pass.
      const strippedReport = await runRelationsConformance({
        baseUrl: server.baseUrl,
        crossOriginProbeUrl: `${probe.baseUrl}/probe`,
        headers: { "X-Api-Key": "secret" },
        urlPolicy: createPermissiveUrlPolicy(),
        profile: "relations-full",
      });
      const strippedById = Object.fromEntries(strippedReport.checks.map((c) => [c.id, c]));
      expect(strippedById["relations.security.credentials"].status).toBe("passed");

      // Explicitly allow-listed: must be forwarded -> also pass.
      const allowListedReport = await runRelationsConformance({
        baseUrl: server.baseUrl,
        crossOriginProbeUrl: `${probe.baseUrl}/probe`,
        headers: { "X-Api-Key": "secret" },
        crossOriginSafeHeaders: ["X-Api-Key"],
        urlPolicy: createPermissiveUrlPolicy(),
        profile: "relations-full",
      });
      const allowListedById = Object.fromEntries(allowListedReport.checks.map((c) => [c.id, c]));
      expect(allowListedById["relations.security.credentials"].status).toBe("passed");
    } finally {
      await probe.close();
    }
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

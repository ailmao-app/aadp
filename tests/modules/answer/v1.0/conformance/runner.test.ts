import { afterEach, describe, expect, it } from "vitest";
import {
  runAnswerConformance,
  answerExitCodeFor,
  renderAnswerTextReport,
  renderAnswerJsonReport,
  renderAnswerJUnitReport,
} from "../../../../../src/modules/answer/v1.0/conformance/index.js";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { startServer, sendJson, buildAnswerEntity, type TestServer } from "../client/server-helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function buildManifest(host: string, modules?: unknown[]) {
  return {
    aadp_version: "1.0",
    application: { name: "Test", description: "Test app.", publisher: { name: "Test", url: `http://${host}` } },
    discovery: { sitemap_index: `http://${host}/ai/v1.0/sitemap-index.json` },
    policies: { robots: `http://${host}/robots.txt`, terms: `http://${host}/terms` },
    ...(modules ? { modules } : {}),
  };
}

describe("runAnswerConformance — a fully conforming deployment", () => {
  it("passes every check against a manifest + sample entity that satisfy the whole contract", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(
          res,
          200,
          buildManifest(host, [{ id: "aadp:answer", version: "1.0", schema: `http://${host}/schemas/module.schema.json` }])
        );
      }
      if (url.pathname === "/schemas/module.schema.json") {
        return sendJson(res, 200, { oneOf: [{}] });
      }
      if (url.pathname === "/entities/answer/what-is-orbit.json") {
        return sendJson(res, 200, buildAnswerEntity("answer:what-is-orbit"));
      }
      sendJson(res, 404, {});
    });

    const report = await runAnswerConformance({
      baseUrl: server.baseUrl,
      sampleEntityUrl: `${server.baseUrl}/entities/answer/what-is-orbit.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const failed = report.checks.filter((c) => c.status === "failed");
    expect(failed).toEqual([]);
    expect(report.status).not.toBe("failed");
    expect(answerExitCodeFor(report)).not.toBe(1);
    expect(report.module).toEqual({ id: "aadp:answer", version: "1.0" });

    // Report renderers don't throw and produce non-empty output.
    expect(renderAnswerTextReport(report).length).toBeGreaterThan(0);
    expect(JSON.parse(renderAnswerJsonReport(report)).module.id).toBe("aadp:answer");
    expect(renderAnswerJUnitReport(report)).toContain("<testsuite");
  });

  it("is inconclusive (not failed) when no baseUrl/sampleEntityUrl is supplied", async () => {
    const report = await runAnswerConformance({});
    expect(report.status).toBe("inconclusive");
    expect(report.checks.some((c) => c.inconclusive)).toBe(true);
  });
});

describe("runAnswerConformance — a nonconforming sample entity", () => {
  it("fails answer.context when the sample entity fails entity-context validation", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/answer/wrong-type.json") {
        return sendJson(res, 200, buildAnswerEntity("answer:wrong-type", {}, { type: "document" }));
      }
      sendJson(res, 404, {});
    });

    const report = await runAnswerConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/answer/wrong-type.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["answer.context"].status).toBe("failed");
    expect(report.status).toBe("failed");
    expect(answerExitCodeFor(report)).toBe(1);
  });
});

describe("runAnswerConformance — answer.references also exercises generated-summary source_targets", () => {
  it("warns on answer.references when a generated summary's source_targets fails to resolve, even with no related_entities", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/answer/generated.json") {
        return sendJson(
          res,
          200,
          buildAnswerEntity("answer:generated", {
            authorship: {
              kind: "generated-summary",
              generator: { name: "Example Summarizer" },
              generated_at: "2026-08-06T08:55:00Z",
              source_targets: [
                { target_type: "document", target: { id: "document:missing", url: `http://127.0.0.1:1/entities/document/missing.json` } },
              ],
            },
          })
        );
      }
      sendJson(res, 404, {});
    });

    const report = await runAnswerConformance({
      sampleEntityUrl: `${server.baseUrl}/entities/answer/generated.json`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["answer.references"].status).toBe("warning");
    expect(byId["answer.references"].details?.some((d) => d.includes("source_targets"))).toBe(true);
  });
});

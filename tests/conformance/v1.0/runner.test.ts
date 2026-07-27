import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServerHandle } from "./mock-server.js";
import {
  runConformance,
  exitCodeFor,
  renderTextReport,
  renderJsonReport,
  CHECKS,
  UnsupportedConformanceVersionError,
  type ConformanceOptions,
  type ConformanceReport,
} from "../../../src/conformance/index.js";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";

/**
 * Tests for the standalone runner (AADP-CONFORMANCE-001). These assert the
 * runner's *own* contract — statuses, prerequisite skipping, budgets, exit
 * codes, report shape — rather than re-asserting protocol conformance,
 * which `conformance.test.ts` already covers. The two must agree on the
 * mock server: it passes there, so it must pass here.
 */

let server: MockServerHandle;

// The mock server binds to loopback, which the default strict URL policy
// blocks; every run that is not specifically testing the policy opts in.
const permissive = (extra: Partial<ConformanceOptions> = {}): ConformanceOptions => ({
  baseUrl: server.baseUrl,
  urlPolicy: createPermissiveUrlPolicy(),
  ...extra,
});

/** Minimal one-route server, for origins the shared mock cannot express. */
async function startTinyServer(
  handler: (path: string) => { status: number; body: string; contentType?: string }
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const srv: Server = createServer((req, res) => {
    const { status, body, contentType } = handler(new URL(req.url ?? "/", "http://localhost").pathname);
    res.writeHead(status, { "Content-Type": contentType ?? "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const address = srv.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind tiny server");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve()))),
  };
}

function byId(report: ConformanceReport, id: string) {
  const result = report.checks.find((check) => check.id === id);
  if (!result) throw new Error(`No check "${id}" in report`);
  return result;
}

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

describe("runConformance against a conformant v1.0 server", () => {
  let report: ConformanceReport;

  beforeAll(async () => {
    report = await runConformance(permissive());
  });

  it("reports a passing run with no failed check", () => {
    const failed = report.checks.filter((check) => check.status === "failed");
    expect(failed.map((check) => `${check.id}: ${check.message}`)).toEqual([]);
    expect(report.status).toBe("passed");
    expect(report.fatal).toBeUndefined();
    expect(exitCodeFor(report)).toBe(0);
  });

  it("attempts every declared check exactly once, with a coherent summary", () => {
    expect(report.checks.map((check) => check.id)).toEqual(CHECKS.map((check) => check.id));
    expect(new Set(report.checks.map((check) => check.id)).size).toBe(CHECKS.length);
    const { summary } = report;
    expect(summary.total).toBe(report.checks.length);
    expect(summary.passed + summary.failed + summary.warnings + summary.skipped).toBe(summary.total);
  });

  it("exercises discovery, traversal, cache validators and the error envelope", () => {
    for (const id of [
      "manifest.http",
      "manifest.schema",
      "discovery.manifest_usable",
      "traversal.sitemap_index",
      "traversal.sitemap",
      "traversal.entity",
      "pagination.contract",
      "http.cache.sitemap_index",
      "http.cache.sitemap",
      "http.cache.entity",
      "links.no_dead_urls",
      "errors.not_found",
      "errors.unsupported_type",
    ]) {
      expect(byId(report, id).status, `${id}: ${byId(report, id).message}`).toBe("passed");
    }
  });

  it("flags instruction-shaped usage_guidance as a warning, never a failure", () => {
    const safety = byId(report, "safety.free_text_is_data");
    expect(safety.status).toBe("warning");
    expect(safety.message).toMatch(/must be treated as data/);
    // A warning does not block dependents, and does not fail the run.
    expect(byId(report, "manifest.semantic").status).toBe("warning");
    expect(report.status).toBe("passed");
  });

  it("carries a report envelope a CI job can pin", () => {
    expect(report.report_version).toBe("1");
    expect(report.aadp_version).toBe("1.0");
    expect(report.base_url).toBe(server.baseUrl);
    expect(report.runner.name).toBe("aadp-conformance");
    expect(Date.parse(report.started_at)).not.toBeNaN();
    expect(Date.parse(report.finished_at)).not.toBeNaN();
    expect(JSON.parse(renderJsonReport(report))).toEqual(report);
  });

  it("renders a text report naming every check and the verdict", () => {
    const text = renderTextReport(report);
    for (const check of CHECKS) expect(text).toContain(check.id);
    expect(text).toContain("RESULT: PASSED");
  });

  it("treats warnings as failures only when asked", async () => {
    const strict = await runConformance(permissive({ failOnWarning: true }));
    expect(strict.summary.warnings).toBeGreaterThan(0);
    expect(strict.summary.failed).toBe(0);
    expect(strict.status).toBe("failed");
    expect(exitCodeFor(strict)).toBe(1);
  });
});

describe("traversal budgets", () => {
  it("stops the pagination walk at maxPages and reports it as skipped, not passed", async () => {
    // The example sitemap paginates 5 items at 2 per page, so one page is
    // not enough to finish the walk.
    const report = await runConformance(permissive({ maxPages: 1 }));
    const pagination = byId(report, "pagination.contract");
    expect(pagination.status).toBe("skipped");
    expect(pagination.message).toMatch(/traversal budget/i);
    // A budget stop is this runner's limit, not the server's defect.
    expect(report.status).toBe("passed");
  });

  it("fails when the index declares more sitemaps than maxSitemaps allows", async () => {
    const report = await runConformance(permissive({ maxSitemaps: 1 }));
    expect(byId(report, "traversal.sitemap_index").status).toBe("failed");
    expect(byId(report, "traversal.sitemap_index").message).toMatch(/maxSitemaps/);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe("a check whose prerequisite did not pass is skipped, not re-failed", () => {
  it("skips every dependent check when the manifest is not JSON", async () => {
    const tiny = await startTinyServer(() => ({ status: 200, body: "<h1>hi</h1>", contentType: "text/html" }));
    try {
      const report = await runConformance({ baseUrl: tiny.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
      expect(byId(report, "manifest.http").status).toBe("failed");
      expect(report.summary.failed).toBe(1);
      expect(report.summary.skipped).toBe(CHECKS.length - 1);
      expect(byId(report, "traversal.entity").message).toMatch(/Prerequisite/);
      expect(report.fatal?.code).toBe("unreachable");
      expect(exitCodeFor(report)).toBe(2);
    } finally {
      await tiny.close();
    }
  });
});

describe("version handling", () => {
  it("rejects a protocol version this runner cannot exercise before making any request", async () => {
    await expect(runConformance(permissive({ version: "0.1" }))).rejects.toThrow(UnsupportedConformanceVersionError);
    await expect(runConformance(permissive({ version: "2.0" }))).rejects.toThrow(UnsupportedConformanceVersionError);
  });

  it("reports a deployment that speaks a different version as a fatal, with exit code 3", async () => {
    const tiny = await startTinyServer((path) =>
      path === "/.well-known/ai-manifest.json"
        ? { status: 200, body: JSON.stringify({ aadp_version: "0.1" }) }
        : { status: 404, body: JSON.stringify({ error: { code: "not_found", message: "x", request_id: "r" } }) }
    );
    try {
      const report = await runConformance({ baseUrl: tiny.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
      expect(byId(report, "manifest.http").status).toBe("passed");
      expect(byId(report, "manifest.version").status).toBe("failed");
      expect(report.fatal?.code).toBe("unsupported_version");
      expect(exitCodeFor(report)).toBe(3);
    } finally {
      await tiny.close();
    }
  });
});

describe("URL policy", () => {
  it("blocks a loopback deployment by default, so an SSRF-unsafe run cannot silently pass", async () => {
    const report = await runConformance({ baseUrl: server.baseUrl });
    expect(byId(report, "manifest.http").status).toBe("failed");
    expect(byId(report, "manifest.http").message).toMatch(/BlockedUrlError/);
    expect(report.status).toBe("failed");
  });

  it("reaches the same deployment once the caller opts in", async () => {
    const report = await runConformance({ baseUrl: server.baseUrl, allowPrivateNetwork: true });
    expect(byId(report, "manifest.http").status).toBe("passed");
  });
});

describe("invalid input", () => {
  it("throws rather than reporting a verdict for an unusable base URL", async () => {
    await expect(runConformance({ baseUrl: "not a url" })).rejects.toThrow(TypeError);
  });

  it("records an unreachable origin as a fatal, not as a passing run", async () => {
    const tiny = await startTinyServer(() => ({ status: 200, body: "{}" }));
    const deadUrl = tiny.baseUrl;
    await tiny.close();
    const report = await runConformance({ baseUrl: deadUrl, allowPrivateNetwork: true, timeoutMs: 2000 });
    expect(report.status).toBe("failed");
    expect(report.fatal?.code).toBe("unreachable");
    expect(exitCodeFor(report)).toBe(2);
  });
});

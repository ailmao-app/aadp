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
import { InvalidConformanceOptionsError } from "../../../src/conformance/index.js";
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

/**
 * URLs the mock server is known not to publish. The runner never derives
 * a negative target (AADP defines no routing template), so a run that
 * should exercise the error envelope has to name them.
 */
const withNegativeTargets = (extra: Partial<ConformanceOptions> = {}): ConformanceOptions =>
  permissive({
    negativeTargets: {
      unknownEntityUrl: `${server.baseUrl}/ai/v1.0/entities/example/aadp-conformance-does-not-exist.json`,
      unknownTypeUrl: `${server.baseUrl}/ai/v1.0/sitemaps/aadp-conformance-unknown-type.json`,
    },
    ...extra,
  });

interface ObservedRequest {
  path: string;
  auth?: string;
  trace?: string;
}

/**
 * Minimal one-route server, for origins the shared mock cannot express.
 * `observe` records the headers each request arrived with, which is how
 * the cross-origin header-scoping tests see what actually left the runner.
 */
async function startTinyServer(
  handler: (path: string) => { status: number; body: string; contentType?: string },
  observe?: (request: ObservedRequest) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const srv: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    observe?.({
      path,
      auth: req.headers.authorization,
      trace: typeof req.headers["x-trace"] === "string" ? req.headers["x-trace"] : undefined,
    });
    const { status, body, contentType } = handler(path);
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
    report = await runConformance(withNegativeTargets());
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
    const strict = await runConformance(withNegativeTargets({ failOnWarning: true }));
    expect(strict.summary.warnings).toBeGreaterThan(0);
    expect(strict.summary.failed).toBe(0);
    expect(strict.status).toBe("failed");
    expect(exitCodeFor(strict)).toBe(1);
  });
});

describe("traversal budgets", () => {
  it("stops the pagination walk at maxPages and refuses to certify the run", async () => {
    // The example sitemap paginates 5 items at 2 per page, so one page is
    // not enough to finish the walk.
    const report = await runConformance(permissive({ maxPages: 1 }));
    const pagination = byId(report, "pagination.contract");
    expect(pagination.status).toBe("skipped");
    expect(pagination.inconclusive).toBe(true);
    expect(pagination.message).toMatch(/traversal budget/i);
    // A budget stop is this runner's limit, not the server's defect — but
    // an unfinished walk must not exit 0 as if conformance were proven.
    expect(report.summary.failed).toBe(0);
    expect(report.status).toBe("inconclusive");
    expect(exitCodeFor(report)).toBe(4);
  });

  it("charges every sitemap page fetch to the shared budget, with no duplicate preflight", async () => {
    // 2 sitemaps: `example` (5 items / 2 per page = 3 pages) and `note`
    // (1 page) = 4 page fetches for the whole run, of which
    // traversal.sitemap already made the first. A budget of exactly 4
    // must therefore complete; 3 must not.
    const complete = await runConformance(withNegativeTargets({ maxPages: 4 }));
    expect(byId(complete, "pagination.contract").status).toBe("passed");
    expect(complete.status).toBe("passed");

    const short = await runConformance(permissive({ maxPages: 3 }));
    expect(byId(short, "pagination.contract").inconclusive).toBe(true);
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

describe("caller headers never leak to a cross-origin URL a document supplied", () => {
  it("sends configured headers to the target origin but not to a third-party host it points at", async () => {
    const seen: ObservedRequest[] = [];
    // Stands in for a host the manifest points at: it records whether the
    // caller's credential arrived, and 404s everything so the run fails
    // fast. What is asserted is the header, not the verdict.
    const thirdParty = await startTinyServer(() => ({ status: 404, body: "{}" }), (req) => seen.push(req));

    // The origin under test advertises a policy URL and a sitemap index on
    // the third-party host.
    const target = await startTinyServer(
      (path) =>
        path === "/.well-known/ai-manifest.json"
          ? {
              status: 200,
              body: JSON.stringify({
                aadp_version: "1.0",
                application: {
                  name: "Cross origin",
                  description: "Points its discovery and policy URLs at another host.",
                  publisher: { name: "P", url: thirdParty.baseUrl },
                },
                discovery: { sitemap_index: `${thirdParty.baseUrl}/ai/v1.0/sitemap-index.json` },
                policies: { robots: `${thirdParty.baseUrl}/robots.txt`, terms: `${thirdParty.baseUrl}/terms` },
              }),
            }
          : { status: 404, body: "{}" },
      (req) => seen.push(req)
    );

    try {
      await runConformance({
        baseUrl: target.baseUrl,
        urlPolicy: createPermissiveUrlPolicy(),
        headers: { Authorization: "Bearer super-secret" },
      });
    } finally {
      await target.close();
      await thirdParty.close();
    }

    const home = new URL(target.baseUrl).port;
    const homeRequests = seen.filter((r) => r.path.startsWith("/.well-known"));
    expect(homeRequests.length).toBeGreaterThan(0);
    expect(homeRequests.every((r) => r.auth === "Bearer super-secret")).toBe(true);
    expect(home).toBeTruthy();

    // The third-party host was contacted for the sitemap index and the
    // advertised policy URLs — and saw no credential on any of them.
    const foreign = seen.filter((r) => !r.path.startsWith("/.well-known"));
    expect(foreign.length).toBeGreaterThan(0);
    expect(foreign.map((r) => r.auth)).toEqual(foreign.map(() => undefined));
  });

  it("keeps a header the caller explicitly allow-listed as cross-origin-safe", async () => {
    const seen: ObservedRequest[] = [];
    const thirdParty = await startTinyServer(() => ({ status: 404, body: "{}" }), (req) => seen.push(req));
    const target = await startTinyServer(
      (path) =>
        path === "/.well-known/ai-manifest.json"
          ? {
              status: 200,
              body: JSON.stringify({
                aadp_version: "1.0",
                application: {
                  name: "Cross origin",
                  description: "Points its discovery and policy URLs at another host.",
                  publisher: { name: "P", url: thirdParty.baseUrl },
                },
                discovery: { sitemap_index: `${thirdParty.baseUrl}/ai/v1.0/sitemap-index.json` },
                policies: { robots: `${thirdParty.baseUrl}/robots.txt`, terms: `${thirdParty.baseUrl}/terms` },
              }),
            }
          : { status: 404, body: "{}" },
      (req) => seen.push(req)
    );

    try {
      await runConformance({
        baseUrl: target.baseUrl,
        urlPolicy: createPermissiveUrlPolicy(),
        headers: { Authorization: "Bearer super-secret", "X-Trace": "run-1" },
        crossOriginSafeHeaders: ["x-trace"],
      });
    } finally {
      await target.close();
      await thirdParty.close();
    }

    const foreign = seen.filter((r) => !r.path.startsWith("/.well-known"));
    expect(foreign.length).toBeGreaterThan(0);
    expect(foreign.every((r) => r.trace === "run-1")).toBe(true);
    expect(foreign.every((r) => r.auth === undefined)).toBe(true);
  });
});

describe("negative-path checks never invent a target", () => {
  it("is inconclusive, not passing and not failing, when no target is supplied", async () => {
    const report = await runConformance(permissive());
    for (const id of ["errors.not_found", "errors.unsupported_type"]) {
      const check = byId(report, id);
      expect(check.status).toBe("skipped");
      expect(check.inconclusive).toBe(true);
      expect(check.message).toMatch(/no routing template/);
    }
    // Nothing failed, but the error envelope was never exercised, so the
    // run must not certify the deployment.
    expect(report.summary.failed).toBe(0);
    expect(report.status).toBe("inconclusive");
    expect(exitCodeFor(report)).toBe(4);
  });

  it("exercises the envelope when the caller names targets", async () => {
    const report = await runConformance(withNegativeTargets());
    expect(byId(report, "errors.not_found").status).toBe("passed");
    expect(byId(report, "errors.unsupported_type").status).toBe("passed");
    expect(report.status).toBe("passed");
    expect(exitCodeFor(report)).toBe(0);
  });

  it("fails when a caller-named target resolves instead of 404ing", async () => {
    // The caller stated this URL is not published; the deployment serving
    // it is a contract violation, not an inconclusive result.
    const report = await runConformance(
      permissive({
        negativeTargets: { unknownEntityUrl: `${server.baseUrl}/ai/v1.0/entities/example/item-1.json` },
      })
    );
    const check = byId(report, "errors.not_found");
    expect(check.status).toBe("failed");
    expect(check.message).toMatch(/returned a successful response/);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe("conditional GET is checked in both validator forms", () => {
  it("fails a server that only honours the exact weak ETag it emitted", async () => {
    const weak = await startMockServer({ cacheValidator: "weak-exact" });
    try {
      const report = await runConformance({ baseUrl: weak.baseUrl, urlPolicy: createPermissiveUrlPolicy() });
      const cache = byId(report, "http.cache.sitemap_index");
      expect(cache.status).toBe("failed");
      expect(cache.message).toMatch(/weak comparison/);
      expect(exitCodeFor(report)).toBe(1);
    } finally {
      await weak.close();
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

  it.each([
    ["maxPages", 0],
    ["maxEntities", 0],
    ["maxSitemaps", 0],
    ["timeoutMs", 0],
    ["deadlineMs", 0],
    ["maxResponseBytes", 0],
    ["maxRedirects", -1],
    ["maxPages", -5],
    ["timeoutMs", 1.5],
    ["maxPages", Number.NaN],
    ["deadlineMs", Number.POSITIVE_INFINITY],
  ])("rejects %s = %s as a caller error, never as a failing deployment", async (option, value) => {
    // A budget of 0 would otherwise make the first fetch throw
    // `AadpDiscoveryBudgetExceededError`, which would be recorded as a
    // failed check and blamed on the server.
    await expect(runConformance(permissive({ [option]: value }))).rejects.toThrow(InvalidConformanceOptionsError);
  });

  it("accepts maxRedirects = 0, which means do not follow redirects", async () => {
    const report = await runConformance(withNegativeTargets({ maxRedirects: 0 }));
    expect(report.summary.total).toBeGreaterThan(0);
  });

  it("rejects a negative target that is not an http(s) URL", async () => {
    await expect(
      runConformance(permissive({ negativeTargets: { unknownEntityUrl: "not a url" } }))
    ).rejects.toThrow(InvalidConformanceOptionsError);
    await expect(
      runConformance(permissive({ negativeTargets: { unknownTypeUrl: "file:///etc/passwd" } }))
    ).rejects.toThrow(InvalidConformanceOptionsError);
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

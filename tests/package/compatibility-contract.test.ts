import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packAndExtractTarball, cleanupTarball, BUILD_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Locks the stable machine contracts a consumer's CI can depend on
 * (AADP-COMPAT-001 §4.2): conformance check IDs, the JSON/JUnit report
 * shape, `exitCodeFor`'s status→code mapping, server error codes and the
 * default server route templates. Everything is imported from the packed
 * tarball's own `dist/`, not `src/`, so a rename that only breaks a real
 * consumer install fails here.
 *
 * Human-readable messages MAY change between releases — only IDs, codes,
 * enum values and field names are asserted.
 */

let tarball: PackedTarball;

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

function importFromTarball(subpath: string): Promise<Record<string, any>> {
  const distFile = path.join(tarball.packageDir, "dist", subpath, "index.js");
  return import(pathToFileURL(distFile).href);
}

const STABLE_CHECK_IDS = [
  "manifest.http",
  "manifest.version",
  "manifest.schema",
  "manifest.semantic",
  "manifest.discovery_entry_point",
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
  "safety.free_text_is_data",
];

describe("conformance: check IDs are a stable, published contract", () => {
  it("CHECKS contains exactly the documented IDs, in order", async () => {
    const { CHECKS } = await importFromTarball("conformance");
    expect(CHECKS.map((check: { id: string }) => check.id)).toEqual(STABLE_CHECK_IDS);
  });
});

describe("conformance: exitCodeFor status/fatal -> exit code mapping", () => {
  it.each([
    [{ status: "passed", fatal: undefined }, 0],
    [{ status: "failed", fatal: undefined }, 1],
    [{ status: "inconclusive", fatal: undefined }, 4],
    [{ status: "inconclusive", fatal: { code: "unreachable" } }, 2],
    [{ status: "inconclusive", fatal: { code: "unsupported_version" } }, 3],
  ])("%j -> %i", async (partial, expected) => {
    const { exitCodeFor } = await importFromTarball("conformance");
    expect(exitCodeFor(partial as never)).toBe(expected);
  });
});

describe("conformance: JSON report envelope", () => {
  it("report_version is the published constant \"1\"", async () => {
    const { renderJsonReport } = await importFromTarball("conformance");
    const report = {
      report_version: "1",
      aadp_version: "1.0",
      base_url: "https://example.com",
      runner: { name: "aadp-conformance", version: "1.0.9" },
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      duration_ms: 1000,
      status: "passed",
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, inconclusive: 0 },
      checks: [],
    };
    const parsed = JSON.parse(renderJsonReport(report as never));
    expect(parsed.report_version).toBe("1");
    expect(parsed.status).toBe("passed");
  });
});

describe("conformance: JUnit escaping and failOnWarning", () => {
  it("escapes XML-significant characters in message and details", async () => {
    const { renderJUnitReport } = await importFromTarball("conformance");
    const report = {
      report_version: "1",
      aadp_version: "1.0",
      base_url: "https://example.com/a&b",
      runner: { name: "aadp-conformance", version: "1.0.9" },
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      duration_ms: 1000,
      status: "failed",
      summary: { total: 1, passed: 0, failed: 1, warnings: 0, skipped: 0, inconclusive: 0 },
      checks: [
        {
          id: "manifest.http",
          group: "manifest",
          title: "Manifest is reachable",
          status: "failed",
          duration_ms: 1,
          message: '<bad> & "quoted"',
          details: ["line with & <angle>"],
        },
      ],
    };
    const xml = renderJUnitReport(report as never);
    expect(xml).toContain("&lt;bad&gt; &amp; &quot;quoted&quot;");
    expect(xml).toContain("line with &amp; &lt;angle&gt;");
    expect(xml).not.toContain("<bad>");
  });

  it("failOnWarning turns a warning check into a JUnit failure, and leaves it passing otherwise", async () => {
    const { renderJUnitReport } = await importFromTarball("conformance");
    const report = {
      report_version: "1",
      aadp_version: "1.0",
      base_url: "https://example.com",
      runner: { name: "aadp-conformance", version: "1.0.9" },
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      duration_ms: 1000,
      status: "passed",
      summary: { total: 1, passed: 1, failed: 0, warnings: 1, skipped: 0, inconclusive: 0 },
      checks: [
        {
          id: "manifest.semantic",
          group: "manifest",
          title: "Manifest passes semantic checks",
          status: "warning",
          duration_ms: 1,
          message: "placeholder url",
        },
      ],
    };
    const withoutFlag = renderJUnitReport(report as never);
    expect(withoutFlag).not.toContain("<failure");
    expect(withoutFlag).toContain("<system-out>placeholder url</system-out>");

    const withFlag = renderJUnitReport(report as never, { failOnWarning: true });
    expect(withFlag).toContain("<failure");
    expect(withFlag).toContain('type="warning"');
  });
});

describe("server: default AadpServerErrorCode -> HTTP status mapping", () => {
  it("every error factory sets the documented code and status", async () => {
    const server = await importFromTarball("server");
    const cases: Array<[string, string, number]> = [
      ["notFound", "not_found", 404],
      ["invalidRequest", "invalid_request", 400],
      ["unsupportedType", "unsupported_type", 404],
      ["upstreamUnavailable", "upstream_unavailable", 502],
      ["rateLimited", "rate_limited", 429],
      ["unauthorized", "unauthorized", 401],
      ["forbidden", "forbidden", 403],
    ];
    for (const [factoryName, code, status] of cases) {
      const error = server[factoryName]("test message");
      expect(error.code, factoryName).toBe(code);
      expect(error.status, factoryName).toBe(status);
    }
  });
});

describe("server: default route templates", () => {
  it("publishes the documented /ai/v1.0/... convention when routes is omitted", async () => {
    const server = await importFromTarball("server");
    const aadp = server.defineAADP({
      baseUrl: "https://example.com",
      application: {
        name: "Example",
        description: "Example app.",
        publisher: { name: "Example", url: "https://example.com" },
      },
      policies: { robots: "https://example.com/robots.txt", terms: "https://example.com/terms" },
      resources: [
        server.defineResource({
          type: "post",
          list: () => ({ items: [], nextCursor: null }),
          get: () => null,
          serialize: (x: never) => x,
        }),
      ],
    });
    const manifest = aadp.manifest();
    expect(manifest.discovery.sitemap_index).toBe("https://example.com/ai/v1.0/sitemap-index.json");
  });
});

describe("validator: UnsupportedAadpVersionError.code is a stable string", () => {
  it("is \"unsupported_version\"", async () => {
    const { UnsupportedAadpVersionError } = await importFromTarball("validator");
    const error = new UnsupportedAadpVersionError("9.9");
    expect(error.code).toBe("unsupported_version");
  });
});

describe("client: AbortedError.code is a stable string, distinct from TimeoutError (ADR-0006)", () => {
  it("is \"aborted\", not \"timeout\"", async () => {
    const client = await importFromTarball("client");
    const aborted = new client.v1.AbortedError("https://example.com", "caller reason");
    expect(aborted.code).toBe("aborted");
    const timeout = new client.v1.TimeoutError("https://example.com", 10_000);
    expect(timeout.code).toBe("timeout");
  });
});

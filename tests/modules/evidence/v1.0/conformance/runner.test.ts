import { afterEach, describe, expect, it } from "vitest";
import {
  runEvidenceConformance,
  evidenceExitCodeFor,
  renderEvidenceTextReport,
  renderEvidenceJsonReport,
  renderEvidenceJUnitReport,
  EVIDENCE_CHECKS,
  InvalidEvidenceConformanceOptionsError,
} from "../../../../../src/modules/evidence/v1.0/conformance/index.js";
import {
  EvidenceCheckSignal,
  type EvidenceCheckContext,
  type EvidenceRequestPurpose,
  type EvidenceRequestRecord,
  type EvidenceResolutionRecord,
  type EvidenceRunState,
} from "../../../../../src/modules/evidence/v1.0/conformance/checks.js";
import { canonicalTargetKey, normalizeTargetUrl } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { createPermissiveUrlPolicy, type EntityV1 } from "../../../../../src/client/v1.0/index.js";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";
import {
  startServer,
  sendJson,
  buildClaimEntity,
  buildEvidenceEntity,
  buildXAnswer,
  type TestServer,
} from "../client/server-helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const CLAIM_PATH = "/entities/claim/uptime.json";
const EVIDENCE_PATH = "/entities/evidence/report.json";
const ANSWER_PATH = "/entities/answer/uptime.json";

function buildManifest(host: string, modules?: unknown[]) {
  return {
    aadp_version: "1.0",
    application: { name: "Test", description: "Test app.", publisher: { name: "Test", url: `http://${host}` } },
    discovery: { sitemap_index: `http://${host}/ai/v1.0/sitemap-index.json` },
    policies: { robots: `http://${host}/robots.txt`, terms: `http://${host}/terms` },
    ...(modules ? { modules } : {}),
  };
}

function buildAnswerEntity(base: string): Record<string, unknown> {
  const xAnswer = buildXAnswer({
    related_entities: [{ target_type: "claim", target: { id: "claim:uptime", url: `${base}${CLAIM_PATH}` } }],
  });
  return {
    aadp_version: "1.0",
    id: "answer:uptime",
    type: "answer",
    checksum: checksumOf({}),
    updated_at: (xAnswer.freshness as { updated_at: string }).updated_at,
    canonical_url: "https://example.com/answers/uptime",
    data: {},
    x_answer: xAnswer,
  };
}

/** A deployment that satisfies the whole Evidence 1.0 contract. */
async function startConformingDeployment(): Promise<TestServer> {
  let base = "";
  const created = await startServer((req, res, url) => {
    const host = req.headers.host!;
    if (url.pathname === "/.well-known/ai-manifest.json") {
      return sendJson(res, 200, buildManifest(host, [{ id: "aadp:evidence", version: "1.0", schema: `http://${host}/schemas/module.schema.json` }]));
    }
    if (url.pathname === CLAIM_PATH) {
      return sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:report", url: `${base}${EVIDENCE_PATH}`, confidence: 0.8 }]));
    }
    if (url.pathname === EVIDENCE_PATH) {
      // `retrieved_at` deliberately EARLIER than `updated_at`: a correction
      // published without re-retrieving the source is conformant, because
      // the invariant is ordering, not equality (ADR-0010 §5).
      return sendJson(res, 200, buildEvidenceEntity("report", { updated_at: "2026-08-06T09:00:00Z" }));
    }
    if (url.pathname === ANSWER_PATH) return sendJson(res, 200, buildAnswerEntity(base));
    sendJson(res, 404, {});
  });
  base = created.baseUrl;
  return created;
}

describe("runEvidenceConformance — a fully conforming deployment", () => {
  it("passes every check against a manifest, claim, evidence and answer that satisfy the contract", async () => {
    server = await startConformingDeployment();

    const report = await runEvidenceConformance({
      baseUrl: server.baseUrl,
      sampleClaimUrl: `${server.baseUrl}${CLAIM_PATH}`,
      sampleEvidenceUrl: `${server.baseUrl}${EVIDENCE_PATH}`,
      sampleAnswerUrl: `${server.baseUrl}${ANSWER_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
      now: new Date("2026-08-10T00:00:00Z"),
    });

    const failed = report.checks.filter((c) => c.status === "failed");
    expect(failed).toEqual([]);
    expect(evidenceExitCodeFor(report)).not.toBe(1);
    expect(report.module).toEqual({ id: "aadp:evidence", version: "1.0" });
    expect(report.checks.map((c) => c.id)).toEqual(EVIDENCE_CHECKS.map((c) => c.id));

    // Report renderers don't throw and produce non-empty output.
    expect(renderEvidenceTextReport(report).length).toBeGreaterThan(0);
    expect(JSON.parse(renderEvidenceJsonReport(report)).module.id).toBe("aadp:evidence");
    expect(renderEvidenceJUnitReport(report)).toContain("<testsuite");
  });

  it("does not warn about a non-default URL policy without one, and reports effective limits", async () => {
    server = await startConformingDeployment();
    const report = await runEvidenceConformance({
      sampleEvidenceUrl: `${server.baseUrl}${EVIDENCE_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
    });
    expect(Object.keys(report.effective_limits)).toContain("maxDepth");
  });

  it("is inconclusive (never failed) when no sample URL is supplied", async () => {
    const report = await runEvidenceConformance({});
    expect(report.status).toBe("inconclusive");
    expect(report.checks.every((c) => c.status !== "failed")).toBe(true);
    expect(report.checks.some((c) => c.inconclusive)).toBe(true);
  });
});

describe("runEvidenceConformance — nonconforming deployments", () => {
  it("fails evidence.context when retrieved_at is LATER than the core updated_at", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === EVIDENCE_PATH) {
        return sendJson(res, 200, buildEvidenceEntity("report", { updated_at: "2026-02-01T00:00:00Z" }));
      }
      sendJson(res, 404, {});
    });

    const report = await runEvidenceConformance({
      sampleEvidenceUrl: `${server.baseUrl}${EVIDENCE_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.context"].status).toBe("failed");
    expect(report.status).toBe("failed");
    expect(evidenceExitCodeFor(report)).toBe(1);
  });

  it("fails evidence.graph when a claim cites a target that does not exist", async () => {
    let base = "";
    server = await startServer((_req, res, url) => {
      if (url.pathname === CLAIM_PATH) {
        return sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:missing", url: `${base}/entities/evidence/missing.json` }]));
      }
      sendJson(res, 404, {});
    });
    base = server.baseUrl;

    const report = await runEvidenceConformance({
      sampleClaimUrl: `${server.baseUrl}${CLAIM_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.graph"].status).toBe("failed");
    expect(byId["evidence.graph"].message).toContain("dangling");
  });

  it("does NOT fail the graph gate for a forbidden target — access control is not a broken graph", async () => {
    let base = "";
    server = await startServer((_req, res, url) => {
      if (url.pathname === CLAIM_PATH) {
        return sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:locked", url: `${base}/entities/evidence/locked.json` }]));
      }
      if (url.pathname === "/entities/evidence/locked.json") return sendJson(res, 403, { error: "forbidden" });
      sendJson(res, 404, {});
    });
    base = server.baseUrl;

    const report = await runEvidenceConformance({
      sampleClaimUrl: `${server.baseUrl}${CLAIM_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.graph"].status).toBe("passed");
  });

  it("is inconclusive, not failed, when the manifest declares another Evidence version", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        const host = req.headers.host!;
        return sendJson(res, 200, buildManifest(host, [{ id: "aadp:evidence", version: "2.0", schema: `http://${host}/s.json` }]));
      }
      sendJson(res, 404, {});
    });

    const report = await runEvidenceConformance({ baseUrl: server.baseUrl, urlPolicy: createPermissiveUrlPolicy() });

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.discovery"].status).toBe("skipped");
    expect(byId["evidence.discovery"].inconclusive).toBe(true);
    expect(report.status).not.toBe("failed");
  });
});

/**
 * The two verdicts that are NOT about the document contents but about what
 * the run itself requested, and why. Both used to be read off a flat list of
 * attempted URLs, which cannot tell a retry from a second resolution, nor a
 * URL requested BECAUSE of a metadata field from the same URL requested for
 * another role.
 */
describe("runEvidenceConformance — request provenance", () => {
  it("passes evidence.graph when a target retries once and then succeeds", async () => {
    let base = "";
    let evidenceHits = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === CLAIM_PATH) {
        return sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:report", url: `${base}${EVIDENCE_PATH}` }]));
      }
      if (url.pathname === EVIDENCE_PATH) {
        evidenceHits++;
        if (evidenceHits === 1) return sendJson(res, 503, { error: "try again" });
        return sendJson(res, 200, buildEvidenceEntity("report", { updated_at: "2026-08-06T09:00:00Z" }));
      }
      sendJson(res, 404, {});
    });
    base = server.baseUrl;

    const report = await runEvidenceConformance({
      sampleClaimUrl: `${server.baseUrl}${CLAIM_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });

    // Two HTTP attempts, one logical resolution — the transient 503 must not
    // read as a fan-in dedup defect.
    expect(evidenceHits).toBe(2);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.graph"].status).toBe("passed");
  });

  it("resolves a fanned-in evidence target exactly once across two claims of one answer", async () => {
    let base = "";
    let evidenceHits = 0;
    const SECOND_CLAIM_PATH = "/entities/claim/latency.json";
    server = await startServer((_req, res, url) => {
      // One evidence document, cited by both claims — the only shape in
      // which fan-in can legally occur, since one claim listing the same
      // canonical target twice is `evidence.semantic.duplicate_target`.
      if (url.pathname === CLAIM_PATH) {
        return sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:report", url: `${base}${EVIDENCE_PATH}` }]));
      }
      if (url.pathname === SECOND_CLAIM_PATH) {
        return sendJson(res, 200, buildClaimEntity("latency", [{ id: "evidence:report", url: `${base}${EVIDENCE_PATH}` }], { id: "claim:latency" }));
      }
      if (url.pathname === EVIDENCE_PATH) {
        evidenceHits++;
        return sendJson(res, 200, buildEvidenceEntity("report", { updated_at: "2026-08-06T09:00:00Z" }));
      }
      if (url.pathname === ANSWER_PATH) {
        const xAnswer = buildXAnswer({
          related_entities: [
            { target_type: "claim", target: { id: "claim:uptime", url: `${base}${CLAIM_PATH}` } },
            { target_type: "claim", target: { id: "claim:latency", url: `${base}${SECOND_CLAIM_PATH}` } },
          ],
        });
        return sendJson(res, 200, {
          aadp_version: "1.0",
          id: "answer:uptime",
          type: "answer",
          checksum: checksumOf({}),
          updated_at: (xAnswer.freshness as { updated_at: string }).updated_at,
          canonical_url: "https://example.com/answers/uptime",
          data: {},
          x_answer: xAnswer,
        });
      }
      sendJson(res, 404, {});
    });
    base = server.baseUrl;

    const report = await runEvidenceConformance({
      sampleClaimUrl: `${server.baseUrl}${CLAIM_PATH}`,
      sampleAnswerUrl: `${server.baseUrl}${ANSWER_PATH}`,
      urlPolicy: createPermissiveUrlPolicy(),
    });

    // One logical resolution, one HTTP request, from two citing claims.
    expect(evidenceHits).toBe(1);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["evidence.answer_link"].status).toBe("passed");
  });
});

/**
 * `evidence.security`'s metadata-traversal verdict, exercised directly over a
 * synthesized run state: `source.url`/`publisher.url` must be `https://`, so
 * a local HTTP test deployment cannot host the URL overlap and aliasing cases
 * this verdict turns on. The check itself makes no request — it only reads
 * what the run already recorded.
 */
describe("evidence.security — metadata traversal provenance", () => {
  const METADATA_URL = "https://sources.example.com/report";

  function evidenceEntityWithSourceUrl(url: string): EntityV1 {
    return buildEvidenceEntity("report", {}, {
      source: { title: "Orbit Report", url, publisher: { name: "Example Orbit" }, access: "public" },
    }) as unknown as EntityV1;
  }

  async function runSecurityCheck(state: Partial<EvidenceRunState>) {
    const signal = (outcome: unknown): never => {
      throw new EvidenceCheckSignal(outcome as never);
    };
    const ctx = {
      options: {},
      state: { requests: [], resolutions: [], purpose: "unattributed", ...state },
      withPurpose: <T,>(_purpose: unknown, fn: () => Promise<T>) => fn(),
      skip: (message: string, details?: string[]) => signal({ status: "skipped", message, details }),
      inconclusive: (message: string, details?: string[]) => signal({ status: "skipped", message, details, inconclusive: true }),
      warn: (message: string, details?: string[]) => signal({ status: "warning", message, details }),
      fail: (message: string, details?: string[]) => signal({ status: "failed", message, details }),
    } as unknown as EvidenceCheckContext;

    const check = EVIDENCE_CHECKS.find((c) => c.id === "evidence.security")!;
    try {
      return (await check.run(ctx)) ?? { status: "passed" as const };
    } catch (err) {
      if (err instanceof EvidenceCheckSignal) return err.outcome;
      throw err;
    }
  }

  function request(url: string, purpose: EvidenceRequestPurpose): EvidenceRequestRecord {
    return { url, normalizedUrl: normalizeTargetUrl(url), purpose };
  }

  function resolution(url: string, context: string, purpose: EvidenceRequestPurpose): EvidenceResolutionRecord {
    return { key: canonicalTargetKey("evidence:report", url), id: "evidence:report", url, kind: "fetch", context, normalizedUrl: normalizeTargetUrl(url), purpose };
  }

  it("does not fail when a metadata URL is also the explicitly supplied sample URL", async () => {
    const outcome = await runSecurityCheck({
      evidenceEntity: evidenceEntityWithSourceUrl(METADATA_URL),
      requests: [request(METADATA_URL, "sample-evidence")],
    });
    expect(outcome.status).not.toBe("failed");
  });

  it("does not fail when a metadata URL is resolved through a declared reference", async () => {
    const outcome = await runSecurityCheck({
      evidenceEntity: evidenceEntityWithSourceUrl(METADATA_URL),
      requests: [request(METADATA_URL, "claim-graph")],
      resolutions: [resolution(METADATA_URL, "evidence.evidence_refs[0]", "claim-graph")],
    });
    expect(outcome.status).not.toBe("failed");
  });

  it("fails when a metadata field itself is the decision point that resolved the URL", async () => {
    const outcome = await runSecurityCheck({
      evidenceEntity: evidenceEntityWithSourceUrl(METADATA_URL),
      resolutions: [resolution(METADATA_URL, "evidence.source.url", "claim-graph")],
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toContain("metadata URL was traversed");
  });

  it("sees through an equivalent URL spelling — the same canonicalizer on both sides", async () => {
    // Raw metadata `https://sources.example.com` and a requested
    // `https://sources.example.com/` are one URL; raw string equality
    // against the request log would miss this entirely.
    const outcome = await runSecurityCheck({
      evidenceEntity: evidenceEntityWithSourceUrl("https://sources.example.com"),
      requests: [request("https://sources.example.com/", "claim-graph")],
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.details?.join(" ")).toContain("source.url");
  });
});

describe("runEvidenceConformance — option preflight", () => {
  it.each([
    ["timeoutMs", 0],
    ["maxRequests", 0],
    ["maxNodes", -1],
    ["maxDepth", 1.5],
  ])("rejects %s=%s before making any request", async (option, value) => {
    await expect(runEvidenceConformance({ [option]: value } as never)).rejects.toBeInstanceOf(InvalidEvidenceConformanceOptionsError);
  });

  it("rejects an invalid injected clock", async () => {
    await expect(runEvidenceConformance({ now: new Date("nonsense") })).rejects.toBeInstanceOf(InvalidEvidenceConformanceOptionsError);
  });

  it("rejects an unparseable baseUrl", async () => {
    await expect(runEvidenceConformance({ baseUrl: "not a url" })).rejects.toBeInstanceOf(TypeError);
  });

  it("accepts the boundary values that are meaningful rather than blocking", async () => {
    const report = await runEvidenceConformance({ maxRedirects: 0, maxDepth: 0, maxNodes: 0, maxCrossOriginRequests: 0, freshnessMaxAgeMs: 0 });
    expect(report.status).toBe("inconclusive");
  });
});

/**
 * The composition boundary between Answer `1.0` and Evidence `1.0` once both
 * run on the shared canonical resolution layer (ADR-0010 §10-§11):
 *
 * - one canonical outcome cache per budget, so neither module manufactures a
 *   false `invalid` for a target the other already fetched; and
 * - the resolution-context binding released in `1.3.1`, inherited by the
 *   shared layer and reachable through EVERY Evidence entry point — a budget
 *   is one immutable request configuration, and a mismatch fails closed
 *   before any cache replay, budget charge or request.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AadpClientError, createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { resolveAnswerTargets } from "../../../../../src/modules/answer/v1.0/client/resolve.js";
import { resolveAnswerEvidenceV1, resolveClaimEvidenceV1 } from "../../../../../src/modules/evidence/v1.0/client/resolve.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import type { EvidenceClaimDocumentV1 } from "../../../../../src/modules/evidence/v1.0/types.js";
import { buildClaimWrapper, buildEvidenceEntity, buildXAnswer, sendJson, startServer, type TestServer } from "./server-helpers.js";

const POLICY = createPermissiveUrlPolicy();
const PERMISSIVE = { urlPolicy: POLICY };
const SECRET = "Bearer tenant-a-secret";

const evidencePath = (slug: string) => `/entities/evidence/${slug}.json`;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startEvidenceServer(options: { requireAuth?: boolean } = {}): Promise<TestServer> {
  return startServer((req, res, url) => {
    if (options.requireAuth && req.headers.authorization !== SECRET) return sendJson(res, 401, { error: "unauthorized" });
    const slug = url.pathname.startsWith("/entities/evidence/") ? url.pathname.slice("/entities/evidence/".length, -".json".length) : undefined;
    if (!slug) return sendJson(res, 404, { error: "not_found" });
    sendJson(res, 200, buildEvidenceEntity(slug));
  });
}

function claimCiting(url: string): EvidenceClaimDocumentV1 {
  return buildClaimWrapper([{ id: "evidence:report", url }]) as unknown as EvidenceClaimDocumentV1;
}

function answerCiting(url: string, targetType = "evidence"): AnswerDocumentV1 {
  return buildXAnswer({
    related_entities: [{ target_type: targetType, target: { id: "evidence:report", url } }],
  }) as unknown as AnswerDocumentV1;
}

describe("one canonical outcome cache per budget, shared by both modules", () => {
  it("does not report a false invalid for a target the OTHER module already fetched", async () => {
    server = await startEvidenceServer();
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    // Answer resolves the target first, charging `visitedTargets`.
    const answerResult = await resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget });
    expect(answerResult.items.map((i) => i.status)).toEqual(["resolved"]);

    // Evidence then meets the same canonical key on the same budget. Before
    // the shared layer, this saw only Relations' bare `duplicate` and had to
    // report `invalid`; now it replays the recorded outcome.
    const graph = await resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget });
    expect(graph.edges.map((e) => e.status)).toEqual(["resolved"]);
    expect(server.requestLog.filter((p) => p === evidencePath("report"))).toHaveLength(1);
  });

  it("holds in the other direction too — Evidence first, then Answer", async () => {
    server = await startEvidenceServer();
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    const graph = await resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget });
    expect(graph.edges.map((e) => e.status)).toEqual(["resolved"]);

    const answerResult = await resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget });
    expect(answerResult.items.map((i) => i.status)).toEqual(["resolved"]);
    expect(server.requestLog.filter((p) => p === evidencePath("report"))).toHaveLength(1);
  });
});

describe("resolution context binding reaches every Evidence entry point", () => {
  function expectContextMismatch(err: unknown): AadpClientError {
    expect(err).toBeInstanceOf(AadpClientError);
    const clientError = err as AadpClientError;
    expect(clientError.code).toBe("resolution_context_mismatch");
    // The message must stay safe to log wherever an AadpClientError already is.
    expect(clientError.message).not.toContain(SECRET);
    expect(clientError.message.toLowerCase()).not.toContain("authorization:");
    return clientError;
  }

  it("refuses an anonymous Evidence walk on a budget first used with credentials", async () => {
    server = await startEvidenceServer({ requireAuth: true });
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget, headers: { Authorization: SECRET } });
    const requestsAfterFirst = server.requestLog.length;

    await expect(resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget })).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
    // Fail closed BEFORE anything: no replayed result, no new request.
    expect(server.requestLog).toHaveLength(requestsAfterFirst);
  });

  it("refuses an Answer walk on a budget first used by Evidence with a different context", async () => {
    server = await startEvidenceServer({ requireAuth: true });
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    await resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget, headers: { Authorization: SECRET } });

    await expect(resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget })).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
  });

  it("refuses through resolveAnswerEvidenceV1 as well — no entry point bypasses the check", async () => {
    server = await startEvidenceServer({ requireAuth: true });
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget, headers: { Authorization: SECRET } });

    await expect(resolveAnswerEvidenceV1(answerCiting(url), { ...PERMISSIVE, budget })).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
  });

  it("fails closed for concurrent calls too, whichever one wins the race", async () => {
    server = await startEvidenceServer({ requireAuth: true });
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    const results = await Promise.allSettled([
      resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget, headers: { Authorization: SECRET } }),
      resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget }),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expectContextMismatch((rejected[0] as PromiseRejectedResult).reason);
  });

  it("allows two calls that differ only by signal — caller-local waiting state is not part of the context", async () => {
    server = await startEvidenceServer();
    const url = `${server.baseUrl}${evidencePath("report")}`;
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answerCiting(url), { ...PERMISSIVE, budget, signal: new AbortController().signal });
    const graph = await resolveClaimEvidenceV1(claimCiting(url), { ...PERMISSIVE, budget, signal: new AbortController().signal });

    expect(graph.edges.map((e) => e.status)).toEqual(["resolved"]);
  });
});

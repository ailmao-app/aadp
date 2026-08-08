/**
 * Resolution context binding (`resolution-context.ts`).
 *
 * `BudgetResolutionState` caches settled outcomes and joins in-flight
 * fetches keyed by `{budget, canonical target}` alone, while every
 * request-shaping option is per-call. These tests pin the fix: a budget is
 * bound to one immutable request configuration on first use, and any later
 * call with a different one fails closed before it can replay a result,
 * join a request, or charge the budget.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveAnswerTargets } from "../../../../../src/modules/answer/v1.0/client/resolve.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { AadpClientError, createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";
import { startServer, sendJson, buildXAnswer, type TestServer } from "./server-helpers.js";

const POLICY = createPermissiveUrlPolicy();
const PERMISSIVE = { urlPolicy: POLICY };
const SECRET = "Bearer tenant-a-secret";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function answerFor(url: string): AnswerDocumentV1 {
  return buildXAnswer({
    related_entities: [{ target_type: "service", target: { id: "service:orbit", url } }],
  }) as unknown as AnswerDocumentV1;
}

/** Serves the entity only to a caller presenting `SECRET`; 401 otherwise. */
async function startProtectedServer(): Promise<TestServer> {
  return startServer((req, res) => {
    if (req.headers.authorization !== SECRET) return sendJson(res, 401, {});
    sendJson(res, 200, {
      aadp_version: "1.0",
      id: "service:orbit",
      type: "service",
      checksum: checksumOf({}),
      updated_at: "2026-08-01T00:00:00Z",
      data: {},
    });
  });
}

function expectContextMismatch(err: unknown) {
  expect(err).toBeInstanceOf(AadpClientError);
  const clientError = err as AadpClientError;
  expect(clientError.code).toBe("resolution_context_mismatch");
  return clientError;
}

describe("resolution context binding — authorization boundary", () => {
  it("does not replay an authenticated result for a later anonymous call on the same budget", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    const authed = await resolveAnswerTargets(answer, {
      ...PERMISSIVE,
      budget,
      headers: { Authorization: SECRET },
    });
    expect(authed.items[0].status).toBe("resolved");
    const requestsAfterFirstCall = server.requestLog.length;

    // Same budget, no credentials: must fail closed rather than serve the
    // cached entity the first call paid for.
    await expect(resolveAnswerTargets(answer, { ...PERMISSIVE, budget })).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });

    // And it must be a no-op: no request, no budget mutation.
    expect(server.requestLog.length).toBe(requestsAfterFirstCall);
  });

  it("rejects an authenticated call after an anonymous one (inverse order)", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    const anonymous = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(anonymous.items[0].status).toBe("forbidden");

    await expect(
      resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { Authorization: SECRET } })
    ).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
  });

  it("rejects a second principal's credentials on the same budget", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { Authorization: SECRET } });

    await expect(
      resolveAnswerTargets(answer, {
        ...PERMISSIVE,
        budget,
        headers: { Authorization: "Bearer tenant-b-secret" },
      })
    ).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
  });

  it("never names an option, header or digest in the mismatch message", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();
    await resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { Authorization: SECRET } });

    const err = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget }).catch((e) => e);
    const clientError = expectContextMismatch(err);
    expect(clientError.message).not.toContain(SECRET);
    expect(clientError.message).not.toContain("tenant-a");
    expect(clientError.message).not.toMatch(/[0-9a-f]{32,}/);
  });
});

describe("resolution context binding — request and safety limits", () => {
  /** Every one of these can change the shared request or the outcome replayed from it. */
  const mismatching: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["maxResponseBytes high then low", { maxResponseBytes: 10 * 1024 * 1024 }, { maxResponseBytes: 1024 * 1024 }],
    ["maxResponseBytes low then high", { maxResponseBytes: 1024 * 1024 }, { maxResponseBytes: 10 * 1024 * 1024 }],
    ["maxRedirects", { maxRedirects: 5 }, { maxRedirects: 0 }],
    ["timeoutMs", { timeoutMs: 10_000 }, { timeoutMs: 50 }],
    ["retry enabled vs disabled", { retry: { maxAttempts: 2 } }, {}],
    ["retry tuning", { retry: { maxAttempts: 2 } }, { retry: { maxAttempts: 5 } }],
    ["crossOriginSafeHeaders", { crossOriginSafeHeaders: ["authorization"] }, {}],
    ["rootOrigin", { rootOrigin: "https://a.example" }, { rootOrigin: "https://b.example" }],
    ["urlPolicy instance", { urlPolicy: POLICY }, { urlPolicy: createPermissiveUrlPolicy() }],
    ["onBeforeAttempt", { onBeforeAttempt: () => {} }, {}],
  ];

  it.each(mismatching)("fails closed when %s differs", async (_name, first, second) => {
    server = await startServer((_req, res) =>
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: "service:orbit",
        type: "service",
        checksum: checksumOf({}),
        updated_at: "2026-08-01T00:00:00Z",
        data: {},
      })
    );
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answer, { urlPolicy: POLICY, ...first, budget });
    const requestsAfterFirstCall = server.requestLog.length;

    await expect(
      resolveAnswerTargets(answer, { urlPolicy: POLICY, ...second, budget })
    ).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
    expect(server.requestLog.length).toBe(requestsAfterFirstCall);
  });
});

describe("resolution context binding — equivalent contexts still share", () => {
  async function startPlainServer(): Promise<TestServer> {
    return startServer((_req, res) =>
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: "service:orbit",
        type: "service",
        checksum: checksumOf({}),
        updated_at: "2026-08-01T00:00:00Z",
        data: {},
      })
    );
  }

  const equivalent: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["omitted vs explicit defaults", {}, { timeoutMs: 10_000, maxRedirects: 5, maxResponseBytes: 2 * 1024 * 1024 }],
    ["header name casing", { headers: { Authorization: "Bearer t" } }, { headers: { authorization: "Bearer t" } }],
    [
      "crossOriginSafeHeaders order, casing and duplicates",
      { crossOriginSafeHeaders: ["Authorization", "X-Tenant"] },
      { crossOriginSafeHeaders: ["x-tenant", "authorization", "authorization"] },
    ],
    ["signal only", { signal: new AbortController().signal }, { signal: new AbortController().signal }],
  ];

  it.each(equivalent)("treats %s as the same context", async (_name, first, second) => {
    server = await startPlainServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    const a = await resolveAnswerTargets(answer, { ...PERMISSIVE, ...first, budget });
    const b = await resolveAnswerTargets(answer, { ...PERMISSIVE, ...second, budget });

    expect(a.items[0].status).toBe("resolved");
    expect(b.items[0].status).toBe("resolved");
    // Unchanged pre-fix behavior: the second call replays the cached
    // canonical outcome instead of re-fetching.
    expect(server.requestLog.length).toBe(1);
  });

  it("does not collide when a header name or value contains the encoding delimiter", async () => {
    server = await startPlainServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    await resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { "x-a": "1:x-b" } });
    await expect(
      resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { "x-a:1": "x-b" } })
    ).rejects.toSatisfy((err) => {
      expectContextMismatch(err);
      return true;
    });
  });

  it("keeps separate budgets fully independent", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);

    const authed = await resolveAnswerTargets(answer, {
      ...PERMISSIVE,
      budget: createRelationsTraversalBudget(),
      headers: { Authorization: SECRET },
    });
    const anonymous = await resolveAnswerTargets(answer, {
      ...PERMISSIVE,
      budget: createRelationsTraversalBudget(),
    });

    expect(authed.items[0].status).toBe("resolved");
    expect(anonymous.items[0].status).toBe("forbidden");
  });
});

describe("resolution context binding — concurrency", () => {
  it("rejects the mismatched call in a race without corrupting the well-formed one", async () => {
    server = await startProtectedServer();
    const answer = answerFor(`${server.baseUrl}/entities/service/orbit.json`);
    const budget = createRelationsTraversalBudget();

    const [authed, anonymous] = await Promise.allSettled([
      resolveAnswerTargets(answer, { ...PERMISSIVE, budget, headers: { Authorization: SECRET } }),
      resolveAnswerTargets(answer, { ...PERMISSIVE, budget }),
    ]);

    // The binding is established synchronously by whichever call runs first,
    // so exactly one succeeds and the other fails closed — never both, and
    // never a shared result across the two contexts.
    const outcomes = [authed, anonymous];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectContextMismatch((rejected[0] as PromiseRejectedResult).reason);
  });
});

/**
 * The shared canonical-resolution layer's accounting contract.
 *
 * `resolveCanonicalTarget` reports the decision it took for THIS invocation:
 * `started` is true only for the call that created the fetch. Every consumer
 * that counts logical work — the graph traversal service's `summary.requests`
 * today — depends on that being decided here, at the synchronous point where
 * `pending` is read, rather than re-derived by a caller before the call.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy } from "../../../src/client/url-policy.js";
import { createRelationsTraversalBudget } from "../../../src/modules/relations/v1.0/index.js";
import {
  budgetResolutionStateFor,
  resolveCanonicalTarget,
  type CanonicalResolutionOptions,
} from "../../../src/modules/shared/canonical-resolution.js";
import { checksumOf } from "../../../src/canonical-json/checksum.js";
import { sendJson, startServer, type TestServer } from "../answer/v1.0/client/server-helpers.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const urlPolicy = createPermissiveUrlPolicy();

function documentEntity(base: string) {
  return {
    aadp_version: "1.0",
    id: "document:d",
    type: "document",
    checksum: checksumOf({}),
    updated_at: "2026-08-06T00:00:00Z",
    canonical_url: `${base}/document.json`,
    data: {},
  };
}

describe("resolveCanonicalTarget reports the decision it took", () => {
  it("marks exactly one of two concurrent callers as the one that started the fetch", async () => {
    let reached: () => void;
    const requestReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    server = await startServer((_req, res, url) => {
      if (url.pathname !== "/document.json") return sendJson(res, 404, { error: "not found" });
      reached();
      void held.then(() => sendJson(res, 200, documentEntity(server!.baseUrl)));
    });

    const budget = createRelationsTraversalBudget();
    const options: CanonicalResolutionOptions = { budget, urlPolicy };
    const state = budgetResolutionStateFor(budget, options);
    const target = { id: "document:d", url: `${server.baseUrl}/document.json` };

    try {
      const first = resolveCanonicalTarget(state, target, "document", options, "test");
      // Only once the fetch is genuinely in flight can a second caller join it.
      await requestReached;
      const second = resolveCanonicalTarget(state, target, "document", options, "test");
      release!();

      const [a, b] = await Promise.all([first, second]);

      expect([a.started, b.started].filter(Boolean)).toHaveLength(1);
      expect(a.status).toBe("outcome");
      expect(b.status).toBe("outcome");
      expect(server.requestLog.filter((path) => path === "/document.json")).toHaveLength(1);
      expect(budget.requestsMade).toBe(1);
    } finally {
      release!();
    }
  });

  it("reports a replay of a settled outcome as not started", async () => {
    server = await startServer((_req, res, url) =>
      url.pathname === "/document.json"
        ? sendJson(res, 200, documentEntity(server!.baseUrl))
        : sendJson(res, 404, { error: "not found" })
    );

    const budget = createRelationsTraversalBudget();
    const options: CanonicalResolutionOptions = { budget, urlPolicy };
    const state = budgetResolutionStateFor(budget, options);
    const target = { id: "document:d", url: `${server.baseUrl}/document.json` };

    const first = await resolveCanonicalTarget(state, target, "document", options, "test");
    const second = await resolveCanonicalTarget(state, target, "document", options, "test");

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(server.requestLog.filter((path) => path === "/document.json")).toHaveLength(1);
  });

  it("reports a call that stopped before starting anything as not started", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, documentEntity(server!.baseUrl)));

    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();
    controller.abort();
    const options: CanonicalResolutionOptions = { budget, urlPolicy, signal: controller.signal };
    const state = budgetResolutionStateFor(budget, options);

    const resolution = await resolveCanonicalTarget(
      state,
      { id: "document:d", url: `${server.baseUrl}/document.json` },
      "document",
      options,
      "test"
    );

    expect(resolution).toMatchObject({ status: "stopped", started: false });
    expect(server.requestLog).toEqual([]);
    expect(budget.requestsMade).toBe(0);
  });
});

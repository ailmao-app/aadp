import { afterEach, describe, expect, it } from "vitest";
import { resolveAnswerTargets } from "../../../../../src/modules/answer/v1.0/client/resolve.js";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";
import { startServer, sendJson, buildXAnswer, type TestServer } from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

type Ref = { target_type: string; target: { id: string; url: string } };

function withRelatedEntities(refs: Ref[]): AnswerDocumentV1 {
  return buildXAnswer({ related_entities: refs }) as unknown as AnswerDocumentV1;
}

function withGeneratedSourceTargets(refs: Ref[]): AnswerDocumentV1 {
  return buildXAnswer({
    authorship: {
      kind: "generated-summary",
      generator: { name: "Example Summarizer" },
      generated_at: "2026-08-06T08:55:00Z",
      source_targets: refs,
    },
  }) as unknown as AnswerDocumentV1;
}

function serviceEntity(id: string, type: string = id.split(":")[0] ?? "service") {
  return {
    aadp_version: "1.0",
    id,
    type,
    checksum: checksumOf({}),
    updated_at: "2026-08-01T00:00:00Z",
    data: {},
  };
}

describe("resolveAnswerTargets", () => {
  it("resolves every related_entities reference in input order", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/service/orbit.json") {
        return sendJson(res, 200, {
          aadp_version: "1.0",
          id: "service:orbit",
          type: "service",
          checksum: checksumOf({}),
          updated_at: "2026-08-01T00:00:00Z",
          data: {},
        });
      }
      sendJson(res, 404, {});
    });
    const answer = withRelatedEntities([
      { target_type: "service", target: { id: "service:orbit", url: `${server.baseUrl}/entities/service/orbit.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.partial).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe("resolved");
    expect(result.items[0].entity?.id).toBe("service:orbit");
    expect(result.items[0].group).toBe("related_entities");
    expect(result.items[0].index).toBe(0);
  });

  it("returns an empty result for an answer with no related_entities", async () => {
    const answer = buildXAnswer() as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result).toEqual({ items: [], partial: false });
  });

  it("classifies a not-found target without throwing", async () => {
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    const answer = withRelatedEntities([
      { target_type: "service", target: { id: "service:missing", url: `${server.baseUrl}/entities/service/missing.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.partial).toBe(false);
    expect(result.items[0].status).toBe("not-found");
  });

  it("marks every not-yet-attempted reference budget-exhausted once the shared budget stops the walk, and never reports partial:false", async () => {
    server = await startServer((_req, res, url) => {
      const id = url.pathname.split("/").pop()!.replace(".json", "");
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: `service:${id}`,
        type: "service",
        checksum: checksumOf({}),
        updated_at: "2026-08-01T00:00:00Z",
        data: {},
      });
    });
    const answer = withRelatedEntities([
      { target_type: "service", target: { id: "service:a", url: `${server.baseUrl}/entities/service/a.json` } },
      { target_type: "service", target: { id: "service:b", url: `${server.baseUrl}/entities/service/b.json` } },
      { target_type: "service", target: { id: "service:c", url: `${server.baseUrl}/entities/service/c.json` } },
    ]);
    const budget = createRelationsTraversalBudget({ maxNodes: 1 });
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.partial).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].status).toBe("resolved");
    expect(result.items[1].status).toBe("budget-exhausted");
    expect(result.items[2].status).toBe("budget-exhausted");
  });

  it("does not create its own child budget — charges against the caller-owned budget", async () => {
    server = await startServer((_req, res, url) => {
      const id = url.pathname.split("/").pop()!.replace(".json", "");
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: `service:${id}`,
        type: "service",
        checksum: checksumOf({}),
        updated_at: "2026-08-01T00:00:00Z",
        data: {},
      });
    });
    const answer = withRelatedEntities([
      { target_type: "service", target: { id: "service:a", url: `${server.baseUrl}/entities/service/a.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    expect(budget.nodesVisited).toBe(0);
    await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(budget.nodesVisited).toBe(1);
  });
});

describe("resolveAnswerTargets — generated-summary source_targets", () => {
  it("resolves authorship.source_targets when related_entities is absent", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/document/nimbus.json") return sendJson(res, 200, serviceEntity("document:nimbus"));
      sendJson(res, 404, {});
    });
    const answer = withGeneratedSourceTargets([
      { target_type: "document", target: { id: "document:nimbus", url: `${server.baseUrl}/entities/document/nimbus.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].group).toBe("source_targets");
    expect(result.items[0].index).toBe(0);
    expect(result.items[0].status).toBe("resolved");
  });

  it("resolves both related_entities and source_targets, tagging each entry with its own group/index", async () => {
    server = await startServer((_req, res, url) => {
      const id = url.pathname.split("/").pop()!.replace(".json", "");
      sendJson(res, 200, serviceEntity(`x:${id}`));
    });
    const answer = buildXAnswer({
      related_entities: [{ target_type: "x", target: { id: "x:a", url: `${server.baseUrl}/entities/x/a.json` } }],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [{ target_type: "x", target: { id: "x:b", url: `${server.baseUrl}/entities/x/b.json` } }],
      },
    }) as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ group: "related_entities", index: 0, status: "resolved" });
    expect(result.items[1]).toMatchObject({ group: "source_targets", index: 0, status: "resolved" });
  });

  it("reports a target shared across both groups as resolved on its second (duplicate) occurrence too, without a second fetch, replaying the already-fetched entity from memory", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("x:shared")));
    const sharedTarget = { target_type: "x", target: { id: "x:shared", url: `${server.baseUrl}/entities/x/shared.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].status).toBe("resolved");
    expect(result.items[1].status).toBe("resolved");
    // Not re-fetched over the network (nodesVisited stays 1), but this
    // call already has the entity in memory from the first occurrence, so
    // the duplicate is given the same entity object rather than withheld.
    expect(result.items[1].entity?.id).toBe("x:shared");
    expect(result.items[1].entity).toBe(result.items[0].entity);
    expect(budget.nodesVisited).toBe(1); // charged once, shared across groups via the same caller-owned budget
  });

  it("replays a not-found outcome (not resolved) for a shared target whose first occurrence 404s", async () => {
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    const sharedTarget = { target_type: "x", target: { id: "x:missing", url: `${server.baseUrl}/entities/x/missing.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ group: "related_entities", index: 0, status: "not-found" });
    // The mandatory generated-summary provenance entry MUST inherit the
    // same not-found outcome, not be reported as resolved — this is the
    // exact case the P1 finding covers.
    expect(result.items[1]).toMatchObject({ group: "source_targets", index: 0, status: "not-found" });
    expect(result.items[1].entity).toBeUndefined();
  });

  it("replays a forbidden outcome for a shared target whose first occurrence is 401", async () => {
    server = await startServer((_req, res) => sendJson(res, 401, {}));
    const sharedTarget = { target_type: "x", target: { id: "x:secret", url: `${server.baseUrl}/entities/x/secret.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("forbidden");
    expect(result.items[1].status).toBe("forbidden");
  });

  it("replays an invalid outcome for a shared target whose first occurrence has a schema-invalid response", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, { not: "a valid entity" }));
    const sharedTarget = { target_type: "x", target: { id: "x:broken", url: `${server.baseUrl}/entities/x/broken.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
    expect(result.items[1].status).toBe("invalid");
  });

  it("replays an invalid outcome for a shared target whose first occurrence has a checksum mismatch", async () => {
    server = await startServer((_req, res) =>
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: "x:tampered",
        type: "x",
        checksum: `sha256:${"0".repeat(64)}`,
        updated_at: "2026-08-01T00:00:00Z",
        data: { a: 1 },
      })
    );
    const sharedTarget = { target_type: "x", target: { id: "x:tampered", url: `${server.baseUrl}/entities/x/tampered.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
    expect(result.items[1].status).toBe("invalid");
  });

  it("replays a resolved outcome (with entity) for a shared target whose first occurrence succeeds — inverse group order sanity check", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("x:ok")));
    const sharedTarget = { target_type: "x", target: { id: "x:ok", url: `${server.baseUrl}/entities/x/ok.json` } };
    const answer = buildXAnswer({
      related_entities: [sharedTarget],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [sharedTarget],
      },
    }) as unknown as AnswerDocumentV1;
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0]).toMatchObject({ status: "resolved" });
    expect(result.items[0].entity?.id).toBe("x:ok");
    // Second (duplicate) occurrence replays the same success and the same
    // already-fetched entity object — not re-fetched over the network.
    expect(result.items[1]).toMatchObject({ status: "resolved" });
    expect(result.items[1].entity).toBe(result.items[0].entity);
  });

  it("replays a prior failure across two separate resolveAnswerTargets calls sharing the same budget (P1: cross-call shared-budget replay)", async () => {
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    const sharedTarget = { target_type: "x", target: { id: "x:cross-call", url: `${server.baseUrl}/entities/x/cross-call.json` } };
    const budget = createRelationsTraversalBudget();
    const first = withRelatedEntities([sharedTarget]);
    const firstResult = await resolveAnswerTargets(first, { ...PERMISSIVE, budget });
    expect(firstResult.items[0].status).toBe("not-found");

    // A second, independent resolveAnswerTargets call (e.g. resolving a
    // different Answer document in the same parent traversal) reusing the
    // SAME caller-owned budget must replay the known failure, not report a
    // bare "resolved" for the now-duplicate target.
    const second = withGeneratedSourceTargets([sharedTarget]);
    const secondResult = await resolveAnswerTargets(second, { ...PERMISSIVE, budget });
    expect(secondResult.items[0].status).toBe("not-found");
    expect(secondResult.items[0].entity).toBeUndefined();
  });

  it("reports invalid (not resolved) for a duplicate whose canonical target was visited outside this resolver, with no outcome to replay (P1: unknown-duplicate)", async () => {
    const budget = createRelationsTraversalBudget();
    // Simulate the target having been visited by some other path over the
    // same budget (e.g. a raw Relations traversal step) — chargeNode marks
    // it visited without this resolver ever producing an outcome for it.
    const { chargeNode } = await import("../../../../../src/modules/relations/v1.0/client/budget.js");
    chargeNode(budget, "x:external", "https://example.test/x/external.json", "test setup");

    const answer = withRelatedEntities([{ target_type: "x", target: { id: "x:external", url: "https://example.test/x/external.json" } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items[0].status).toBe("invalid");
    expect(result.items[0].entity).toBeUndefined();
  });

  it("reports invalid (not the cached entity) when a duplicate occurrence declares a different target_type than the occurrence that resolved it (P1: cross-group target_type integrity)", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("x:typed", "service")));
    const answer = buildXAnswer({
      related_entities: [{ target_type: "service", target: { id: "x:typed", url: `${server.baseUrl}/entities/x/typed.json` } }],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        // Same canonical {id,url} as related_entities[0], but a different
        // declared target_type — not rejected by semantic validation
        // (cross-list dedup identity is {id, normalizedUrl} only).
        source_targets: [{ target_type: "document", target: { id: "x:typed", url: `${server.baseUrl}/entities/x/typed.json` } }],
      },
    }) as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items[0]).toMatchObject({ group: "related_entities", status: "resolved" });
    expect(result.items[0].entity?.type).toBe("service");
    expect(result.items[1]).toMatchObject({ group: "source_targets", status: "invalid" });
    expect(result.items[1].entity).toBeUndefined();
  });

  it("joins an in-flight fetch instead of guessing invalid for a duplicate arriving from a concurrent resolveAnswerTargets call sharing the same budget (P1: concurrent same-budget duplicate)", async () => {
    let requestCount = 0;
    server = await startServer((_req, res) => {
      requestCount++;
      // Delay the response so the concurrent call's duplicate lookup for
      // the same canonical target happens while this fetch is still in
      // flight, not after it has already settled.
      setTimeout(() => sendJson(res, 200, serviceEntity("x:concurrent")), 30);
    });
    const sharedTarget = { target_type: "x", target: { id: "x:concurrent", url: `${server.baseUrl}/entities/x/concurrent.json` } };
    const budget = createRelationsTraversalBudget();
    const answerA = withRelatedEntities([sharedTarget]);
    const answerB = withGeneratedSourceTargets([sharedTarget]);
    const [resultA, resultB] = await Promise.all([
      resolveAnswerTargets(answerA, { ...PERMISSIVE, budget }),
      resolveAnswerTargets(answerB, { ...PERMISSIVE, budget }),
    ]);
    expect(resultA.items[0].status).toBe("resolved");
    expect(resultB.items[0].status).toBe("resolved");
    expect(resultA.items[0].entity?.id).toBe("x:concurrent");
    expect(resultB.items[0].entity?.id).toBe("x:concurrent");
    // Only ever fetched/charged once, no matter which of the two concurrent
    // calls "won" the race to trigger it.
    expect(requestCount).toBe(1);
    expect(budget.nodesVisited).toBe(1);
  });

  it("aborting a joiner's own signal only stops that joiner — the owner call still resolves normally (P1: waiter-level cancellation)", async () => {
    server = await startServer((_req, res) => {
      // Delay so the joiner's abort fires while the owner's fetch is still in flight.
      setTimeout(() => sendJson(res, 200, serviceEntity("x:joiner-abort")), 30);
    });
    const sharedTarget = { target_type: "x", target: { id: "x:joiner-abort", url: `${server.baseUrl}/entities/x/joiner-abort.json` } };
    const budget = createRelationsTraversalBudget();
    const ownerAnswer = withRelatedEntities([sharedTarget]);
    const joinerAnswer = withGeneratedSourceTargets([sharedTarget]);
    const joinerController = new AbortController();

    // Invoked first, so it synchronously becomes the owner of the shared
    // in-flight fetch before the joiner call below even starts.
    const ownerPromise = resolveAnswerTargets(ownerAnswer, { ...PERMISSIVE, budget });
    const joinerPromise = resolveAnswerTargets(joinerAnswer, { ...PERMISSIVE, budget, signal: joinerController.signal });
    setTimeout(() => joinerController.abort(), 5);

    const [ownerResult, joinerResult] = await Promise.all([ownerPromise, joinerPromise]);
    // The joiner's own cancellation stops only the joiner's own wait.
    expect(joinerResult.partial).toBe(true);
    expect(joinerResult.items[0].status).toBe("budget-exhausted");
    // The owner — a different caller, different signal — is unaffected and
    // still gets the real result once the shared fetch completes.
    expect(ownerResult.partial).toBe(false);
    expect(ownerResult.items[0].status).toBe("resolved");
  });

  it("aborting the owner's own signal does not fail a concurrent joiner, and does not poison the budget for a later call (P1: owner-abort isolation)", async () => {
    server = await startServer((_req, res) => {
      setTimeout(() => sendJson(res, 200, serviceEntity("x:owner-abort")), 30);
    });
    const sharedTarget = { target_type: "x", target: { id: "x:owner-abort", url: `${server.baseUrl}/entities/x/owner-abort.json` } };
    const budget = createRelationsTraversalBudget();
    const ownerAnswer = withRelatedEntities([sharedTarget]);
    const joinerAnswer = withGeneratedSourceTargets([sharedTarget]);
    const ownerController = new AbortController();

    const ownerPromise = resolveAnswerTargets(ownerAnswer, { ...PERMISSIVE, budget, signal: ownerController.signal });
    const joinerPromise = resolveAnswerTargets(joinerAnswer, { ...PERMISSIVE, budget });
    setTimeout(() => ownerController.abort(), 5);

    const [ownerResult, joinerResult] = await Promise.all([ownerPromise, joinerPromise]);
    // The owner's own cancellation stops only the owner's own wait — it
    // must not reach (let alone kill) the shared fetch other callers rely on.
    expect(ownerResult.partial).toBe(true);
    expect(ownerResult.items[0].status).toBe("budget-exhausted");
    // The joiner, on a different signal, still resolves normally.
    expect(joinerResult.partial).toBe(false);
    expect(joinerResult.items[0].status).toBe("resolved");

    // A later, unrelated call for the same target on the same budget must
    // not be poisoned by the earlier owner's cancellation — only a genuine
    // shared-budget exhaustion is remembered as a permanent stop, never a
    // caller-scoped abort.
    const laterAnswer = withRelatedEntities([sharedTarget]);
    const laterResult = await resolveAnswerTargets(laterAnswer, { ...PERMISSIVE, budget });
    expect(laterResult.partial).toBe(false);
    expect(laterResult.items[0].status).toBe("resolved");
  });

  it("never starts a fetch/charges the budget for a reference whose signal is already aborted (P2: pre-aborted signal)", async () => {
    let requestCount = 0;
    server = await startServer((_req, res) => {
      requestCount++;
      sendJson(res, 200, serviceEntity("x:pre-aborted"));
    });
    const answer = withRelatedEntities([
      { target_type: "x", target: { id: "x:pre-aborted", url: `${server.baseUrl}/entities/x/pre-aborted.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();
    controller.abort();

    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget, signal: controller.signal });
    expect(result.partial).toBe(true);
    expect(result.items[0].status).toBe("budget-exhausted");
    expect(requestCount).toBe(0);
    expect(budget.nodesVisited).toBe(0);
  });

  it("cancels the real underlying HTTP request once the sole caller's signal aborts mid-flight, not just its own wait (P2: real cancellation)", async () => {
    let serverObservedAbort = false;
    server = await startServer((req, res) => {
      req.on("aborted", () => {
        serverObservedAbort = true;
      });
      req.on("close", () => {
        if (!res.writableEnded) serverObservedAbort = true;
      });
      // Deliberately never responds — the only way this request ends is a
      // client-side abort of the underlying connection.
    });
    const answer = withRelatedEntities([
      { target_type: "x", target: { id: "x:sole-abort", url: `${server.baseUrl}/entities/x/sole-abort.json` } },
    ]);
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();
    const resultPromise = resolveAnswerTargets(answer, { ...PERMISSIVE, budget, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const result = await resultPromise;
    expect(result.partial).toBe(true);
    expect(result.items[0].status).toBe("budget-exhausted");
    // Give the server a moment to observe the client-side connection close.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverObservedAbort).toBe(true);
  });

  it("does not poison a later call for the same target issued immediately after a sole-waiter abort (P1: post-abort retry availability)", async () => {
    let requestCount = 0;
    server = await startServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) {
        // First request: never responds — this is the one that gets aborted.
        return;
      }
      sendJson(res, 200, serviceEntity("x:retry-immediate"));
    });
    const targetRef = { target_type: "x", target: { id: "x:retry-immediate", url: `${server.baseUrl}/entities/x/retry-immediate.json` } };
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();
    const firstPromise = resolveAnswerTargets(withRelatedEntities([targetRef]), { ...PERMISSIVE, budget, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const firstResult = await firstPromise;
    expect(firstResult.partial).toBe(true);
    expect(firstResult.items[0].status).toBe("budget-exhausted");

    // Issued immediately after the aborted call returns (before the
    // abandoned fetch's own rejection has necessarily settled) — must not
    // be permanently stuck reporting "invalid: already visited elsewhere"
    // just because the first, abandoned attempt already charged the budget.
    const laterResult = await resolveAnswerTargets(withRelatedEntities([targetRef]), { ...PERMISSIVE, budget });
    expect(laterResult.partial).toBe(false);
    expect(laterResult.items[0].status).toBe("resolved");
    expect(budget.nodesVisited).toBe(1);
  });

  it("does not poison a later call for the same target after the abandoned fetch's own rejection has settled (P1: post-abort retry availability, settled)", async () => {
    let requestCount = 0;
    server = await startServer((_req, res) => {
      requestCount++;
      if (requestCount === 1) return;
      sendJson(res, 200, serviceEntity("x:retry-settled"));
    });
    const targetRef = { target_type: "x", target: { id: "x:retry-settled", url: `${server.baseUrl}/entities/x/retry-settled.json` } };
    const budget = createRelationsTraversalBudget();
    const controller = new AbortController();
    const firstPromise = resolveAnswerTargets(withRelatedEntities([targetRef]), { ...PERMISSIVE, budget, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const firstResult = await firstPromise;
    expect(firstResult.partial).toBe(true);
    expect(firstResult.items[0].status).toBe("budget-exhausted");

    // Give the abandoned fetch's own rejection time to fully settle before
    // retrying — same verdict as the immediate-retry case above.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const laterResult = await resolveAnswerTargets(withRelatedEntities([targetRef]), { ...PERMISSIVE, budget });
    expect(laterResult.partial).toBe(false);
    expect(laterResult.items[0].status).toBe("resolved");
    expect(budget.nodesVisited).toBe(1);
  });

  it("re-validates a duplicate against its OWN target_type even when the triggering occurrence's declared type was wrong (P1: inverse wrong-type -> correct-type)", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("x:inverse", "document")));
    const answer = buildXAnswer({
      related_entities: [{ target_type: "service", target: { id: "x:inverse", url: `${server.baseUrl}/entities/x/inverse.json` } }],
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        // Same canonical target as related_entities[0] but declares the
        // entity's ACTUAL type — must not inherit the first occurrence's
        // (wrong-type) invalid verdict.
        source_targets: [{ target_type: "document", target: { id: "x:inverse", url: `${server.baseUrl}/entities/x/inverse.json` } }],
      },
    }) as unknown as AnswerDocumentV1;
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result.items[0]).toMatchObject({ group: "related_entities", status: "invalid" });
    expect(result.items[0].entity).toBeUndefined();
    expect(result.items[1]).toMatchObject({ group: "source_targets", status: "resolved" });
    expect(result.items[1].entity?.type).toBe("document");
    expect(budget.nodesVisited).toBe(1); // fetched once, reused for the second (correctly-typed) occurrence
  });

  it("replays budget-exhausted (not invalid) for the exact target that first triggered a global stop, on a later call sharing the same budget (P1: global-stop key survives across calls)", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("x:stopper")));
    const sharedTarget = { target_type: "x", target: { id: "x:stopper", url: `${server.baseUrl}/entities/x/stopper.json` } };
    // maxNodes: 0 means chargeNode throws on the very first distinct target
    // it charges — but it still marks that target visited before throwing.
    const budget = createRelationsTraversalBudget({ maxNodes: 0 });

    const first = withRelatedEntities([sharedTarget]);
    const firstResult = await resolveAnswerTargets(first, { ...PERMISSIVE, budget });
    expect(firstResult.partial).toBe(true);
    expect(firstResult.items[0].status).toBe("budget-exhausted");

    // A second, independent call for the SAME target over the SAME budget
    // must keep reporting the stop that already happened for it — not
    // silently downgrade to invalid/partial:false as if the walk had
    // moved on and this target just turned out to be broken.
    const second = withGeneratedSourceTargets([sharedTarget]);
    const secondResult = await resolveAnswerTargets(second, { ...PERMISSIVE, budget });
    expect(secondResult.partial).toBe(true);
    expect(secondResult.items[0].status).toBe("budget-exhausted");
  });

  it("is inconclusive-free (empty result) when a generated summary's source_targets is the only reference list and related_entities is absent", async () => {
    const answer = buildXAnswer({
      authorship: {
        kind: "generated-summary",
        generator: { name: "Example Summarizer" },
        generated_at: "2026-08-06T08:55:00Z",
        source_targets: [],
      },
    }) as unknown as AnswerDocumentV1;
    // Schema requires source_targets to have >=1 item for a real generated
    // summary; an empty array here only exercises resolveAnswerTargets in
    // isolation from schema validation.
    const budget = createRelationsTraversalBudget();
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget });
    expect(result).toEqual({ items: [], partial: false });
  });
});

describe("resolveAnswerTargets — status taxonomy", () => {
  it("classifies HTTP 404 as not-found", async () => {
    server = await startServer((_req, res) => sendJson(res, 404, {}));
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("not-found");
  });

  it("classifies HTTP 401/403 as forbidden", async () => {
    for (const status of [401, 403]) {
      server = await startServer((_req, res) => sendJson(res, status, {}));
      const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
      const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
      expect(result.items[0].status, `status ${status}`).toBe("forbidden");
      await server.close();
      server = undefined;
    }
  });

  it("classifies HTTP 500 as invalid, not not-found", async () => {
    server = await startServer((_req, res) => sendJson(res, 500, {}));
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
  });

  it("classifies a schema-invalid entity response as invalid", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, { not: "a valid entity" }));
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
  });

  it("classifies a checksum mismatch as invalid", async () => {
    server = await startServer((_req, res) =>
      sendJson(res, 200, {
        aadp_version: "1.0",
        id: "service:x",
        type: "service",
        checksum: `sha256:${"0".repeat(64)}`, // wrong on purpose
        updated_at: "2026-08-01T00:00:00Z",
        data: { a: 1 },
      })
    );
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
  });

  it("classifies a declared-id mismatch (integrity) as invalid", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, serviceEntity("service:different-id")));
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: `${server.baseUrl}/x.json` } }]);
    const result = await resolveAnswerTargets(answer, { ...PERMISSIVE, budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
  });

  it("classifies a blocked (private-network) URL as invalid", async () => {
    const answer = withRelatedEntities([{ target_type: "service", target: { id: "service:x", url: "http://127.0.0.1:1/x.json" } }]);
    // No PERMISSIVE override here — default strict URL policy blocks loopback.
    const result = await resolveAnswerTargets(answer, { budget: createRelationsTraversalBudget() });
    expect(result.items[0].status).toBe("invalid");
  });
});

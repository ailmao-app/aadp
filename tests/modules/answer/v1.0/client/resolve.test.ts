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

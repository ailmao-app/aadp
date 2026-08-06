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

function withRelatedEntities(refs: Array<{ target_type: string; target: { id: string; url: string } }>): AnswerDocumentV1 {
  return buildXAnswer({ related_entities: refs }) as unknown as AnswerDocumentV1;
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

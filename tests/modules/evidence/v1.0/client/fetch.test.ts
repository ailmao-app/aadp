/**
 * `fetchEvidenceEntityV1`: core fetch first (envelope schema + entity
 * checksum), then Evidence entity-context validation — and no URL out of
 * `x_evidence` is ever requested (specification.md §13).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { fetchEvidenceEntityV1 } from "../../../../../src/modules/evidence/v1.0/client/fetch.js";
import { EvidenceEntityFetchValidationError } from "../../../../../src/modules/evidence/v1.0/client/errors.js";
import { buildClaimEntity, buildEvidenceEntity, sendJson, startServer, type TestServer } from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("fetchEvidenceEntityV1", () => {
  it("returns a typed validated evidence entity", async () => {
    server = await startServer((_req, res) => sendJson(res, 200, buildEvidenceEntity("report")));
    const result = await fetchEvidenceEntityV1(`${server.baseUrl}/entities/evidence/report.json`, PERMISSIVE);
    expect(result.kind).toBe("evidence");
    expect(result.entity.id).toBe("evidence:report");
  });

  it("returns a typed validated claim entity", async () => {
    server = await startServer((_req, res) =>
      sendJson(res, 200, buildClaimEntity("uptime", [{ id: "evidence:report", url: "https://example.com/ai/v1.0/entities/evidence/report.json" }]))
    );
    const result = await fetchEvidenceEntityV1(`${server.baseUrl}/entities/claim/uptime.json`, PERMISSIVE);
    expect(result.kind).toBe("claim");
  });

  it("throws a URL-carrying error when the entity is not a valid Evidence entity", async () => {
    server = await startServer((_req, res) =>
      sendJson(res, 200, buildEvidenceEntity("report", { x_evidence: { module: "aadp:evidence", version: "1.0", kind: "evidence" } }))
    );
    const url = `${server.baseUrl}/entities/evidence/report.json`;
    await expect(fetchEvidenceEntityV1(url, PERMISSIVE)).rejects.toBeInstanceOf(EvidenceEntityFetchValidationError);
    await expect(fetchEvidenceEntityV1(url, PERMISSIVE)).rejects.toMatchObject({ url });
  });

  it("does not fetch source.url or publisher.url", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/evidence/report.json") {
        return sendJson(
          res,
          200,
          buildEvidenceEntity(
            "report",
            {},
            {
              source: {
                title: "Orbit 2026 Status Report",
                url: "https://example.com/reports/2026-status",
                publisher: { name: "Example Orbit", url: "https://example.com" },
                access: "public",
              },
            }
          )
        );
      }
      sendJson(res, 404, { error: "not_found" });
    });

    await fetchEvidenceEntityV1(`${server.baseUrl}/entities/evidence/report.json`, PERMISSIVE);

    expect(server.requestLog).toEqual(["/entities/evidence/report.json"]);
  });
});

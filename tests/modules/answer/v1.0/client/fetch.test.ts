import { afterEach, describe, expect, it } from "vitest";
import { fetchAnswerEntityV1 } from "../../../../../src/modules/answer/v1.0/client/fetch.js";
import { AnswerEntityFetchValidationError } from "../../../../../src/modules/answer/v1.0/client/errors.js";
import { createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import { startServer, sendJson, buildAnswerEntity, type TestServer } from "./server-helpers.js";

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("fetchAnswerEntityV1", () => {
  it("fetches, schema/checksum-validates the core entity, then parses it as Answer 1.0", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/answer/what-is-orbit.json") {
        return sendJson(res, 200, buildAnswerEntity("answer:what-is-orbit"));
      }
      sendJson(res, 404, {});
    });
    const result = await fetchAnswerEntityV1(`${server.baseUrl}/entities/answer/what-is-orbit.json`, PERMISSIVE);
    expect(result.entity.id).toBe("answer:what-is-orbit");
    expect(result.answer.question).toBe("What is Orbit?");
  });

  it("never treats a document failing the core envelope as validated", async () => {
    server = await startServer((_req, res) => {
      sendJson(res, 200, { not: "an entity" });
    });
    await expect(fetchAnswerEntityV1(`${server.baseUrl}/entities/answer/broken.json`, PERMISSIVE)).rejects.toThrow();
  });

  it("throws AnswerEntityFetchValidationError (carrying the url) when the core entity is valid but Answer entity-context validation fails", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/entities/answer/wrong-type.json") {
        return sendJson(res, 200, buildAnswerEntity("answer:wrong-type", {}, { type: "document" }));
      }
      sendJson(res, 404, {});
    });
    const url = `${server.baseUrl}/entities/answer/wrong-type.json`;
    await expect(fetchAnswerEntityV1(url, PERMISSIVE)).rejects.toThrow(AnswerEntityFetchValidationError);
    try {
      await fetchAnswerEntityV1(url, PERMISSIVE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AnswerEntityFetchValidationError);
      expect((err as AnswerEntityFetchValidationError).url).toBe(url);
    }
  });
});

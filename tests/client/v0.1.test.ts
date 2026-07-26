import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  discover,
  fetchSitemapIndex,
  fetchEntity,
  iterateSitemap,
  discoverAllEntities,
  AadpSchemaValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
  AadpDiscoveryBudgetExceededError,
  createPermissiveUrlPolicy,
  type ClientOptions,
} from "../../src/client/v0.1/index.js";
import { checksumOf } from "../../src/canonical-json/checksum.js";

/**
 * Regression coverage for the 2026-07-26 re-review finding: the v0.1
 * client's default export ran on the secure HTTP transport but still
 * type-cast a fetched response straight to `T` with no schema/checksum
 * validation and no traversal budget, unlike v1.0. `../../src/client/v0.1/index.ts`
 * now shares `fetchAndValidateDocument`/`DiscoveryBudget` with v1.0
 * (`../../src/client/validated-document.ts`, `../../src/client/discovery-budget.ts`).
 */

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(handler: Handler): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    handler(req, res, url);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(JSON.stringify(body));
}

const PERMISSIVE: ClientOptions = { urlPolicy: createPermissiveUrlPolicy() };

function buildManifest(host: string, overrides: Record<string, unknown> = {}) {
  return {
    aadp_version: "0.1",
    default_locale: "en",
    available_locales: ["en"],
    sitemap_index: `http://${host}/ai/v0.1/sitemap-index.json`,
    ...overrides,
  };
}

const ENTITY_DATA = { title: "Sample" };

function buildEntity(overrides: Record<string, unknown> = {}) {
  return {
    aadp_version: "0.1",
    id: "example:sample-1",
    type: "example",
    checksum: checksumOf(ENTITY_DATA),
    updated_at: "2026-07-25T08:00:00Z",
    data: ENTITY_DATA,
    ...overrides,
  };
}

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("v0.1 client — schema validation", () => {
  it("throws AadpSchemaValidationError for a manifest missing a required field", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        // Missing required "sitemap_index".
        return sendJson(res, 200, {
          aadp_version: "0.1",
          default_locale: "en",
          available_locales: ["en"],
        });
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(AadpSchemaValidationError);
  });
});

describe("v0.1 client — checksum and cross-document integrity", () => {
  it("throws AadpChecksumMismatchError when an entity's declared checksum does not match its data", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/ai/v0.1/entities/example/sample-1.json") {
        return sendJson(res, 200, buildEntity({ checksum: `sha256:${"0".repeat(64)}` }));
      }
      sendJson(res, 404, {});
    });

    await expect(
      fetchEntity(`${server.baseUrl}/ai/v0.1/entities/example/sample-1.json`, PERMISSIVE)
    ).rejects.toThrow(AadpChecksumMismatchError);
  });

  it("throws AadpIntegrityMismatchError when a fetched entity's id disagrees with its sitemap item", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v0.1/sitemap-index.json") {
        const sitemaps = [{ type: "example", url: `http://${host}/ai/v0.1/sitemaps/example.json`, count: 1 }];
        return sendJson(res, 200, {
          aadp_version: "0.1",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(sitemaps),
          sitemaps,
        });
      }
      if (url.pathname === "/ai/v0.1/sitemaps/example.json") {
        const items = [
          {
            id: "example:sample-1",
            url: `http://${host}/ai/v0.1/entities/example/sample-1.json`,
            updated_at: "2026-07-25T08:00:00Z",
            checksum: checksumOf(ENTITY_DATA),
          },
        ];
        return sendJson(res, 200, {
          aadp_version: "0.1",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
        });
      }
      if (url.pathname === "/ai/v0.1/entities/example/sample-1.json") {
        // Entity id disagrees with the sitemap item's id above.
        return sendJson(res, 200, buildEntity({ id: "example:different-id" }));
      }
      sendJson(res, 404, {});
    });

    await expect(
      (async () => {
        for await (const _e of discoverAllEntities(server.baseUrl, PERMISSIVE)) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpIntegrityMismatchError);
  });
});

describe("v0.1 client — traversal budgets", () => {
  it("iterateSitemap throws AadpDiscoveryBudgetExceededError against unbounded fresh cursors", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/ai/v0.1/sitemaps/example.json") {
        const items = [
          {
            id: "example:sample-1",
            url: `http://${req.headers.host}/ai/v0.1/entities/example/sample-1.json`,
            updated_at: "2026-07-25T08:00:00Z",
            checksum: checksumOf(ENTITY_DATA),
          },
        ];
        return sendJson(res, 200, {
          aadp_version: "0.1",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: `page-${Math.random()}` },
        });
      }
      sendJson(res, 404, {});
    });

    const sitemapUrl = `${server.baseUrl}/ai/v0.1/sitemaps/example.json`;
    await expect(
      (async () => {
        for await (const _item of iterateSitemap(sitemapUrl, { ...PERMISSIVE, maxPages: 3 })) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });

  it("discoverAllEntities throws AadpDiscoveryBudgetExceededError when maxEntities is exceeded", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v0.1/sitemap-index.json") {
        const sitemaps = [{ type: "example", url: `http://${host}/ai/v0.1/sitemaps/example.json`, count: 2 }];
        return sendJson(res, 200, {
          aadp_version: "0.1",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(sitemaps),
          sitemaps,
        });
      }
      if (url.pathname === "/ai/v0.1/sitemaps/example.json") {
        const items = ["sample-1", "sample-2"].map((id) => ({
          id: `example:${id}`,
          url: `http://${host}/ai/v0.1/entities/example/${id}.json`,
          updated_at: "2026-07-25T08:00:00Z",
          checksum: checksumOf(ENTITY_DATA),
        }));
        return sendJson(res, 200, {
          aadp_version: "0.1",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v0\.1\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        return sendJson(res, 200, buildEntity({ id: `example:${entityMatch[1]}` }));
      }
      sendJson(res, 404, {});
    });

    await expect(
      (async () => {
        for await (const _e of discoverAllEntities(server.baseUrl, { ...PERMISSIVE, maxEntities: 1 })) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });
});

describe("v0.1 client — v0.1-conformant documents still round-trip cleanly", () => {
  it("discover/fetchSitemapIndex accept a schema-valid, checksum-correct manifest and sitemap index", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v0.1/sitemap-index.json") {
        const sitemaps = [{ type: "example", url: `http://${host}/ai/v0.1/sitemaps/example.json`, count: 0 }];
        return sendJson(res, 200, {
          aadp_version: "0.1",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(sitemaps),
          sitemaps,
        });
      }
      sendJson(res, 404, {});
    });

    const manifest = await discover(server.baseUrl, PERMISSIVE);
    const index = await fetchSitemapIndex(manifest.sitemap_index, PERMISSIVE);
    expect(index.sitemaps).toHaveLength(1);
  });
});

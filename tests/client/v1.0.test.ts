import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  discover,
  fetchSitemapIndex,
  fetchSitemap,
  fetchEntity,
  iterateSitemap,
  discoverAllEntities,
  AadpSchemaValidationError,
  AadpSemanticValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
  AadpDiscoveryBudgetExceededError,
  UnsupportedAadpVersionError,
  BlockedUrlError,
  TimeoutError,
  AbortedError,
  TooManyRedirectsError,
  ResponseTooLargeError,
  InvalidContentTypeError,
  MalformedJsonError,
  InvalidOptionError,
  createPermissiveUrlPolicy,
  AadpRequestError,
  type ClientOptions,
} from "../../src/client/v1.0/index.js";
import { checksumOf } from "../../src/canonical-json/checksum.js";
import { createDiscoveryBudget } from "../../src/client/discovery-budget.js";
import { setOnRetryBackoffTimerArmedForTests } from "../../src/client/http.js";

/**
 * Phase-4 reference-client tests: acceptance criteria from
 * `docs/records/implementation-record-v1.0.md` §"Phase 4" — unsupported version,
 * malformed JSON/content type, redirect loop, oversized response,
 * timeout, private-network blocked in strict mode, cursor cycle, and
 * invalid documents never being used to continue traversal.
 *
 * All servers here bind to 127.0.0.1, which the default strict
 * `UrlPolicy` blocks as a loopback address — every test except the
 * dedicated "private network" one below opts into
 * `createPermissiveUrlPolicy()` to reach its own local fixture server,
 * exactly like a caller intentionally pointing this client at a trusted
 * local/offline deployment would (see `url-policy.ts` docstring).
 */

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

interface TestServer {
  baseUrl: string;
  requestLog: string[];
  close: () => Promise<void>;
}

async function startServer(handler: Handler): Promise<TestServer> {
  const requestLog: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requestLog.push(url.pathname);
    handler(req, res, url);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestLog,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, contentType = "application/json") {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": contentType });
  res.end(json);
}

const ENTITIES = [
  { id: "example:sample-1", data: { title: "Sample One" }, updatedAt: "2026-07-25T08:00:00Z" },
  { id: "example:sample-2", data: { title: "Sample Two" }, updatedAt: "2026-07-25T09:00:00Z" },
];

function entityChecksum(item: (typeof ENTITIES)[number]): string {
  return checksumOf(item.data);
}

function buildManifest(host: string, overrides: Record<string, unknown> = {}) {
  return {
    aadp_version: "1.0",
    application: {
      name: "Test App",
      description: "A test AADP v1.0 application.",
      publisher: { name: "Test Publisher", url: `http://${host}` },
    },
    discovery: { sitemap_index: `http://${host}/ai/v1.0/sitemap-index.json` },
    policies: { robots: `http://${host}/robots.txt`, terms: `http://${host}/terms` },
    ...overrides,
  };
}

function buildSitemapIndex(host: string, sitemaps?: unknown[]) {
  const resolved = sitemaps ?? [
    { type: "example", url: `http://${host}/ai/v1.0/sitemaps/example.json`, count: ENTITIES.length },
  ];
  return {
    aadp_version: "1.0",
    generated_at: "2026-07-25T09:30:00Z",
    checksum: checksumOf(resolved),
    sitemaps: resolved,
  };
}

function buildSitemapItem(host: string, item: (typeof ENTITIES)[number]) {
  const [type, localId] = item.id.split(":");
  return {
    id: item.id,
    url: `http://${host}/ai/v1.0/entities/${type}/${localId}.json`,
    updated_at: item.updatedAt,
    checksum: entityChecksum(item),
  };
}

function buildEntity(host: string, item: (typeof ENTITIES)[number]) {
  const [type] = item.id.split(":");
  return {
    aadp_version: "1.0",
    id: item.id,
    type,
    checksum: entityChecksum(item),
    updated_at: item.updatedAt,
    data: item.data,
  };
}

const PERMISSIVE: ClientOptions = { urlPolicy: createPermissiveUrlPolicy() };

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("discoverAllEntities — happy path", () => {
  it("walks manifest -> sitemap index -> sitemap -> every entity", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(host));
      }
      if (url.pathname === "/ai/v1.0/sitemap-index.json") {
        return sendJson(res, 200, buildSitemapIndex(host));
      }
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        const item = ENTITIES.find((e) => e.id === `example:${entityMatch[1]}`)!;
        return sendJson(res, 200, buildEntity(host, item));
      }
      sendJson(res, 404, { error: { code: "not_found", message: "no route", request_id: "req_1" } });
    });

    const entities = [];
    for await (const entity of discoverAllEntities(server.baseUrl, PERMISSIVE)) {
      entities.push(entity);
    }
    expect(entities.map((e) => e.id)).toEqual(["example:sample-1", "example:sample-2"]);
  });

  it("with concurrency > 1, still yields entities in sitemap order even when a later one answers first", async () => {
    const items = [
      { id: "example:c1", data: { n: 1 }, updatedAt: "2026-07-25T08:00:00Z", delayMs: 40 },
      { id: "example:c2", data: { n: 2 }, updatedAt: "2026-07-25T08:00:01Z", delayMs: 5 },
      { id: "example:c3", data: { n: 3 }, updatedAt: "2026-07-25T08:00:02Z", delayMs: 5 },
    ];
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const sitemapItems = items.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(sitemapItems),
          items: sitemapItems,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        const item = items.find((e) => e.id === `example:${entityMatch[1]}`)!;
        // Slower first item, faster later items: proves output order
        // comes from the sitemap, not completion order.
        setTimeout(() => sendJson(res, 200, buildEntity(host, item)), item.delayMs);
        return;
      }
      sendJson(res, 404, { error: { code: "not_found", message: "no route", request_id: "req_1" } });
    });

    const entities = [];
    for await (const entity of discoverAllEntities(server.baseUrl, { ...PERMISSIVE, concurrency: 3 })) {
      entities.push(entity);
    }
    expect(entities.map((e) => e.id)).toEqual(["example:c1", "example:c2", "example:c3"]);
  });
});

describe("unsupported version", () => {
  it("throws UnsupportedAadpVersionError when the manifest declares a different aadp_version", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, { ...buildManifest(req.headers.host!), aadp_version: "0.1" });
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(UnsupportedAadpVersionError);
  });
});

describe("malformed JSON / content type", () => {
  it("throws MalformedJsonError for a body that is not valid JSON", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{ this is not json");
        return;
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(MalformedJsonError);
  });

  it("throws InvalidContentTypeError for a non-JSON content type", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!), "text/html");
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(InvalidContentTypeError);
  });
});

describe("redirect handling", () => {
  it("throws TooManyRedirectsError on a redirect loop", async () => {
    server = await startServer((_req, res) => {
      res.writeHead(302, { Location: "/.well-known/ai-manifest.json" });
      res.end();
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(TooManyRedirectsError);
  });

  it("strips Authorization on a same-origin -> cross-origin 3xx redirect hop, but keeps it same-origin", async () => {
    let targetReceivedAuth: string | undefined;
    const target = await startServer((req, res, url) => {
      targetReceivedAuth = req.headers.authorization;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    let originReceivedAuth: string | undefined;
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        originReceivedAuth = req.headers.authorization;
        res.writeHead(302, { Location: `${target.baseUrl}/.well-known/ai-manifest.json` });
        return res.end();
      }
      sendJson(res, 404, {});
    });

    try {
      await discover(server.baseUrl, { ...PERMISSIVE, headers: { Authorization: "Bearer secret" } });
      expect(originReceivedAuth).toBe("Bearer secret");
      expect(targetReceivedAuth).toBeUndefined();
    } finally {
      await target.close();
    }
  });

  it("keeps Authorization across a same-origin 3xx redirect hop", async () => {
    let finalReceivedAuth: string | undefined;
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        res.writeHead(302, { Location: "/redirected-manifest.json" });
        return res.end();
      }
      if (url.pathname === "/redirected-manifest.json") {
        finalReceivedAuth = req.headers.authorization;
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    await discover(server.baseUrl, { ...PERMISSIVE, headers: { Authorization: "Bearer secret" } });
    expect(finalReceivedAuth).toBe("Bearer secret");
  });
});

describe("oversized response", () => {
  it("throws ResponseTooLargeError when the body exceeds maxResponseBytes", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!, { x_padding: "a".repeat(10_000) }));
      }
      sendJson(res, 404, {});
    });

    await expect(
      discover(server.baseUrl, { ...PERMISSIVE, maxResponseBytes: 100 })
    ).rejects.toThrow(ResponseTooLargeError);
  });
});

describe("invalid numeric options", () => {
  it("throws InvalidOptionError for a non-finite timeoutMs before making any request", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, timeoutMs: Number.NaN })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a negative maxRedirects", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, maxRedirects: -1 })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a zero maxResponseBytes", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, maxResponseBytes: 0 })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a non-integer timeoutMs", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, timeoutMs: 1.5 })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a non-integer maxRedirects", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, maxRedirects: 1.5 })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a non-integer maxResponseBytes", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, maxResponseBytes: 10.5 })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for an invalid retry.maxAttempts before making any request", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, retry: { maxAttempts: 0 } })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a non-integer retry.baseDelayMs", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, retry: { baseDelayMs: 1.5 } })
    ).rejects.toThrow(InvalidOptionError);
  });

  it("throws InvalidOptionError for a negative retry.maxDelayMs", async () => {
    await expect(
      discover("https://example.com", { ...PERMISSIVE, retry: { maxDelayMs: -1 } })
    ).rejects.toThrow(InvalidOptionError);
  });
});

describe("timeout", () => {
  it("throws TimeoutError when the server does not respond in time", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        setTimeout(() => sendJson(res, 200, {}), 200);
        return;
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, { ...PERMISSIVE, timeoutMs: 20 })).rejects.toThrow(
      TimeoutError
    );
  });
});

describe("cancellation (options.signal)", () => {
  it("rejects with AbortedError, not TimeoutError, when the caller's signal fires mid-request", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        setTimeout(() => sendJson(res, 200, {}), 5_000);
        return;
      }
      sendJson(res, 404, {});
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort("caller gave up"), 20);

    await expect(discover(server.baseUrl, { ...PERMISSIVE, signal: controller.signal })).rejects.toThrow(
      AbortedError
    );
  });

  it("rejects immediately when the signal is already aborted before the first request", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    const controller = new AbortController();
    controller.abort();

    await expect(discover(server.baseUrl, { ...PERMISSIVE, signal: controller.signal })).rejects.toThrow(
      AbortedError
    );
    expect(server.requestLog).toEqual([]);
  });

  it("stops discoverAllEntities from issuing further requests once aborted mid-traversal", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((e) => buildSitemapItem(host, e));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
        });
      }
      if (url.pathname.startsWith("/ai/v1.0/entities/")) {
        const item = ENTITIES.find((e) => url.pathname.endsWith(`${e.id.split(":")[1]}.json`));
        if (item) return sendJson(res, 200, buildEntity(host, item));
      }
      sendJson(res, 404, {});
    });

    const controller = new AbortController();
    const seen: string[] = [];
    // Aborts right after the first entity is yielded (not from inside the
    // server handler, which would race the in-flight response for that
    // same first entity) — the second entity must never be requested.
    await expect(async () => {
      for await (const entity of discoverAllEntities(server!.baseUrl, { ...PERMISSIVE, signal: controller.signal })) {
        seen.push(entity.id);
        controller.abort();
      }
    }).rejects.toThrow(AbortedError);

    expect(seen).toEqual([ENTITIES[0].id]);
    expect(server.requestLog.filter((p) => p.startsWith("/ai/v1.0/entities/"))).toHaveLength(1);
  });
});

function errorEnvelope(code: string, message: string) {
  return { error: { code, message, request_id: "req_retry_test" } };
}

describe("retry (options.retry)", () => {
  it("does not retry anything when retry is omitted (default, matches every release before 1.1.0)", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
      }
      sendJson(res, 404, {});
    });

    const err = await discover(server.baseUrl, PERMISSIVE).catch((e) => e);
    expect(err).toBeInstanceOf(AadpRequestError);
    expect((err as AadpRequestError).status).toBe(503);
    expect(attempts).toBe(1);
  });

  it("retries a 503 up to maxAttempts and succeeds once the server recovers", async () => {
    let attempts = 0;
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        if (attempts < 3) {
          return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
        }
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    const manifest = await discover(server.baseUrl, {
      ...PERMISSIVE,
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    });
    expect(manifest.aadp_version).toBe("1.0");
    expect(attempts).toBe(3);
  });

  it("gives up after maxAttempts and surfaces the last response", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 429, errorEnvelope("rate_limited", "too many requests"));
      }
      sendJson(res, 404, {});
    });

    const err = await discover(server.baseUrl, {
      ...PERMISSIVE,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AadpRequestError);
    expect((err as AadpRequestError).status).toBe(429);
    expect(attempts).toBe(3);
  });

  it("never retries a non-retryable 4xx", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 400, errorEnvelope("invalid_request", "bad request"));
      }
      sendJson(res, 404, {});
    });

    const err = await discover(server.baseUrl, {
      ...PERMISSIVE,
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AadpRequestError);
    expect((err as AadpRequestError).status).toBe(400);
    expect(attempts).toBe(1);
  });

  it("never retries a blocked private-network URL", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(req.headers.host!));
      sendJson(res, 404, {});
    });

    // No urlPolicy override: strict default blocks this loopback origin.
    await expect(
      discover(server.baseUrl, { retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 } })
    ).rejects.toThrow(BlockedUrlError);
    expect(server.requestLog).toEqual([]);
  });

  it("honors a numeric Retry-After header, capped at maxDelayMs", async () => {
    let attempts = 0;
    const timestamps: number[] = [];
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        timestamps.push(Date.now());
        if (attempts === 1) {
          res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "10" });
          return res.end(JSON.stringify(errorEnvelope("upstream_unavailable", "busy")));
        }
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    await discover(server.baseUrl, {
      ...PERMISSIVE,
      // maxDelayMs (50ms) caps the 10-second Retry-After down to something
      // this test can actually wait out.
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 50 },
    });
    expect(attempts).toBe(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(45);
  });

  it("stops retrying immediately when the caller's signal aborts during backoff", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
      }
      sendJson(res, 404, {});
    });

    // Synchronize on the retry backoff `setTimeout` actually being armed
    // (production-code instrumentation, test-only — see
    // `setOnRetryBackoffTimerArmedForTests` in `src/client/http.ts`),
    // not on a fixed wall-clock delay or on "the server responded to
    // attempt 1": either of those can race ahead of or behind the point
    // where the pending backoff timer itself becomes abort-cancellable,
    // so aborting there wouldn't actually exercise "abort cancels the
    // pending retry timer" — it could just as well be aborting during the
    // in-flight fetch/body-drain instead, and the two assertions below
    // would pass either way, hiding a regression in `sleepRespectingAbort`.
    let resolveBackoffArmed: () => void;
    const backoffArmed = new Promise<void>((resolve) => {
      resolveBackoffArmed = resolve;
    });
    setOnRetryBackoffTimerArmedForTests(() => resolveBackoffArmed());

    const controller = new AbortController();
    backoffArmed.then(() => controller.abort("giving up"));

    const startedAt = Date.now();
    try {
      await expect(
        discover(server.baseUrl, {
          ...PERMISSIVE,
          signal: controller.signal,
          retry: { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 1000 },
        })
      ).rejects.toThrow(AbortedError);
      expect(attempts).toBe(1);
      // The decisive assertion: if `sleepRespectingAbort`'s own abort
      // listener were missing/broken, the pending `setTimeout(..., 1000)`
      // would still (eventually) resolve, `continue attempts` back to the
      // top of the hop loop, and get caught there by the loop's own
      // `callerAborted()` check instead — same final error type and
      // `attempts` count as above, but only after the full 1000ms backoff
      // elapsed. Bounding elapsed time well under that proves the abort
      // actually cut the pending timer short rather than being caught
      // late by that fallback path.
      expect(Date.now() - startedAt).toBeLessThan(500);
    } finally {
      setOnRetryBackoffTimerArmedForTests(undefined);
    }
  });

  it("throws AadpDiscoveryBudgetExceededError instead of sleeping once a retry's backoff would exceed the shared deadline", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
      }
      sendJson(res, 404, {});
    });

    // deadlineMs (20ms) is far smaller than the backoff a real attempt 2
    // would need to wait (baseDelayMs 5000) — the retry must never sleep
    // for it, let alone send a second request.
    const budget = createDiscoveryBudget({ deadlineMs: 20 });
    await expect(
      discover(
        server.baseUrl,
        { ...PERMISSIVE, retry: { maxAttempts: 10, baseDelayMs: 5000, maxDelayMs: 5000 } },
        budget
      )
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
    expect(attempts).toBe(1);
  });

  it("throws AadpDiscoveryBudgetExceededError instead of retrying once the deadline has already passed", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        return sendJson(res, 503, errorEnvelope("upstream_unavailable", "busy"));
      }
      sendJson(res, 404, {});
    });

    const budget = createDiscoveryBudget({ deadlineMs: 5000 });
    // Simulate the deadline already having elapsed (e.g. spent by earlier
    // requests in the same traversal) without a slow real-time test.
    (budget as { startedAt: number }).startedAt = Date.now() - 10_000;

    await expect(
      discover(server.baseUrl, { ...PERMISSIVE, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }, budget)
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
    expect(attempts).toBe(0);
  });

  it("honoring a Retry-After that alone would exceed the deadline also throws instead of sleeping", async () => {
    let attempts = 0;
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        attempts++;
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "30" });
        return res.end(JSON.stringify(errorEnvelope("upstream_unavailable", "busy")));
      }
      sendJson(res, 404, {});
    });

    // Retry-After asks for 30s, capped at maxDelayMs (20s) — still far more
    // than the 20ms deadline below.
    const budget = createDiscoveryBudget({ deadlineMs: 20 });
    await expect(
      discover(
        server.baseUrl,
        { ...PERMISSIVE, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 20_000 } },
        budget
      )
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
    expect(attempts).toBe(1);
  });
});

describe("private-network URL policy", () => {
  it("blocks a loopback origin by default (strict mode)", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    // No urlPolicy override: the default strict policy applies.
    await expect(discover(server.baseUrl)).rejects.toThrow(BlockedUrlError);
  });

  it("allows the same loopback origin once an explicit permissive policy is supplied", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(req.headers.host!));
      }
      sendJson(res, 404, {});
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).resolves.toMatchObject({
      aadp_version: "1.0",
    });
  });
});

describe("cursor cycle detection", () => {
  it("throws when a sitemap page's cursor.next repeats a previously seen cursor", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const cursor = url.searchParams.get("cursor");
        const items = [buildSitemapItem(req.headers.host!, ENTITIES[0])];
        // Every page (regardless of the cursor supplied) points to the
        // same "next" token, forcing an infinite loop if undetected.
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: cursor === "page-2" ? "page-2" : "page-2" },
        });
      }
      sendJson(res, 404, {});
    });

    const sitemapUrl = `${server.baseUrl}/ai/v1.0/sitemaps/example.json`;
    async function drain() {
      for await (const _item of iterateSitemap(sitemapUrl, PERMISSIVE)) {
        // consume
      }
    }
    await expect(drain()).rejects.toThrow(/Cursor cycle detected/);
  });
});

describe("invalid documents never extend traversal", () => {
  it("a schema-invalid sitemap index is rejected and its sitemaps are never fetched", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(res, 200, buildManifest(host));
      }
      if (url.pathname === "/ai/v1.0/sitemap-index.json") {
        // Missing required "checksum" -> schema-invalid.
        return sendJson(res, 200, {
          aadp_version: "1.0",
          generated_at: "2026-07-25T09:30:00Z",
          sitemaps: [{ type: "example", url: `http://${host}/ai/v1.0/sitemaps/example.json` }],
        });
      }
      sendJson(res, 200, { unexpected: "should never be requested" });
    });

    await expect(
      (async () => {
        for await (const _e of discoverAllEntities(server.baseUrl, PERMISSIVE)) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpSchemaValidationError);

    expect(server.requestLog).not.toContain("/ai/v1.0/sitemaps/example.json");
  });

  it("a semantically-invalid manifest is rejected and the sitemap index is never fetched", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") {
        // Schema-valid, but two modules share the same id -> semantic error.
        return sendJson(
          res,
          200,
          buildManifest(host, {
            modules: [
              { id: "aadp:relations", version: "0.1", schema: `http://${host}/schemas/a.json` },
              { id: "aadp:relations", version: "0.2", schema: `http://${host}/schemas/b.json` },
            ],
          })
        );
      }
      sendJson(res, 200, { unexpected: "should never be requested" });
    });

    await expect(discover(server.baseUrl, PERMISSIVE)).rejects.toThrow(AadpSemanticValidationError);
    expect(server.requestLog).not.toContain("/ai/v1.0/sitemap-index.json");
  });
});

describe("fetchSitemapIndex / fetchSitemap / fetchEntity individually validate", () => {
  it("fetchEntity rejects a document declaring the wrong aadp_version", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/ai/v1.0/entities/example/sample-1.json") {
        return sendJson(res, 200, { ...buildEntity("host", ENTITIES[0]), aadp_version: "0.1" });
      }
      sendJson(res, 404, {});
    });

    await expect(
      fetchEntity(`${server.baseUrl}/ai/v1.0/entities/example/sample-1.json`, PERMISSIVE)
    ).rejects.toThrow(UnsupportedAadpVersionError);
  });

  it("fetchSitemapIndex and fetchSitemap round-trip valid documents", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/ai/v1.0/sitemap-index.json") {
        return sendJson(res, 200, buildSitemapIndex(host));
      }
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      sendJson(res, 404, {});
    });

    const index = await fetchSitemapIndex(`${server.baseUrl}/ai/v1.0/sitemap-index.json`, PERMISSIVE);
    expect(index.sitemaps).toHaveLength(1);
    const sitemap = await fetchSitemap(index.sitemaps[0].url, null, PERMISSIVE);
    expect(sitemap.items.map((i) => i.id)).toEqual(["example:sample-1", "example:sample-2"]);
  });
});

describe("timeout covers body streaming, not just headers", () => {
  it("throws TimeoutError when headers arrive promptly but the body stalls past the deadline", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"aadp_versio'); // headers + partial body sent immediately
        setTimeout(() => res.end('n":"1.0"}'), 100); // rest arrives late
        return;
      }
      sendJson(res, 404, {});
    });

    await expect(
      discover(server.baseUrl, { ...PERMISSIVE, timeoutMs: 20 })
    ).rejects.toThrow(TimeoutError);
  });
});

describe("cross-document integrity", () => {
  it("throws AadpChecksumMismatchError when a sitemap-index's declared checksum does not match its sitemaps", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/ai/v1.0/sitemap-index.json") {
        return sendJson(res, 200, {
          aadp_version: "1.0",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: `sha256:${"0".repeat(64)}`,
          sitemaps: [{ type: "example", url: `http://${host}/ai/v1.0/sitemaps/example.json`, count: 1 }],
        });
      }
      sendJson(res, 404, {});
    });

    await expect(
      fetchSitemapIndex(`${server.baseUrl}/ai/v1.0/sitemap-index.json`, PERMISSIVE)
    ).rejects.toThrow(AadpChecksumMismatchError);
  });

  it("throws AadpChecksumMismatchError when an entity's declared checksum does not match its data", async () => {
    server = await startServer((_req, res, url) => {
      if (url.pathname === "/ai/v1.0/entities/example/sample-1.json") {
        return sendJson(res, 200, {
          ...buildEntity("host", ENTITIES[0]),
          checksum: `sha256:${"0".repeat(64)}`,
        });
      }
      sendJson(res, 404, {});
    });

    await expect(
      fetchEntity(`${server.baseUrl}/ai/v1.0/entities/example/sample-1.json`, PERMISSIVE)
    ).rejects.toThrow(AadpChecksumMismatchError);
  });

  it("throws AadpIntegrityMismatchError when a sitemap's declared type disagrees with the index entry", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "not-example", // disagrees with the index entry's declared type "example"
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
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

  it("throws AadpIntegrityMismatchError when a fetched entity's id disagrees with its sitemap item", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        // Always serve sample-1's entity, regardless of which item id was requested.
        return sendJson(res, 200, buildEntity(host, ENTITIES[0]));
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

describe("maxTotalBytes stops streaming mid-response, not after the full body is buffered", () => {
  it("aborts the body read before the server finishes writing every chunk", async () => {
    const CHUNK = "x".repeat(1024); // 1 KiB
    const TOTAL_CHUNKS = 50; // 50 KiB total — comfortably under maxResponseBytes (2 MiB default)
    let chunksWritten = 0;
    let clientDisconnectedEarly = false;

    server = await startServer((req, res, url) => {
      if (url.pathname !== "/.well-known/ai-manifest.json") {
        sendJson(res, 404, {});
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      // Leading bytes make it a syntactically-plausible (if oversized)
      // JSON string value so a truncated read fails on the *budget*, not
      // on JSON.parse first.
      res.write('{"padding":"');
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer);
          return;
        }
        if (chunksWritten >= TOTAL_CHUNKS) {
          clearInterval(timer);
          res.end('"}');
          return;
        }
        res.write(CHUNK);
        chunksWritten++;
      }, 2);
      res.on("close", () => {
        clearInterval(timer);
        if (chunksWritten < TOTAL_CHUNKS) clientDisconnectedEarly = true;
      });
    });

    const budget = createDiscoveryBudget({ maxTotalBytes: 4 * 1024 }); // 4 KiB — far less than the 50 KiB body
    await expect(
      discover(server.baseUrl, { ...PERMISSIVE, maxResponseBytes: 10 * 1024 * 1024 }, budget)
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);

    // Give the server's 'close' listener a moment to fire after the client
    // cancels the reader.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(clientDisconnectedEarly).toBe(true);
    expect(chunksWritten).toBeLessThan(TOTAL_CHUNKS);
  });
});

describe("discovery traversal budgets", () => {
  it("throws AadpDiscoveryBudgetExceededError when the walk yields more entities than maxEntities", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        const item = ENTITIES.find((e) => e.id === `example:${entityMatch[1]}`)!;
        return sendJson(res, 200, buildEntity(host, item));
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

  it("throws AadpDiscoveryBudgetExceededError once the whole walk's response bytes exceed maxTotalBytes", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        const item = ENTITIES.find((e) => e.id === `example:${entityMatch[1]}`)!;
        return sendJson(res, 200, buildEntity(host, item));
      }
      sendJson(res, 404, {});
    });

    // Small enough that the manifest + sitemap-index + sitemap responses
    // alone exceed it, well before any entity is fetched.
    await expect(
      (async () => {
        for await (const _e of discoverAllEntities(server.baseUrl, { ...PERMISSIVE, maxTotalBytes: 10 })) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });

  it("does not enforce any total-byte cap when maxTotalBytes is omitted (default, matches every release before 1.1.0)", async () => {
    server = await startServer((req, res, url) => {
      const host = req.headers.host!;
      if (url.pathname === "/.well-known/ai-manifest.json") return sendJson(res, 200, buildManifest(host));
      if (url.pathname === "/ai/v1.0/sitemap-index.json") return sendJson(res, 200, buildSitemapIndex(host));
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = ENTITIES.map((item) => buildSitemapItem(host, item));
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: null },
        });
      }
      const entityMatch = url.pathname.match(/^\/ai\/v1\.0\/entities\/example\/(.+)\.json$/);
      if (entityMatch) {
        const item = ENTITIES.find((e) => e.id === `example:${entityMatch[1]}`)!;
        return sendJson(res, 200, buildEntity(host, item));
      }
      sendJson(res, 404, {});
    });

    const entities = [];
    for await (const entity of discoverAllEntities(server.baseUrl, PERMISSIVE)) {
      entities.push(entity);
    }
    expect(entities.map((e) => e.id)).toEqual(["example:sample-1", "example:sample-2"]);
  });
});

describe("header origin scoping", () => {
  it("sends Authorization to originBaseUrl's own origin but strips it for a sitemap URL on a different origin", async () => {
    let sitemapServerReceivedAuth: string | undefined;
    const sitemapServer = await startServer((req, res) => {
      sitemapServerReceivedAuth = req.headers.authorization;
      sendJson(res, 404, {}); // any response is fine — the test only inspects the request header
    });

    let manifestServerReceivedAuth: string | undefined;
    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        manifestServerReceivedAuth = req.headers.authorization;
        return sendJson(
          res,
          200,
          buildManifest(req.headers.host!, {
            discovery: { sitemap_index: `${sitemapServer.baseUrl}/ai/v1.0/sitemap-index.json` },
          })
        );
      }
      sendJson(res, 404, {});
    });

    try {
      await expect(
        (async () => {
          for await (const _e of discoverAllEntities(server.baseUrl, {
            ...PERMISSIVE,
            headers: { Authorization: "Bearer secret" },
          })) {
            // consume until the (expected) sitemap-index schema-validation failure
          }
        })()
      ).rejects.toThrow();

      expect(manifestServerReceivedAuth).toBe("Bearer secret");
      expect(sitemapServerReceivedAuth).toBeUndefined();
    } finally {
      await sitemapServer.close();
    }
  });

  it("strips a custom header (e.g. X-API-Key) cross-origin by default, but keeps it when allow-listed", async () => {
    let sitemapServerReceivedApiKey: string | undefined;
    const sitemapServer = await startServer((req, res) => {
      sitemapServerReceivedApiKey = req.headers["x-api-key"] as string | undefined;
      sendJson(res, 404, {});
    });

    server = await startServer((req, res, url) => {
      if (url.pathname === "/.well-known/ai-manifest.json") {
        return sendJson(
          res,
          200,
          buildManifest(req.headers.host!, {
            discovery: { sitemap_index: `${sitemapServer.baseUrl}/ai/v1.0/sitemap-index.json` },
          })
        );
      }
      sendJson(res, 404, {});
    });

    try {
      // Default: no crossOriginSafeHeaders allow-list -> stripped, same as Authorization.
      await expect(
        (async () => {
          for await (const _e of discoverAllEntities(server.baseUrl, {
            ...PERMISSIVE,
            headers: { "X-API-Key": "secret" },
          })) {
            // consume until the (expected) sitemap-index schema-validation failure
          }
        })()
      ).rejects.toThrow();
      expect(sitemapServerReceivedApiKey).toBeUndefined();

      // Explicit opt-in -> forwarded cross-origin.
      await expect(
        (async () => {
          for await (const _e of discoverAllEntities(server.baseUrl, {
            ...PERMISSIVE,
            headers: { "X-API-Key": "secret" },
            crossOriginSafeHeaders: ["X-API-Key"],
          })) {
            // consume until the (expected) sitemap-index schema-validation failure
          }
        })()
      ).rejects.toThrow();
      expect(sitemapServerReceivedApiKey).toBe("secret");
    } finally {
      await sitemapServer.close();
    }
  });
});

describe("iterateSitemap — standalone traversal budget", () => {
  it("throws AadpDiscoveryBudgetExceededError when called directly against a server with unbounded fresh cursors", async () => {
    server = await startServer((req, res, url) => {
      if (url.pathname === "/ai/v1.0/sitemaps/example.json") {
        const items = [buildSitemapItem(req.headers.host!, ENTITIES[0])];
        // Every page gets a brand-new cursor token, so cycle detection
        // (which only catches a *repeated* cursor) never triggers.
        return sendJson(res, 200, {
          aadp_version: "1.0",
          type: "example",
          generated_at: "2026-07-25T09:30:00Z",
          checksum: checksumOf(items),
          items,
          cursor: { next: `page-${Math.random()}` },
        });
      }
      sendJson(res, 404, {});
    });

    const sitemapUrl = `${server.baseUrl}/ai/v1.0/sitemaps/example.json`;
    await expect(
      (async () => {
        for await (const _item of iterateSitemap(sitemapUrl, { ...PERMISSIVE, maxPages: 3 })) {
          // consume
        }
      })()
    ).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });
});

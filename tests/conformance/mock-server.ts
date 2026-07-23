import { createServer, type Server } from "node:http";
import { checksumOf } from "../../src/canonical-json/checksum.js";

/**
 * Minimal AADP v0.1 reference/mock server. Serves only fixtures generated
 * in-memory here — it does not read from or depend on Ailmao in any way,
 * per Phase A2 ("mock/reference server chỉ dùng fixtures AADP").
 */

const PAGE_SIZE = 2;

interface Item {
  id: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

const ITEMS: Item[] = Array.from({ length: 5 }, (_, i) => ({
  id: `example:item-${i + 1}`,
  updatedAt: `2026-07-2${i}T08:00:00Z`,
  data: { title: `Item ${i + 1}`, index: i + 1 },
}));

// A second resource type, deliberately small enough (<=100) to be served
// as a single unpaginated page with no `cursor` field at all — this is
// spec-legal (§5: sitemaps MAY be paginated) and MUST be accepted by the
// conformance suite, not just the multi-page "example" type above.
const NOTE_ITEMS: Item[] = Array.from({ length: 3 }, (_, i) => ({
  id: `note:memo-${i + 1}`,
  updatedAt: `2026-07-1${i}T08:00:00Z`,
  data: { body: `Memo ${i + 1}` },
}));

function entityChecksum(item: Item): string {
  return checksumOf(item.data);
}

function encodeCursor(page: number): string {
  return Buffer.from(JSON.stringify({ type: "example", page, version: "0.1" })).toString(
    "base64url"
  );
}

function decodeCursor(cursor: string): { page: number } {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  return { page: parsed.page };
}

export interface MockServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startMockServer(): Promise<MockServerHandle> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
      const json = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json",
        ...extraHeaders,
      });
      res.end(json);
    };
    const sendError = (
      status: number,
      code: string,
      message: string
    ) => {
      send(status, {
        error: { code, message, request_id: `req_${Math.random().toString(36).slice(2, 10)}` },
      });
    };

    const respondCacheable = (
      status: number,
      body: unknown,
      checksum: string,
      updatedAt: string
    ) => {
      const etag = `"${checksum}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      // RFC 9110 §8.8.3.2 weak comparison — spec §7 requires this so a
      // client echoing a compressing intermediary's weakened ETag (see
      // ADR-0002) still gets a 304.
      const hits =
        typeof ifNoneMatch === "string" &&
        (ifNoneMatch.trim() === "*" ||
          (ifNoneMatch.startsWith("W/") ? ifNoneMatch.slice(2) : ifNoneMatch) === etag);
      if (hits) {
        res.writeHead(304, {
          ETag: etag,
          "Last-Modified": new Date(updatedAt).toUTCString(),
        });
        res.end();
        return;
      }
      send(status, body, {
        ETag: etag,
        "Last-Modified": new Date(updatedAt).toUTCString(),
        "Cache-Control": "max-age=300",
      });
    };

    if (url.pathname === "/.well-known/ai-manifest.json") {
      const manifest = {
        aidp_version: "0.1",
        default_locale: "en",
        available_locales: ["en"],
        sitemap_index: `http://${req.headers.host}/ai/v0.1/sitemap-index.json`,
        entity_base: `http://${req.headers.host}/ai/v0.1/entities`,
        capabilities: [],
      };
      send(200, manifest);
      return;
    }

    if (url.pathname === "/ai/v0.1/sitemap-index.json") {
      const generatedAt = "2026-07-22T00:00:00Z";
      const sitemaps = [
        {
          type: "example",
          url: `http://${req.headers.host}/ai/v0.1/sitemaps/example.json`,
          count: ITEMS.length,
        },
        {
          type: "note",
          url: `http://${req.headers.host}/ai/v0.1/sitemaps/note.json`,
          count: NOTE_ITEMS.length,
        },
      ];
      const checksum = checksumOf(sitemaps);
      respondCacheable(
        200,
        { aidp_version: "0.1", generated_at: generatedAt, checksum, sitemaps },
        checksum,
        generatedAt
      );
      return;
    }

    const sitemapMatch = url.pathname.match(/^\/ai\/v0\.1\/sitemaps\/([a-z0-9_-]+)\.json$/);
    if (sitemapMatch) {
      const type = sitemapMatch[1];
      const generatedAt = "2026-07-22T00:00:00Z";

      if (type === "note") {
        // Deliberately unpaginated: no `cursor` field at all, proving
        // that's spec-legal (§5) and MUST be accepted by conformant
        // clients/suites, not just the paginated "example" type below.
        const items = NOTE_ITEMS.map((item) => ({
          id: item.id,
          url: `http://${req.headers.host}/ai/v0.1/entities/note/${item.id.split(":")[1]}.json`,
          updated_at: item.updatedAt,
          checksum: entityChecksum(item),
        }));
        const checksum = checksumOf(items);
        respondCacheable(
          200,
          { aidp_version: "0.1", type: "note", generated_at: generatedAt, checksum, items },
          checksum,
          generatedAt
        );
        return;
      }

      if (type !== "example") {
        sendError(404, "unsupported_type", `Type "${type}" is not published by this server.`);
        return;
      }
      const cursorParam = url.searchParams.get("cursor");
      const page = cursorParam ? decodeCursor(cursorParam).page : 0;
      const start = page * PAGE_SIZE;
      const pageItems = ITEMS.slice(start, start + PAGE_SIZE);
      const hasNext = start + PAGE_SIZE < ITEMS.length;
      const items = pageItems.map((item) => ({
        id: item.id,
        url: `http://${req.headers.host}/ai/v0.1/entities/example/${item.id.split(":")[1]}.json`,
        updated_at: item.updatedAt,
        checksum: entityChecksum(item),
      }));
      const checksum = checksumOf(items);
      respondCacheable(
        200,
        {
          aidp_version: "0.1",
          type: "example",
          generated_at: generatedAt,
          checksum,
          items,
          cursor: { next: hasNext ? encodeCursor(page + 1) : null },
        },
        checksum,
        generatedAt
      );
      return;
    }

    const entityMatch = url.pathname.match(/^\/ai\/v0\.1\/entities\/([a-z0-9_-]+)\/([a-z0-9_-]+)\.json$/);
    if (entityMatch) {
      const [, type, id] = entityMatch;
      const itemsForType = type === "note" ? NOTE_ITEMS : type === "example" ? ITEMS : null;
      if (!itemsForType) {
        sendError(404, "unsupported_type", `Type "${type}" is not published by this server.`);
        return;
      }
      const canonicalId = `${type}:${id}`;
      const item = itemsForType.find((i) => i.id === canonicalId);
      if (!item) {
        sendError(404, "not_found", `Entity ${canonicalId} was not found.`);
        return;
      }
      const checksum = entityChecksum(item);
      const body = {
        aidp_version: "0.1",
        id: item.id,
        type,
        checksum,
        updated_at: item.updatedAt,
        canonical_url: `http://${req.headers.host}/e/${id}`,
        locale: "en",
        data: item.data,
      };
      respondCacheable(200, body, checksum, item.updatedAt);
      return;
    }

    sendError(404, "not_found", `No route for ${url.pathname}`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

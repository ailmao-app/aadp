import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";

/** Mirrors `tests/client/v1.0.test.ts`'s local fixture-server harness, reused here for Relations client tests. */

export type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void;

export interface TestServer {
  baseUrl: string;
  requestLog: string[];
  close: () => Promise<void>;
}

export async function startServer(handler: Handler): Promise<TestServer> {
  const requestLog: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requestLog.push(url.pathname);
    handler(req, res, url);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestLog,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function buildEntity(
  id: string,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    id,
    type,
    checksum: checksumOf(data),
    updated_at: "2026-08-05T00:00:00Z",
    data,
    ...extra,
  };
}

export function buildRelationSet(items: unknown[]): Record<string, unknown> {
  return { module: "aadp:relations", version: "1.0", kind: "relation-set", items };
}

export function buildCollectionPage(
  source: { id: string; type: string },
  rel: string,
  targetType: string,
  items: Array<{ id: string; url: string }>,
  cursorNext: string | null = null
): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    module: "aadp:relations",
    module_version: "1.0",
    kind: "relation-collection",
    source,
    rel,
    target_type: targetType,
    ordered: true,
    generated_at: "2026-08-05T00:00:00Z",
    checksum: checksumOf(items),
    items,
    cursor: { next: cursorNext },
  };
}

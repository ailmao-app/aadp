import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";

/** Mirrors `tests/modules/relations/v1.0/client/server-helpers.ts`, reused here for Answer client tests. */

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

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function buildXAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is Orbit?",
    concise_answer: "Orbit is a neutral example service.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    ...overrides,
  };
  const { content_checksum: _drop, ...rest } = base as Record<string, unknown>;
  return { ...base, content_checksum: checksumOf(rest) };
}

export function buildAnswerEntity(
  id: string,
  xAnswerOverrides: Record<string, unknown> = {},
  entityOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    id,
    type: "answer",
    checksum: checksumOf({}),
    updated_at: (xAnswerOverrides.freshness as { updated_at?: string } | undefined)?.updated_at ?? "2026-08-06T00:00:00Z",
    canonical_url: `https://example.com/answers/${id.split(":")[1] ?? id}`,
    data: {},
    x_answer: buildXAnswer(xAnswerOverrides),
    ...entityOverrides,
  };
}

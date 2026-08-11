import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";

/** Mirrors `tests/modules/answer/v1.0/client/server-helpers.ts`, reused here for Evidence client tests. */

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

function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

export interface EvidenceRefSpec {
  id: string;
  url: string;
  stance?: "support" | "contradict" | "neutral";
  confidence?: number;
}

export function buildClaimWrapper(refs: EvidenceRefSpec[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "claim",
    statement: "Orbit reported 99.9% uptime in 2026.",
    locale: "en",
    evidence_refs: refs.map((ref) => ({
      target_type: "evidence",
      target: { id: ref.id, url: ref.url },
      stance: ref.stance ?? "support",
      ...(ref.confidence === undefined ? {} : { confidence: ref.confidence }),
    })),
    ...overrides,
  });
}

export function buildEvidenceWrapper(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "evidence",
    summary: "Annual status report published by Example Orbit.",
    locale: "en",
    source: {
      title: "Orbit 2026 Status Report",
      url: "https://example.com/reports/2026-status",
      publisher: { name: "Example Orbit" },
      access: "public",
    },
    provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" },
    ...overrides,
  });
}

/** A claim entity whose `evidence_refs` point at `refs`. */
export function buildClaimEntity(slug: string, refs: EvidenceRefSpec[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    id: `claim:${slug}`,
    type: "claim",
    checksum: checksumOf({}),
    updated_at: "2026-08-06T09:00:00Z",
    canonical_url: `https://example.com/claims/${slug}`,
    data: {},
    x_evidence: buildClaimWrapper(refs),
    ...overrides,
  };
}

export function buildEvidenceEntity(slug: string, overrides: Record<string, unknown> = {}, wrapperOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    id: `evidence:${slug}`,
    type: "evidence",
    checksum: checksumOf({}),
    updated_at: "2026-08-06T09:00:00Z",
    canonical_url: `https://example.com/evidence/${slug}`,
    data: {},
    x_evidence: buildEvidenceWrapper(wrapperOverrides),
    ...overrides,
  };
}

/** An Answer `1.0` wrapper, unmodified by Evidence — only its `related_entities` do the citing. */
export function buildXAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is Orbit's 2026 uptime?",
    concise_answer: "Orbit reported 99.9% uptime in 2026.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    ...overrides,
  });
}

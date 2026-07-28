import { AadpServerError } from "./errors.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "If-None-Match, If-Modified-Since",
};

// RFC 9110 §8.8.3.2: conditional GET uses *weak* comparison — a CDN in
// front of the app commonly rewrites a strong ETag to weak once it
// compresses the response, and the client then echoes that weak tag
// back. The origin must still recognize it as a match against its own
// strong ETag, or conditional GET silently stops working for most real
// traffic. `If-None-Match` may also be a comma-separated list or `*`.
function ifNoneMatchHits(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const target = etag.startsWith("W/") ? etag.slice(2) : etag;
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => (candidate.startsWith("W/") ? candidate.slice(2) : candidate) === target);
}

function jsonHeaders(extra: Record<string, string>): Headers {
  return new Headers({ "Content-Type": "application/json", ...CORS_HEADERS, ...extra });
}

/** Shared response builder for sitemap-index/sitemap/entity — every kind that carries a checksum + timestamp and must support conditional GET (spec v1.0 §7). */
export function cacheableJsonResponse(
  request: Request,
  body: unknown,
  checksum: string,
  timestamp: string,
  maxAgeSeconds: number
): Response {
  const etag = `"${checksum}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  const lastModified = new Date(timestamp).toUTCString();

  if (ifNoneMatchHits(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: new Headers({ ETag: etag, "Last-Modified": lastModified, ...CORS_HEADERS }),
    });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders({
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": `public, max-age=${maxAgeSeconds}`,
    }),
  });
}

/** Manifest has no mandatory checksum in v1.0 — no conditional GET, just a cache lifetime. */
export function manifestResponse(body: unknown, maxAgeSeconds: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders({ "Cache-Control": `public, max-age=${maxAgeSeconds}` }),
  });
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: new Headers(CORS_HEADERS) });
}

/** AADP v1.0 spec §9 error envelope. Never forwards a raw, unrecognized error's message/stack — that may contain upstream URLs or internals. */
export function errorResponse(error: unknown): Response {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (error instanceof AadpServerError) {
    return new Response(
      JSON.stringify({ error: { code: error.code, message: error.message, request_id: requestId } }),
      { status: error.status, headers: jsonHeaders({}) }
    );
  }
  return new Response(
    JSON.stringify({
      error: {
        code: "upstream_unavailable",
        message: "The server could not complete this request.",
        request_id: requestId,
      },
    }),
    { status: 502, headers: jsonHeaders({}) }
  );
}

import { AadpServerError } from "./errors.js";

const BASE_CORS_HEADERS = ["If-None-Match", "If-Modified-Since"];

/**
 * Builds the `Access-Control-Allow-Headers` value for this server:
 * conditional-cache headers plus every header name a configured `api_key`
 * (`in: "header"`) security scheme declares — a scheme the manifest
 * advertises but whose header the CORS preflight never allow-lists is
 * invisible to any browser-based client (they get blocked before the
 * resource's own auth check ever runs).
 */
export function buildCorsAllowHeaders(extraHeaderNames: string[]): string {
  return [...new Set([...BASE_CORS_HEADERS, "Authorization", ...extraHeaderNames])].join(", ");
}

function corsHeaders(allowHeaders: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
  };
}

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

function jsonHeaders(corsAllowHeaders: string, extra: Record<string, string>): Headers {
  return new Headers({ "Content-Type": "application/json", ...corsHeaders(corsAllowHeaders), ...extra });
}

/**
 * Response builder for sitemap-index/sitemap/entity — every kind that
 * carries a `checksum` + timestamp. Spec v1.0 §7 requires `ETag` +
 * `Last-Modified` + `If-None-Match` support on **every** 2xx response for
 * these three kinds, with no exception for a resource that declared a
 * `security` scheme — only `cacheControl` should differ for those (e.g.
 * `"private, no-store"` instead of `"public, max-age=..."`, so a shared
 * cache still won't store the authorized response for a different
 * principal), never the presence of the validator itself.
 */
export function cacheableJsonResponse(
  request: Request,
  body: unknown,
  checksum: string,
  timestamp: string,
  cacheControl: string,
  corsAllowHeaders: string
): Response {
  const etag = `"${checksum}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  const lastModified = new Date(timestamp).toUTCString();

  if (ifNoneMatchHits(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: new Headers({
        ETag: etag,
        "Last-Modified": lastModified,
        "Cache-Control": cacheControl,
        ...corsHeaders(corsAllowHeaders),
      }),
    });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders(corsAllowHeaders, {
      ETag: etag,
      "Last-Modified": lastModified,
      "Cache-Control": cacheControl,
    }),
  });
}

/** Manifest has no mandatory checksum in v1.0 — no conditional GET, just a cache lifetime. Always public: it is discovery metadata (which schemes/types exist), never protected data. */
export function manifestResponse(body: unknown, maxAgeSeconds: number, corsAllowHeaders: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders(corsAllowHeaders, { "Cache-Control": `public, max-age=${maxAgeSeconds}` }),
  });
}

export function preflightResponse(corsAllowHeaders: string): Response {
  return new Response(null, { status: 204, headers: new Headers(corsHeaders(corsAllowHeaders)) });
}

/** AADP v1.0 spec §9 error envelope. Never forwards a raw, unrecognized error's message/stack — that may contain upstream URLs or internals. */
export function errorResponse(error: unknown, corsAllowHeaders: string): Response {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (error instanceof AadpServerError) {
    return new Response(
      JSON.stringify({ error: { code: error.code, message: error.message, request_id: requestId } }),
      { status: error.status, headers: jsonHeaders(corsAllowHeaders, {}) }
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
    { status: 502, headers: jsonHeaders(corsAllowHeaders, {}) }
  );
}

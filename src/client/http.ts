/**
 * SSRF-aware, resource-bounded fetch layer for the AADP v1.0 reference
 * client. Every hop (including redirect targets) is checked against a
 * `UrlPolicy`; response size is capped while streaming (not just via a
 * trusted `Content-Length` header, which a malicious/misconfigured
 * origin can misreport); requests are time-bounded (covering connect,
 * headers, redirects, AND body — see `readBodyCapped`); redirects are
 * capped and followed manually so each hop can be policy-checked
 * individually; DNS is resolved and pinned per policy-verified address
 * (see `./dns-pin.js`) so a hostname cannot rebind to a private address
 * after the syntactic policy check passes; and caller-supplied `headers`
 * are dropped entirely whenever a redirect crosses origins, unless the
 * caller explicitly allow-listed that header name as cross-origin-safe
 * (see `scopeHeadersToOrigin`) — there is no default name it's safe to
 * assume carries no secret, so the default is deny-all, not a
 * credential-shaped-name deny-list.
 */
import { createStrictUrlPolicy, assertAllowed, type UrlPolicy } from "./url-policy.js";
import { dispatcherFor } from "./dns-pin.js";

export interface FetchJsonOptions {
  /** Defaults to a shared strict policy singleton (see `dispatcherFor`). */
  urlPolicy?: UrlPolicy;
  /** Abort the request after this many milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Maximum redirect hops to follow. Default 5. */
  maxRedirects?: number;
  /** Maximum response body size in bytes. Default 2 MiB. */
  maxResponseBytes?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /**
   * Header names (case-insensitive) from `headers` that are safe to keep
   * sending after a redirect (or, for `discoverAllEntities`, a
   * document-supplied URL) crosses origins. Every other header in
   * `headers` is dropped cross-origin by default — a caller-supplied
   * header of *any* name may carry a secret (API key, tenant token,
   * session id, ...), so there is no built-in "safe" name to assume;
   * this must be an explicit opt-in per header.
   */
  crossOriginSafeHeaders?: string[];
}

export interface FetchJsonResult {
  status: number;
  contentType: string | null;
  data: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Shared default strict policy: `fetchJson` uses this whenever a caller
 * doesn't supply `urlPolicy`, so `dispatcherFor` (WeakMap-keyed on policy
 * identity) reuses one pinned-DNS `undici.Agent`/connection pool for all
 * default-policy traffic instead of minting a new one — and never
 * closing it — on every call.
 */
const DEFAULT_STRICT_POLICY = createStrictUrlPolicy();

export class AadpClientError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "AadpClientError";
  }
}

export class TimeoutError extends AadpClientError {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`, "timeout");
  }
}

export class TooManyRedirectsError extends AadpClientError {
  constructor(url: string, maxRedirects: number) {
    super(`Exceeded ${maxRedirects} redirects while fetching ${url}`, "too_many_redirects");
  }
}

export class ResponseTooLargeError extends AadpClientError {
  constructor(url: string, maxBytes: number) {
    super(`Response from ${url} exceeded the ${maxBytes}-byte limit`, "response_too_large");
  }
}

export class InvalidContentTypeError extends AadpClientError {
  constructor(url: string, contentType: string | null) {
    super(
      `Response from ${url} has content-type "${contentType ?? "(none)"}", expected JSON`,
      "invalid_content_type"
    );
  }
}

export class MalformedJsonError extends AadpClientError {
  constructor(url: string, cause: unknown) {
    super(`Response from ${url} is not valid JSON: ${(cause as Error)?.message ?? cause}`, "malformed_json");
  }
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /^application\/json\b/i.test(contentType.trim());
}

function isAbortError(err: unknown): boolean {
  return (err as Error)?.name === "AbortError";
}

function crossOriginSafeNameSet(extra?: string[]): Set<string> {
  return new Set((extra ?? []).map((h) => h.toLowerCase()));
}

/** Keeps only the headers whose name is in `safeNames`; drops everything else. */
function restrictToCrossOriginSafe(
  headers: Record<string, string> | undefined,
  safeNames: Set<string>
): Record<string, string> | undefined {
  if (!headers) return headers;
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (safeNames.has(name.toLowerCase())) filtered[name] = value;
  }
  return filtered;
}

/**
 * Returns `options` unchanged if `targetUrl`'s origin matches `homeOrigin`,
 * otherwise returns a copy of `options.headers` restricted to
 * `options.crossOriginSafeHeaders` (deny-all-by-default, not a
 * credential-shaped-name deny-list — see `FetchJsonOptions.headers`). Use
 * this before fetching a URL that a *document* (manifest, sitemap index,
 * sitemap, or redirect target) supplied, rather than one the caller
 * configured `options` for directly — `discoverAllEntities` uses it so a
 * sitemap or entity URL that a compromised/misconfigured origin points at
 * a different host never receives the caller's headers.
 */
export function scopeHeadersToOrigin<T extends FetchJsonOptions>(
  options: T,
  targetUrl: string,
  homeOrigin: string
): T {
  if (!options.headers) return options;
  let targetOrigin: string;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return options;
  }
  if (targetOrigin === homeOrigin) return options;
  return {
    ...options,
    headers: restrictToCrossOriginSafe(options.headers, crossOriginSafeNameSet(options.crossOriginSafeHeaders)),
  };
}

async function readBodyCapped(
  res: Response,
  url: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new ResponseTooLargeError(url, maxBytes);
    }
    return text;
  }

  const reader = res.body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort);
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      // `cancel()` from `onAbort` can make `read()` resolve as `done`
      // instead of rejecting, depending on the stream implementation —
      // check the signal explicitly so a slow body reliably surfaces as
      // an abort rather than a silently truncated success.
      if (signal.aborted) {
        const abortErr = new Error(`Reading response body from ${url} was aborted`);
        abortErr.name = "AbortError";
        throw abortErr;
      }
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ResponseTooLargeError(url, maxBytes);
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Fetches `url` as JSON with SSRF policy, timeout, manual-redirect
 * capping, and streamed size limiting. Returns the raw `{status,
 * contentType, data}` triple — callers decide how to interpret non-2xx
 * status (e.g. as an AADP error envelope) since that varies by call
 * site.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<FetchJsonResult> {
  const policy = options.urlPolicy ?? DEFAULT_STRICT_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const safeNames = crossOriginSafeNameSet(options.crossOriginSafeHeaders);
  const dispatcher = dispatcherFor(policy);

  let current = new URL(url);
  const originalUrl = url;
  let headers = options.headers;

  for (let hop = 0; ; hop++) {
    assertAllowed(current, policy);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(current.toString(), {
          redirect: "manual",
          headers,
          signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
      } catch (err) {
        if (isAbortError(err)) {
          throw new TimeoutError(current.toString(), timeoutMs);
        }
        throw err;
      }

      if (res.status === 304) {
        await res.body?.cancel().catch(() => {});
        return { status: 304, contentType: res.headers.get("content-type"), data: undefined };
      }

      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
      if (isRedirect) {
        // Drain the (typically empty) redirect body to release the socket.
        await res.body?.cancel().catch(() => {});
        if (hop + 1 >= maxRedirects) {
          throw new TooManyRedirectsError(originalUrl, maxRedirects);
        }
        const next = new URL(res.headers.get("location")!, current);
        if (next.origin !== current.origin) {
          headers = restrictToCrossOriginSafe(headers, safeNames);
        }
        current = next;
        continue;
      }

      const contentType = res.headers.get("content-type");
      let raw: string;
      try {
        raw = await readBodyCapped(res, current.toString(), maxResponseBytes, controller.signal);
      } catch (err) {
        if (isAbortError(err)) {
          throw new TimeoutError(current.toString(), timeoutMs);
        }
        throw err;
      }

      if (!isJsonContentType(contentType)) {
        throw new InvalidContentTypeError(current.toString(), contentType);
      }

      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new MalformedJsonError(current.toString(), err);
      }

      return { status: res.status, contentType, data };
    } finally {
      clearTimeout(timer);
    }
  }
}

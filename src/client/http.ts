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
  /**
   * Response headers of the final (non-redirect) hop. Exposed so callers
   * that verify HTTP-level behaviour — the conformance runner's `ETag` /
   * `Last-Modified` / conditional-GET checks — do not have to re-fetch
   * through a bare `fetch()` that bypasses this module's URL policy.
   */
  headers: Headers;
  /** Body size actually read, in bytes. `0` for a well-formed 304. */
  bodyBytes: number;
  /** Final URL after redirects. Differs from the requested URL only when redirected. */
  url: string;
}

export interface ProbeResult {
  status: number;
  contentType: string | null;
  headers: Headers;
  /** Final URL after redirects. */
  url: string;
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

export class InvalidOptionError extends AadpClientError {
  constructor(name: string, value: number, reason: string) {
    super(`Invalid "${name}" option (${value}): ${reason}`, "invalid_option");
  }
}

/**
 * Guards the numeric `FetchJsonOptions` against non-finite or out-of-range
 * values before they reach `setTimeout`/redirect-counting/body-size
 * comparisons. `setTimeout` silently clamps a negative/NaN delay to fire
 * immediately, and `Infinity` never fires — either turns "invalid input"
 * into a confusing hang or premature abort instead of a clear error at the
 * call site that passed it.
 */
function assertValidNumberOption(name: string, value: number, min: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidOptionError(name, value, "must be a finite number");
  }
  if (value < min) {
    throw new InvalidOptionError(name, value, `must be >= ${min}`);
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
 * Response of the final (non-redirect) hop, handed to a `requestWithPolicy`
 * handler while the request's timeout is still armed.
 */
interface FinalResponse {
  res: Response;
  finalUrl: string;
  signal: AbortSignal;
  maxResponseBytes: number;
  timeoutMs: number;
}

/**
 * Shared request loop: per-hop URL policy check, pinned-DNS dispatcher,
 * timeout, manual redirect capping, and cross-origin header stripping.
 * The final response is handed to `handle` *inside* the timeout scope, so
 * a handler that reads the body is time-bounded too. Every reader of this
 * module (`fetchJson`, `probeUrl`) goes through here, so there is exactly
 * one place where the safety properties documented at the top of this
 * file are enforced.
 */
async function requestWithPolicy<T>(
  url: string,
  options: FetchJsonOptions,
  handle: (final: FinalResponse) => Promise<T>
): Promise<T> {
  const policy = options.urlPolicy ?? DEFAULT_STRICT_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  assertValidNumberOption("timeoutMs", timeoutMs, 1);
  assertValidNumberOption("maxRedirects", maxRedirects, 0);
  assertValidNumberOption("maxResponseBytes", maxResponseBytes, 1);
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

      const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has("location");
      if (isRedirect) {
        // Drain the (typically empty) redirect body to release the socket.
        await res.body?.cancel().catch(() => {});
        // `hop` counts redirects already followed, so this one is number
        // `hop + 1`: `maxRedirects: 1` follows exactly one redirect and
        // rejects the second, and only `0` refuses the first.
        if (hop + 1 > maxRedirects) {
          throw new TooManyRedirectsError(originalUrl, maxRedirects);
        }
        const next = new URL(res.headers.get("location")!, current);
        if (next.origin !== current.origin) {
          headers = restrictToCrossOriginSafe(headers, safeNames);
        }
        current = next;
        continue;
      }

      return await handle({
        res,
        finalUrl: current.toString(),
        signal: controller.signal,
        maxResponseBytes,
        timeoutMs,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Reads the body with the size cap, mapping an abort to `TimeoutError`. */
async function readBodyOrTimeout(final: FinalResponse): Promise<string> {
  try {
    return await readBodyCapped(final.res, final.finalUrl, final.maxResponseBytes, final.signal);
  } catch (err) {
    if (isAbortError(err)) {
      throw new TimeoutError(final.finalUrl, final.timeoutMs);
    }
    throw err;
  }
}

/**
 * Fetches `url` as JSON with SSRF policy, timeout, manual-redirect
 * capping, and streamed size limiting. Returns the raw `{status,
 * contentType, data}` triple — callers decide how to interpret non-2xx
 * status (e.g. as an AADP error envelope) since that varies by call
 * site.
 *
 * A 304 short-circuits before the content-type/JSON checks (there is no
 * body to type), returning `data: undefined` — but its body is still read
 * under the size cap so `bodyBytes` can prove the response really was
 * empty, as RFC 9110 §15.4.5 requires.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<FetchJsonResult> {
  return requestWithPolicy(url, options, async (final) => {
    const contentType = final.res.headers.get("content-type");
    const raw = await readBodyOrTimeout(final);
    const bodyBytes = Buffer.byteLength(raw, "utf8");

    if (final.res.status === 304) {
      return {
        status: 304,
        contentType,
        data: undefined,
        headers: final.res.headers,
        bodyBytes,
        url: final.finalUrl,
      };
    }

    if (!isJsonContentType(contentType)) {
      throw new InvalidContentTypeError(final.finalUrl, contentType);
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new MalformedJsonError(final.finalUrl, err);
    }

    return { status: final.res.status, contentType, data, headers: final.res.headers, bodyBytes, url: final.finalUrl };
  });
}

/**
 * Requests `url` under the same policy/timeout/redirect/size guarantees as
 * `fetchJson` but reports only the response metadata, discarding the body
 * without parsing it or requiring a JSON content type. Intended for
 * liveness probing of URLs a document *advertises* (policy pages, license
 * URLs, interface documentation), which are ordinary web pages rather than
 * AADP documents — a dead-link check must not report `text/html` as a
 * failure.
 */
export async function probeUrl(url: string, options: FetchJsonOptions = {}): Promise<ProbeResult> {
  return requestWithPolicy(url, options, async (final) => {
    // Read (and discard) under the cap rather than leaving the socket
    // holding an unbounded body: same resource bound as fetchJson.
    await readBodyOrTimeout(final).catch((err) => {
      if (err instanceof ResponseTooLargeError) return "";
      throw err;
    });
    return {
      status: final.res.status,
      contentType: final.res.headers.get("content-type"),
      headers: final.res.headers,
      url: final.finalUrl,
    };
  });
}

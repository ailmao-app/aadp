/**
 * SSRF-aware, resource-bounded fetch layer for the AADP v1.0 reference
 * client. Every hop (including redirect targets) is checked against a
 * `UrlPolicy`; response size is capped while streaming (not just via a
 * trusted `Content-Length` header, which a malicious/misconfigured
 * origin can misreport); requests are time-bounded; redirects are capped
 * and followed manually so each hop can be policy-checked individually.
 */
import { createStrictUrlPolicy, assertAllowed, type UrlPolicy } from "./url-policy.js";

export interface FetchJsonOptions {
  /** Defaults to `createStrictUrlPolicy()`. */
  urlPolicy?: UrlPolicy;
  /** Abort the request after this many milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Maximum redirect hops to follow. Default 5. */
  maxRedirects?: number;
  /** Maximum response body size in bytes. Default 2 MiB. */
  maxResponseBytes?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface FetchJsonResult {
  status: number;
  contentType: string | null;
  data: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

async function readBodyCapped(res: Response, url: string, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new ResponseTooLargeError(url, maxBytes);
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
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
}

/**
 * Fetches `url` as JSON with SSRF policy, timeout, manual-redirect
 * capping, and streamed size limiting. Returns the raw `{status,
 * contentType, data}` triple — callers decide how to interpret non-2xx
 * status (e.g. as an AADP error envelope) since that varies by call
 * site.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<FetchJsonResult> {
  const policy = options.urlPolicy ?? createStrictUrlPolicy();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let current = new URL(url);
  const originalUrl = url;

  for (let hop = 0; ; hop++) {
    assertAllowed(current, policy);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        headers: options.headers,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new TimeoutError(current.toString(), timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
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
      current = new URL(res.headers.get("location")!, current);
      continue;
    }

    const contentType = res.headers.get("content-type");
    const raw = await readBodyCapped(res, current.toString(), maxResponseBytes);

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
  }
}

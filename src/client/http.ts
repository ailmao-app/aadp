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
import { createStrictUrlPolicy, assertAllowed, BlockedUrlError, type UrlPolicy } from "./url-policy.js";
import { dispatcherFor } from "./dns-pin.js";
import {
  chargeDiscoveryBudgetBytes,
  chargeDiscoveryBudgetRequest,
  AadpDiscoveryBudgetExceededError,
  type DiscoveryBudgetState,
} from "./discovery-budget.js";

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
  /**
   * Caller-driven cancellation (ADR-0006). Combined with this module's own
   * per-hop timeout via `AbortSignal.any()` — aborting stops the in-flight
   * request (headers and body) and rejects with `AbortedError` instead of
   * `TimeoutError`. Omitting this is a no-op: internal timeout handling is
   * unchanged, so behavior matches every release before 1.1.0.
   */
  signal?: AbortSignal;
  /**
   * Opt-in retry/backoff (ADR-0006). Omitting `retry` entirely disables it
   * — identical to every release before 1.1.0, which never retries
   * anything. Retries only a fixed, defined set of transient outcomes: a
   * network/connect-level error, this module's own per-hop `timeoutMs`, and
   * HTTP `429`/`503`. Never retries any other 4xx, a `BlockedUrlError`, an
   * `AbortedError`, or a request that would exceed a shared traversal
   * budget/deadline. See `RetryOptions`.
   */
  retry?: RetryOptions;
  /**
   * Called with the current hop's URL immediately before that hop's own
   * `maxRequests` charge and network attempt — the exact same point in
   * the per-hop loop below, for the original request, every retry, and
   * every redirect hop alike (ADR-0008). Lets a caller charge a budget
   * dimension this module has no concept of (e.g. Relations traversal's
   * "is this cross-origin relative to the walk's root", ADR-0008
   * `maxCrossOriginRequests`) at the same per-attempt granularity as
   * `maxRequests`, without duplicating this hop loop. Throwing here
   * aborts the request before any network I/O for that hop — same effect
   * as `maxRequests` being exceeded. Never called for a hop `assertAllowed`
   * already rejected.
   */
  onBeforeAttempt?: (url: URL) => void;
}

export interface RetryOptions {
  /** Maximum attempts, including the first. Default 3 when `retry` is present but this is omitted. Must be >= 1. */
  maxAttempts?: number;
  /** Base delay for exponential-backoff-with-full-jitter, in ms. Default 500. */
  baseDelayMs?: number;
  /**
   * Upper bound on any single backoff delay, in ms — including one derived
   * from a `Retry-After` response header, so a publisher-supplied value
   * cannot stall a run indefinitely. Default 10000.
   */
  maxDelayMs?: number;
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
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

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

/** Thrown when `options.signal` aborts a request/body-read — distinct from an internal `TimeoutError`. */
export class AbortedError extends AadpClientError {
  constructor(url: string, reason?: unknown) {
    super(`Request to ${url} was aborted${reason !== undefined && reason !== null ? `: ${String(reason)}` : ""}`, "aborted");
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
  if (!Number.isInteger(value)) {
    throw new InvalidOptionError(name, value, "must be an integer");
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

function callerAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

/**
 * Whitelist, not a blacklist (ADR-0006): retry only fires for a fixed,
 * defined set of transient outcomes. `TimeoutError` is this module's own
 * per-hop timeout; anything that is not one of this module's named
 * `AadpClientError` subclasses and not a `BlockedUrlError` is presumed a
 * raw, unclassified network/connect-level failure (e.g. `ECONNREFUSED`/
 * `ECONNRESET` surfacing from `fetch()`) — also transient. Every other
 * named error (a real client error like `MalformedJsonError`, or a
 * security-relevant block like `BlockedUrlError`/`AbortedError`) is never
 * retried: retrying would not fix a malformed response, and retrying a
 * security block or a caller's own cancellation is never correct.
 */
function isRetryableError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof AbortedError) return false;
  if (err instanceof BlockedUrlError) return false;
  // A deadline/budget-exceeded signal is not a transient condition to
  // retry through — it's the run stopping itself. Without this exclusion,
  // `assertRetryFitsDeadline`/`assertWithinDeadline` throwing from inside
  // the status-retry branch would be caught by the outer (error-based)
  // retry branch and misread as "retryable", which computes its own
  // smaller backoff delay and can let one more real request through before
  // the deadline check finally catches up — see ERROR_LOG.md 2026-08-03.
  if (err instanceof AadpDiscoveryBudgetExceededError) return false;
  if (err instanceof AadpClientError) return false;
  return true;
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

/** Exponential backoff with full jitter: a uniform random delay in `[0, cappedDelay]`. */
function computeBackoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const capped = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.random() * capped;
}

/**
 * A `Retry-After` value (seconds, or an HTTP-date per RFC 9110 §10.2.3),
 * capped at `maxDelayMs` so a publisher-supplied value cannot stall a run
 * indefinitely. Returns `undefined` for a missing or unparseable header —
 * the caller falls back to the computed exponential backoff instead.
 */
function parseRetryAfterMs(value: string | null, maxDelayMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxDelayMs);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), maxDelayMs);
  return undefined;
}

/**
 * Test-only instrumentation, fired the instant a retry backoff `setTimeout`
 * is actually armed and its `abort` listener attached — i.e. the moment a
 * caller's abort would hit *this* pending timer rather than some earlier
 * point in the retry loop (in-flight `fetch()`, body drain, ...). Exists
 * because a test synchronizing only on "the server responded to attempt 1"
 * cannot tell whether its subsequent `controller.abort()` actually landed
 * on the backoff wait or raced ahead of it — see `ERROR_LOG.md` 2026-08-05
 * and the "Testability" section of ADR-0006. Not part of the public
 * package surface: `http.ts` is not one of `package.json`'s `exports`
 * subpaths, so `tests/package/compatibility-contract.test.ts` (which only
 * imports from the packed tarball's `dist/client/v1.0` etc.) can never
 * observe or lock this hook. Defaults to a no-op; install/clear via
 * `setOnRetryBackoffTimerArmedForTests`.
 */
let onRetryBackoffTimerArmedForTests: (() => void) | undefined;

/** Test-only: see `onRetryBackoffTimerArmedForTests` above. */
export function setOnRetryBackoffTimerArmedForTests(hook: (() => void) | undefined): void {
  onRetryBackoffTimerArmedForTests = hook;
}

/**
 * Waits `ms`, rejecting early (with a plain `AbortError`-named `Error`, left
 * for the caller to map to `AbortedError`) if `signal` aborts first — a
 * pending retry backoff timer is itself cancellable, per ADR-0006.
 */
function sleepRespectingAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error("Retry backoff aborted");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
    onRetryBackoffTimerArmedForTests?.();
  });
}

/**
 * `pinnedLookup()` (`./dns-pin.js`) rejects a DNS-rebound connection by
 * throwing `BlockedUrlError` from its `dns.lookup` callback, but `fetch()`
 * wraps every connect-time failure into a generic `TypeError: "fetch
 * failed"` with the real cause one level down. Without unwrapping it, a
 * DNS-rebinding block is indistinguishable from any other network failure
 * — a caller catching `BlockedUrlError` specifically (as the string-level
 * `assertAllowed()` check throws it directly) would silently miss this
 * path entirely.
 */
function unwrapBlockedUrlError(err: unknown): unknown {
  const cause = (err as { cause?: unknown } | undefined)?.cause;
  return cause instanceof BlockedUrlError ? cause : err;
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

/**
 * Charges `bytes` to the shared whole-run budget, if one was given, as soon
 * as they're read — never after the fact. This is what makes `maxTotalBytes`
 * (ADR-0006) an actual streaming stop, not just a check performed once a
 * response already read up to its own `maxResponseBytes` cap: a run with 1
 * byte of remaining budget stops after 1 byte of this response, not after
 * the full ~2 MiB default per-response cap.
 *
 * Charging happens per chunk rather than once for the whole body, and each
 * charge is a single synchronous call — under Node's single-threaded event
 * loop, two concurrent reads (`concurrency > 1`) can never charge the same
 * shared counter "at the same instant"; every synchronous increment-then-
 * compare fully completes before any other chunk's callback runs, so no
 * separate locking/reservation scheme is needed for this to be race-free.
 */
function chargeBytesOrThrow(budget: DiscoveryBudgetState | undefined, bytes: number, context: string): void {
  if (budget) chargeDiscoveryBudgetBytes(budget, bytes, context);
}

async function readBodyCapped(
  res: Response,
  url: string,
  maxBytes: number,
  signal: AbortSignal,
  budget?: DiscoveryBudgetState,
  budgetContext?: string
): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new ResponseTooLargeError(url, maxBytes);
    }
    // No stream to charge incrementally against here — the whole (small)
    // body is already in memory by the time `res.text()` resolves. Still
    // charged so the shared budget accounts for it, just not able to stop
    // mid-read the way the streamed path below can.
    chargeBytesOrThrow(budget, Buffer.byteLength(text, "utf8"), budgetContext ?? url);
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
        try {
          chargeBytesOrThrow(budget, value.byteLength, budgetContext ?? url);
        } catch (err) {
          await reader.cancel().catch(() => {});
          throw err;
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
  callerSignal: AbortSignal | undefined;
  maxResponseBytes: number;
  timeoutMs: number;
  budget: DiscoveryBudgetState | undefined;
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
/**
 * Milliseconds left before `budget`'s deadline, or `undefined` if there is
 * no budget. May be negative (deadline already passed).
 */
function remainingDeadlineMs(budget: DiscoveryBudgetState | undefined): number | undefined {
  if (!budget) return undefined;
  return budget.deadlineMs - (Date.now() - budget.startedAt);
}

/**
 * Throws `AadpDiscoveryBudgetExceededError` if `budget`'s deadline has
 * already passed. A no-op when there's no budget.
 */
function assertWithinDeadline(budget: DiscoveryBudgetState | undefined, context: string): void {
  const remaining = remainingDeadlineMs(budget);
  if (remaining !== undefined && remaining <= 0) {
    throw new AadpDiscoveryBudgetExceededError(`${context} exceeded its deadline of ${budget!.deadlineMs}ms`);
  }
}

/**
 * A retry's backoff delay must not, by itself, push the run past its shared
 * deadline (ADR-0006: "a retry that would exceed the remaining budget/
 * deadline fails immediately ... instead of attempting the request"). This
 * throws instead of sleeping when `delayMs` alone would exceed however much
 * deadline is left — the retry never even starts a new attempt, let alone
 * sends a request, once that's true.
 */
function assertRetryFitsDeadline(budget: DiscoveryBudgetState | undefined, delayMs: number, context: string): void {
  const remaining = remainingDeadlineMs(budget);
  if (remaining !== undefined && (remaining <= 0 || delayMs >= remaining)) {
    throw new AadpDiscoveryBudgetExceededError(
      `${context} would exceed its deadline of ${budget!.deadlineMs}ms if it retried again`
    );
  }
}

async function requestWithPolicy<T>(
  url: string,
  options: FetchJsonOptions,
  handle: (final: FinalResponse) => Promise<T>,
  budget?: DiscoveryBudgetState
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
  const callerSignal = options.signal;

  // Retry disabled (the default) is exactly `maxAttempts: 1` — one attempt,
  // no backoff — so the loop below has no special-cased "no retry" branch.
  // The raw caller-supplied value (not a `Math.max`-clamped one) is what
  // gets validated, so an invalid `maxAttempts: 0` throws instead of being
  // silently clamped up to a valid `1`.
  const retry = options.retry;
  const maxAttempts = retry ? (retry.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS) : 1;
  const baseDelayMs = retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const maxDelayMs = retry?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  if (retry) {
    assertValidNumberOption("retry.maxAttempts", maxAttempts, 1);
    assertValidNumberOption("retry.baseDelayMs", baseDelayMs, 0);
    assertValidNumberOption("retry.maxDelayMs", maxDelayMs, 0);
  }

  attempts: for (let attempt = 1; ; attempt++) {
    // Every attempt restarts from the original URL/headers — a retry is a
    // brand new request, not a resumed one; a redirect chain from a
    // previous attempt has no bearing on this one.
    let current = new URL(url);
    const originalUrl = url;
    let headers = options.headers;

    try {
      for (let hop = 0; ; hop++) {
        if (callerAborted(callerSignal)) {
          throw new AbortedError(current.toString(), callerSignal!.reason);
        }
        // Checked on every hop, not just before a retry's backoff sleep: an
        // attempt that itself runs long (close to `timeoutMs`) can still
        // exhaust the shared deadline between hops, and a retry must never
        // start a fresh attempt once the deadline is already gone even if
        // no backoff delay is involved (attempt 1 of a fresh retry cycle).
        assertWithinDeadline(budget, `request to ${current.toString()}`);
        assertAllowed(current, policy);
        // `onBeforeAttempt` runs BEFORE `maxRequests` is charged: if it
        // throws (a caller's own budget/policy hook rejecting this hop),
        // `requestsMade` must stay untouched — it counts requests that
        // were actually going to be attempted, not ones a different check
        // already vetoed. Reordering these would let a blocked hop still
        // consume a `maxRequests` slot for a request that was never sent.
        options.onBeforeAttempt?.(current);
        // Charged for the original request, every retry attempt, and every
        // redirect hop alike — each re-enters this loop and reaches this
        // line before its own `fetch()` call below (AADP-REL-005). Never
        // charged for a hop that `assertAllowed` already rejected (or
        // `onBeforeAttempt` already vetoed): a blocked URL was never
        // actually sent over the network.
        if (budget) chargeDiscoveryBudgetRequest(budget, `request to ${current.toString()}`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        // Caller cancellation and this hop's own timeout share one signal:
        // whichever fires first aborts `fetch()`/the body read, and the
        // catch below tells them apart by re-checking `callerSignal.aborted`.
        const combinedSignal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
        try {
          let res: Response;
          try {
            res = await fetch(current.toString(), {
              redirect: "manual",
              headers,
              signal: combinedSignal,
              ...(dispatcher ? { dispatcher } : {}),
            } as RequestInit);
          } catch (err) {
            // Checked before `isAbortError(err)`: when `AbortController.abort(reason)`
            // is called with a non-undefined `reason`, a spec-compliant `fetch()`
            // rejects with that `reason` value directly — which may not even be
            // an `Error` (a caller can pass any value, e.g. a plain string) — not
            // a generic named `AbortError`. Checking the signal's own `.aborted`
            // flag first catches that case regardless of what shape the
            // rejection took.
            if (callerAborted(callerSignal)) throw new AbortedError(current.toString(), callerSignal!.reason);
            if (isAbortError(err)) {
              throw new TimeoutError(current.toString(), timeoutMs);
            }
            throw unwrapBlockedUrlError(err);
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

          if (retry && attempt < maxAttempts && isRetryableStatus(res.status)) {
            const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"), maxDelayMs);
            const delayMs = retryAfterMs ?? computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
            // Checked BEFORE draining/sleeping: a retry whose delay alone
            // would exceed the remaining deadline fails immediately instead
            // of sleeping and then attempting anyway.
            assertRetryFitsDeadline(budget, delayMs, `request to ${current.toString()}`);
            await res.body?.cancel().catch(() => {});
            clearTimeout(timer);
            try {
              await sleepRespectingAbort(delayMs, callerSignal);
            } catch (err) {
              if (callerAborted(callerSignal)) throw new AbortedError(current.toString(), callerSignal!.reason);
              throw err;
            }
            continue attempts;
          }

          return await handle({
            res,
            finalUrl: current.toString(),
            signal: combinedSignal,
            callerSignal,
            maxResponseBytes,
            timeoutMs,
            budget,
          });
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (err) {
      if (retry && attempt < maxAttempts && isRetryableError(err)) {
        const delayMs = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
        assertRetryFitsDeadline(budget, delayMs, `request to ${current.toString()}`);
        try {
          await sleepRespectingAbort(delayMs, callerSignal);
        } catch (sleepErr) {
          if (callerAborted(callerSignal)) throw new AbortedError(current.toString(), callerSignal!.reason);
          throw sleepErr;
        }
        continue attempts;
      }
      throw err;
    }
  }
}

/** Reads the body with the size cap, mapping an abort to `TimeoutError`. */
async function readBodyOrTimeout(final: FinalResponse): Promise<string> {
  try {
    return await readBodyCapped(
      final.res,
      final.finalUrl,
      final.maxResponseBytes,
      final.signal,
      final.budget,
      `request to ${final.finalUrl}`
    );
  } catch (err) {
    if (callerAborted(final.callerSignal)) throw new AbortedError(final.finalUrl, final.callerSignal!.reason);
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
export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
  budget?: DiscoveryBudgetState
): Promise<FetchJsonResult> {
  return requestWithPolicy(
    url,
    options,
    async (final) => {
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

      return {
        status: final.res.status,
        contentType,
        data,
        headers: final.res.headers,
        bodyBytes,
        url: final.finalUrl,
      };
    },
    budget
  );
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
export async function probeUrl(
  url: string,
  options: FetchJsonOptions = {},
  budget?: DiscoveryBudgetState
): Promise<ProbeResult> {
  return requestWithPolicy(
    url,
    options,
    async (final) => {
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
    },
    budget
  );
}

/**
 * Resolution context binding for the per-budget canonical resolution state
 * (`./canonical-resolution.ts`'s `BudgetResolutionState`).
 *
 * Released in `1.3.1` as a security fix to the Answer client and moved here
 * unchanged in `1.4.0` when the canonical resolution layer became shared
 * infrastructure (ADR-0010 §11). There is deliberately only ONE copy: an
 * Evidence-side fork of this check would be an entry point that bypasses it.
 *
 * That state caches a canonical target's settled outcome — and joins an
 * in-flight fetch — keyed by `{budget, canonical target key}` alone. Every
 * option that shapes the actual HTTP request (`headers`, `urlPolicy`,
 * `maxResponseBytes`, ...) is per-CALL, not per-budget, so two calls sharing
 * one caller-owned budget could previously share a request/result across
 * different request contexts:
 *
 * - an unauthenticated call could replay an entity fetched with another
 *   call's credentials, never making the request that would have produced
 *   its own `401`/`403`; and
 * - a call with a stricter `maxResponseBytes` could replay a larger cached
 *   response, never enforcing its own cap.
 *
 * Both are order-dependent, which also makes concurrent calls
 * nondeterministic: whichever call creates the `pending` entry first
 * supplies the options for the one shared request.
 *
 * The fix binds a resolution context to the budget's state on first use and
 * fails closed on mismatch: one budget means one immutable request
 * configuration, not merely one principal. Callers that genuinely need
 * different options must use different budgets.
 *
 * Only a digest is retained — never raw header values — so this state can
 * never become a place credentials are read back out of. The digest is
 * HMAC-SHA-256 under a per-process random key, so it is not a stable
 * fingerprint of a credential across processes either, and it is never put
 * into an error message or log.
 */
import { createHmac, randomBytes } from "node:crypto";

/**
 * Per-process HMAC key. Random per process specifically so a digest cannot
 * be used to test a guessed credential value offline, and so digests are
 * not comparable across processes (they are only ever compared to another
 * digest computed in this same process).
 */
const DIGEST_KEY = randomBytes(32);

/**
 * Reference identity for options that cannot be compared structurally:
 * `UrlPolicy` (an object carrying behavior) and `onBeforeAttempt` (a
 * function). Mirrors how `dispatcherFor` already keys its pool WeakMap on
 * `UrlPolicy` identity — two structurally identical policies built by
 * separate `createStrictUrlPolicy()` calls are deliberately NOT
 * interchangeable here, since neither this module nor `dispatcherFor` can
 * prove they behave identically.
 */
const referenceIds = new WeakMap<object, string>();
let nextReferenceId = 0;

function referenceId(value: object | undefined, absent: string): string {
  if (value === undefined) return absent;
  let id = referenceIds.get(value);
  if (id === undefined) {
    id = `#${++nextReferenceId}`;
    referenceIds.set(value, id);
  }
  return id;
}

/**
 * Length-prefixed encoding. Every variable-length piece is written as
 * `<utf8 byte length>:<value>` so no header name or value can forge a field
 * boundary by containing the delimiter — `{ "a:1b": "c" }` and
 * `{ "a": "1b:c" }` must not collide.
 */
function field(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

/** Effective defaults from `fetchJson`, so "omitted" and "passed the default explicitly" agree. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;

/**
 * The subset of resolution options that can change the shared request or
 * the outcome replayed from it. Declared structurally rather than importing
 * a module's own options type, so this module stays free of a cycle back
 * into either resolver.
 *
 * `signal` is deliberately absent: it is caller-local waiting state, never
 * forwarded to the shared fetch (see `resolveCanonicalTarget`), so two calls
 * differing only by `signal` share a context legitimately.
 */
export interface ResolutionContextOptions {
  headers?: Record<string, string>;
  crossOriginSafeHeaders?: string[];
  urlPolicy?: object;
  rootOrigin?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
  onBeforeAttempt?: (url: URL) => void;
}

/**
 * Digest of every request-affecting option, normalized so that equivalent
 * option sets agree:
 *
 * - header names are lower-cased and sorted (HTTP header names are
 *   case-insensitive, so `Authorization` and `authorization` are one
 *   context, not two);
 * - `crossOriginSafeHeaders` is lower-cased, de-duplicated and sorted, since
 *   it is a set;
 * - numeric options and `retry` are resolved to their effective values.
 */
export function resolutionContextDigest(options: ResolutionContextOptions): string {
  const parts: string[] = [];

  const headers = Object.entries(options.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  parts.push(field(String(headers.length)));
  for (const [name, value] of headers) {
    parts.push(field(name), field(value));
  }

  const safeHeaders = [...new Set((options.crossOriginSafeHeaders ?? []).map((h) => h.toLowerCase()))].sort();
  parts.push(field(String(safeHeaders.length)));
  for (const name of safeHeaders) parts.push(field(name));

  parts.push(field(referenceId(options.urlPolicy, "!default-policy")));
  parts.push(field(options.rootOrigin === undefined ? "!absent" : `=${options.rootOrigin}`));
  parts.push(field(String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
  parts.push(field(String(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)));
  parts.push(field(String(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)));

  // Omitting `retry` disables retries entirely, which is NOT the same as
  // supplying `{}` (present, so retries are enabled with default tuning).
  if (options.retry === undefined) {
    parts.push(field("!no-retry"));
  } else {
    parts.push(field("retry"));
    parts.push(field(String(options.retry.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS)));
    parts.push(field(String(options.retry.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS)));
    parts.push(field(String(options.retry.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS)));
  }

  parts.push(field(referenceId(options.onBeforeAttempt, "!absent")));

  return createHmac("sha256", DIGEST_KEY).update(parts.join("")).digest("hex");
}

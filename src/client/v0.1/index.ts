/**
 * Reference AADP v0.1 client: discovery -> sitemap index -> sitemap ->
 * entity. Deliberately independent of any application/Ailmao type, and of
 * the v1.0 client's wire types (`../v1.0/index.js`) — everything here
 * operates on the generic AADP v0.1 envelope shapes below.
 *
 * Wire contract (envelope types, URL shapes, function signatures) is
 * unchanged from the pre-Phase-4 client, so existing v0.1 consumers keep
 * compiling and their request/response shapes are untouched. What changed
 * is the transport and validation underneath: this now runs on the same
 * SSRF-aware, resource-bounded fetch layer as v1.0 (`../http.js`), the
 * same schema/checksum/cross-document validation (`../validated-document.js`
 * — v0.1 has its own registered schema, so this is a real check, not a
 * v1.0 schema misapplied to v0.1 data), and the same traversal budgets
 * (`../discovery-budget.js`) instead of a bare, unvalidated, unbounded
 * `fetch()`. A consumer using this package's default export gets all of
 * that without any code change on its part. An optional trailing
 * `options: ClientOptions` param (identical to v1.0's) lets a caller
 * override any of it, e.g. `createPermissiveUrlPolicy()` for a
 * deliberately local/offline deployment.
 */
import { scopeHeadersToOrigin, type FetchJsonOptions } from "../http.js";
import {
  fetchAndValidateDocument,
  AadpSchemaValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
} from "../validated-document.js";
import {
  createDiscoveryBudget,
  chargeDiscoveryBudget,
  AadpDiscoveryBudgetExceededError,
  type DiscoveryBudget,
  type DiscoveryBudgetState,
} from "../discovery-budget.js";
import { AadpRequestError, type AadpErrorEnvelope } from "../errors.js";

export {
  createStrictUrlPolicy,
  createPermissiveUrlPolicy,
  BlockedUrlError,
  type UrlPolicy,
} from "../url-policy.js";
export {
  AadpClientError,
  TimeoutError,
  AbortedError,
  TooManyRedirectsError,
  ResponseTooLargeError,
  InvalidContentTypeError,
  MalformedJsonError,
  InvalidOptionError,
  type RetryOptions,
} from "../http.js";
export {
  AadpSchemaValidationError,
  AadpChecksumMismatchError,
  AadpIntegrityMismatchError,
} from "../validated-document.js";
export {
  AadpDiscoveryBudgetExceededError,
  type DiscoveryBudget,
  type DiscoveryBudgetState,
} from "../discovery-budget.js";
export { UnsupportedAadpVersionError } from "../../validator/index.js";

export type ClientOptions = FetchJsonOptions;

/** Every AADP envelope permits `x_*` extension fields (spec §10). */
interface ExtensionFields {
  [key: `x_${string}`]: unknown;
}

export interface Manifest extends ExtensionFields {
  aadp_version: string;
  default_locale: string;
  available_locales: string[];
  sitemap_index: string;
  /**
   * URI prefix for constructing `{entity_base}/{type}/{id}.json` when a
   * canonical id is already known — NOT a dereferenceable endpoint by
   * itself (spec §3.1). Prefer `sitemap.items[].url` for fetching; it is
   * always authoritative and this client never needs `entity_base`.
   */
  entity_base?: string;
  capabilities?: string[];
}

export interface SitemapIndex extends ExtensionFields {
  aadp_version: string;
  generated_at: string;
  /** sha256:<hex> of canonical `sitemaps` — see spec §6. */
  checksum: string;
  sitemaps: Array<{ type: string; url: string; count?: number }>;
}

export interface SitemapItem extends ExtensionFields {
  id: string;
  url: string;
  updated_at: string;
  checksum: string;
}

export interface Sitemap extends ExtensionFields {
  aadp_version: string;
  type: string;
  generated_at: string;
  /** sha256:<hex> of canonical `items` — see spec §6. */
  checksum: string;
  items: SitemapItem[];
  cursor?: { next: string | null };
}

export interface Entity<T = unknown> extends ExtensionFields {
  aadp_version: string;
  id: string;
  type: string;
  checksum: string;
  updated_at: string;
  canonical_url?: string;
  locale?: string;
  data: T;
}

export { AadpRequestError };
export type { AadpErrorEnvelope };

export async function discover(
  originBaseUrl: string,
  options: ClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<Manifest> {
  const url = new URL("/.well-known/ai-manifest.json", originBaseUrl).toString();
  return fetchAndValidateDocument<Manifest>(url, "0.1", "manifest", options, budget);
}

export async function fetchSitemapIndex(
  url: string,
  options: ClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<SitemapIndex> {
  return fetchAndValidateDocument<SitemapIndex>(url, "0.1", "sitemap-index", options, budget);
}

export async function fetchSitemap(
  url: string,
  cursor?: string | null,
  options: ClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<Sitemap> {
  const target = new URL(url);
  if (cursor) target.searchParams.set("cursor", cursor);
  return fetchAndValidateDocument<Sitemap>(target.toString(), "0.1", "sitemap", options, budget);
}

export interface IterateSitemapOptions extends ClientOptions, DiscoveryBudget {
  /** Throws `AadpIntegrityMismatchError` if the fetched sitemap's declared `type` disagrees with this. */
  expectedType?: string;
  /**
   * Share page/deadline accounting across multiple `iterateSitemap` calls
   * (e.g. one per sitemap in a `discoverAllEntities` walk) instead of
   * budgeting this call alone. Created fresh from `maxPages`/`deadlineMs`
   * when omitted.
   */
  budget?: DiscoveryBudgetState;
}

/**
 * Follows `cursor.next` until exhausted, yielding every sitemap item.
 * Bounded by `maxPages`/`deadlineMs` (default 10000 pages / 5 minutes)
 * even when this is called directly rather than through
 * `discoverAllEntities` — a schema-valid server can still hand out
 * unbounded pages via an ever-fresh `cursor.next` that cycle detection
 * alone does not catch.
 */
export async function* iterateSitemap(
  sitemapUrl: string,
  options: IterateSitemapOptions = {}
): AsyncGenerator<SitemapItem> {
  const budget = options.budget ?? createDiscoveryBudget(options);
  let cursor: string | null | undefined = undefined;
  const seenCursors = new Set<string>();
  do {
    chargeDiscoveryBudget(budget, "page", `iterateSitemap(${sitemapUrl})`);
    const page = await fetchSitemap(sitemapUrl, cursor, options, budget);
    if (options.expectedType !== undefined && page.type !== options.expectedType) {
      throw new AadpIntegrityMismatchError(
        `Sitemap at ${sitemapUrl} declares type "${page.type}" but was referenced as "${options.expectedType}"`
      );
    }
    for (const item of page.items) yield item;
    cursor = page.cursor?.next ?? null;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Cursor cycle detected at ${cursor}`);
      }
      seenCursors.add(cursor);
    }
  } while (cursor);
}

export async function fetchEntity<T = unknown>(
  url: string,
  options: ClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<Entity<T>> {
  return fetchAndValidateDocument<Entity<T>>(url, "0.1", "entity", options, budget);
}

export type DiscoverAllEntitiesOptions = ClientOptions & DiscoveryBudget;

/**
 * Full discovery walk: manifest -> sitemap index -> every sitemap ->
 * every entity, delegating pagination to `iterateSitemap` (sharing one
 * `DiscoveryBudgetState` across every sitemap) rather than re-implementing
 * it, so the same page/deadline budget applies whether a caller uses this
 * or paginates a sitemap directly.
 *
 * Enforces the identity/integrity invariants spec §6 requires across
 * documents (`AadpIntegrityMismatchError` on violation) — a sitemap must
 * declare the `type` its index entry claims, and each fetched entity must
 * agree with its sitemap item on `id`, `type` (the sitemap's namespace),
 * and `checksum`. Each document's own checksum is separately verified in
 * `fetchAndValidateDocument` (`AadpChecksumMismatchError`).
 *
 * Headers configured in `options.headers` are only sent to
 * `originBaseUrl`'s own origin; sitemap/entity URLs a document points at a
 * different origin never receive them (see `scopeHeadersToOrigin`).
 */
export async function* discoverAllEntities(
  originBaseUrl: string,
  options: DiscoverAllEntitiesOptions = {}
): AsyncGenerator<Entity> {
  const homeOrigin = new URL(originBaseUrl).origin;
  const scoped = (targetUrl: string): ClientOptions =>
    scopeHeadersToOrigin(options, targetUrl, homeOrigin);
  const budget = createDiscoveryBudget(options);

  const manifest = await discover(originBaseUrl, options, budget);
  const index = await fetchSitemapIndex(manifest.sitemap_index, scoped(manifest.sitemap_index), budget);

  for (const sitemapRef of index.sitemaps) {
    const sitemapOptions: IterateSitemapOptions = {
      ...scoped(sitemapRef.url),
      expectedType: sitemapRef.type,
      budget,
    };
    for await (const item of iterateSitemap(sitemapRef.url, sitemapOptions)) {
      chargeDiscoveryBudget(budget, "entity", "discoverAllEntities");
      const entity = await fetchEntity(item.url, scoped(item.url), budget);
      if (entity.id !== item.id) {
        throw new AadpIntegrityMismatchError(
          `Sitemap item id "${item.id}" at ${item.url} does not match fetched entity id "${entity.id}"`
        );
      }
      if (entity.type !== sitemapRef.type) {
        throw new AadpIntegrityMismatchError(
          `Entity at ${item.url} has type "${entity.type}" but its sitemap namespace is "${sitemapRef.type}"`
        );
      }
      if (entity.checksum !== item.checksum) {
        throw new AadpIntegrityMismatchError(
          `Sitemap item checksum "${item.checksum}" for ${item.url} does not match fetched entity checksum "${entity.checksum}"`
        );
      }
      yield entity;
    }
  }
}

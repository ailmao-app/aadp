/**
 * Reference AADP v1.0 client: discovery -> sitemap index -> sitemap ->
 * entity. Built on the SSRF-aware, resource-bounded fetch layer in
 * `../http.js` and gated by the schema/semantic validators in
 * `../../validator` — every document is schema-validated (and, for the
 * manifest, semantic-validated) BEFORE any URL it contains is trusted for
 * further traversal (`docs/records/implementation-record-v1.0.md` Phase 4).
 *
 * Deliberately independent of the v0.1 client (`../v0.1/index.js`) and of
 * any application/Ailmao type in wire shape — but shares the
 * fetch-and-validate machinery (`../validated-document.js`) and traversal
 * budgets (`../discovery-budget.js`) with it, since neither is a wire
 * concern.
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
import { mapConcurrent } from "../scheduler.js";
import { checkManifestSemantics, hasSemanticErrors, type SemanticIssue } from "../../validator/index.js";
import type {
  ManifestV1,
  SitemapIndexV1,
  SitemapItemV1,
  SitemapV1,
  EntityV1,
} from "./types.js";

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
} from "../http.js";
export { AadpRequestError, type AadpErrorEnvelope } from "../errors.js";
export { UnsupportedAadpVersionError } from "../../validator/index.js";
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
export type {
  ManifestV1,
  SitemapIndexV1,
  SitemapItemV1,
  SitemapV1,
  EntityV1,
  SecurityScheme,
} from "./types.js";

export type ClientOptions = FetchJsonOptions;

const WELL_KNOWN_PATH = "/.well-known/ai-manifest.json";

/** A schema-valid manifest failed a Phase-3 semantic rule at `error` level. */
export class AadpSemanticValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly issues: SemanticIssue[]
  ) {
    super(
      `Manifest at ${url} failed semantic validation: ${issues
        .filter((issue) => issue.level === "error")
        .map((issue) => `${issue.code} (${issue.path})`)
        .join(", ")}`
    );
    this.name = "AadpSemanticValidationError";
  }
}

/**
 * Fetches and validates the manifest at `/.well-known/ai-manifest.json`
 * under `originBaseUrl`. Throws `UnsupportedAadpVersionError` if the
 * document declares a different `aadp_version`, `AadpSchemaValidationError`
 * if it fails JSON Schema, and `AadpSemanticValidationError` if it fails a
 * Phase-3 semantic rule at `error` level — in every failure case, no
 * sitemap/entity URL from the document is ever dereferenced.
 */
export async function discover(
  originBaseUrl: string,
  options: ClientOptions = {}
): Promise<ManifestV1> {
  const url = new URL(WELL_KNOWN_PATH, originBaseUrl).toString();
  const manifest = await fetchAndValidateDocument<ManifestV1>(url, "1.0", "manifest", options);
  const issues = checkManifestSemantics(manifest);
  if (hasSemanticErrors(issues)) {
    throw new AadpSemanticValidationError(url, issues);
  }
  return manifest;
}

export async function fetchSitemapIndex(
  url: string,
  options: ClientOptions = {}
): Promise<SitemapIndexV1> {
  return fetchAndValidateDocument<SitemapIndexV1>(url, "1.0", "sitemap-index", options);
}

export async function fetchSitemap(
  url: string,
  cursor: string | null | undefined,
  options: ClientOptions = {}
): Promise<SitemapV1> {
  const target = new URL(url);
  if (cursor) target.searchParams.set("cursor", cursor);
  return fetchAndValidateDocument<SitemapV1>(target.toString(), "1.0", "sitemap", options);
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
): AsyncGenerator<SitemapItemV1> {
  const budget = options.budget ?? createDiscoveryBudget(options);
  let cursor: string | null | undefined;
  const seenCursors = new Set<string>();
  do {
    chargeDiscoveryBudget(budget, "page", `iterateSitemap(${sitemapUrl})`);
    const page = await fetchSitemap(sitemapUrl, cursor, options);
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
  options: ClientOptions = {}
): Promise<EntityV1<T>> {
  return fetchAndValidateDocument<EntityV1<T>>(url, "1.0", "entity", options);
}

export interface DiscoveryLimits extends DiscoveryBudget {
  /** Maximum sitemaps traversed across the whole walk. Default 1000. */
  maxSitemaps?: number;
  /**
   * Maximum entity fetches in flight at once within a single sitemap
   * (ADR-0006). Default `1` — fully serial, identical request ordering
   * and timing to every release before 1.1.0. Opt in to a value `> 1` to
   * fetch entities in parallel; entities are still yielded in the same
   * order the sitemap listed them, regardless of which fetch finishes
   * first. See `../scheduler.js`.
   */
  concurrency?: number;
}

export type DiscoverAllEntitiesOptions = ClientOptions & DiscoveryLimits;

const DEFAULT_MAX_SITEMAPS = 1000;

/**
 * Full discovery walk: manifest -> sitemap index -> every sitemap ->
 * every entity, delegating pagination to `iterateSitemap` (sharing one
 * `DiscoveryBudgetState` across every sitemap) rather than re-implementing
 * it, so the same page/deadline budget applies whether a caller uses this
 * or paginates a sitemap directly.
 *
 * Enforces the identity/integrity invariants spec v1.0 §6 requires across
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
): AsyncGenerator<EntityV1> {
  const homeOrigin = new URL(originBaseUrl).origin;
  const scoped = (targetUrl: string): ClientOptions =>
    scopeHeadersToOrigin(options, targetUrl, homeOrigin);

  const maxSitemaps = options.maxSitemaps ?? DEFAULT_MAX_SITEMAPS;
  const budget = createDiscoveryBudget(options);

  const manifest = await discover(originBaseUrl, options);
  const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, scoped(manifest.discovery.sitemap_index));
  if (index.sitemaps.length > maxSitemaps) {
    throw new AadpDiscoveryBudgetExceededError(
      `sitemap index at ${manifest.discovery.sitemap_index} declares ${index.sitemaps.length} sitemaps, exceeding the maxSitemaps limit of ${maxSitemaps}`
    );
  }

  const concurrency = options.concurrency ?? 1;

  for (const sitemapRef of index.sitemaps) {
    const sitemapOptions: IterateSitemapOptions = {
      ...scoped(sitemapRef.url),
      expectedType: sitemapRef.type,
      budget,
    };
    const items = iterateSitemap(sitemapRef.url, sitemapOptions);
    const fetchAndVerify = async (item: SitemapItemV1): Promise<EntityV1> => {
      chargeDiscoveryBudget(budget, "entity", "discoverAllEntities");
      const entity = await fetchEntity(item.url, scoped(item.url));
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
      return entity;
    };
    for await (const entity of mapConcurrent(items, fetchAndVerify, { concurrency })) {
      yield entity;
    }
  }
}

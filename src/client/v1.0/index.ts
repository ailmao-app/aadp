/**
 * Reference AADP v1.0 client: discovery -> sitemap index -> sitemap ->
 * entity. Built on the SSRF-aware, resource-bounded fetch layer in
 * `../http.js` and gated by the schema/semantic validators in
 * `../../validator` — every document is schema-validated (and, for the
 * manifest, semantic-validated) BEFORE any URL it contains is trusted for
 * further traversal (`docs/IMPLEMENTATION_PLAN.md` Phase 4).
 *
 * Deliberately independent of the v0.1 client (`../v0.1/index.js`) and of
 * any application/Ailmao type.
 */
import { fetchJson, type FetchJsonOptions } from "../http.js";
import { AadpRequestError, type AadpErrorEnvelope } from "../errors.js";
import {
  validateDocument,
  UnsupportedAadpVersionError,
  checkManifestSemantics,
  hasSemanticErrors,
  type SemanticIssue,
  type ResourceKind,
} from "../../validator/index.js";
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
  TooManyRedirectsError,
  ResponseTooLargeError,
  InvalidContentTypeError,
  MalformedJsonError,
} from "../http.js";
export { AadpRequestError, type AadpErrorEnvelope } from "../errors.js";
export { UnsupportedAadpVersionError } from "../../validator/index.js";
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

/** A fetched document failed AADP v1.0 JSON Schema validation for its kind. */
export class AadpSchemaValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly kind: ResourceKind,
    public readonly errors: unknown[]
  ) {
    super(
      `Document at ${url} failed AADP v1.0 "${kind}" schema validation: ${JSON.stringify(errors)}`
    );
    this.name = "AadpSchemaValidationError";
  }
}

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
 * A document that declares its own `aadp_version` other than `"1.0"` is
 * rejected before schema validation runs, so the failure is reported as
 * `UnsupportedAadpVersionError` (this client's contract) rather than an
 * opaque `schema_invalid` result.
 */
function assertDeclaredVersion(data: unknown): void {
  const version = (data as { aadp_version?: unknown } | null)?.aadp_version;
  if (typeof version === "string" && version !== "1.0") {
    throw new UnsupportedAadpVersionError(version);
  }
}

async function fetchAndValidate<T>(
  url: string,
  kind: ResourceKind,
  options: ClientOptions
): Promise<T> {
  const { status, data } = await fetchJson(url, options);
  if (status === 304) {
    throw new AadpRequestError("Not modified", 304);
  }
  if (status < 200 || status >= 300) {
    const envelope = data as AadpErrorEnvelope;
    throw new AadpRequestError(
      envelope?.error?.message ?? `Request to ${url} failed with status ${status}`,
      status,
      envelope
    );
  }
  assertDeclaredVersion(data);
  const result = validateDocument({ version: "1.0", kind, data });
  if (!result.valid) {
    throw new AadpSchemaValidationError(url, kind, result.errors);
  }
  return data as T;
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
  const manifest = await fetchAndValidate<ManifestV1>(url, "manifest", options);
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
  return fetchAndValidate<SitemapIndexV1>(url, "sitemap-index", options);
}

export async function fetchSitemap(
  url: string,
  cursor: string | null | undefined,
  options: ClientOptions = {}
): Promise<SitemapV1> {
  const target = new URL(url);
  if (cursor) target.searchParams.set("cursor", cursor);
  return fetchAndValidate<SitemapV1>(target.toString(), "sitemap", options);
}

/** Follows `cursor.next` until exhausted, yielding every sitemap item. */
export async function* iterateSitemap(
  sitemapUrl: string,
  options: ClientOptions = {}
): AsyncGenerator<SitemapItemV1> {
  let cursor: string | null | undefined;
  const seenCursors = new Set<string>();
  do {
    const page = await fetchSitemap(sitemapUrl, cursor, options);
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
  return fetchAndValidate<EntityV1<T>>(url, "entity", options);
}

/** Full discovery walk: manifest -> sitemap index -> every sitemap -> every entity. */
export async function* discoverAllEntities(
  originBaseUrl: string,
  options: ClientOptions = {}
): AsyncGenerator<EntityV1> {
  const manifest = await discover(originBaseUrl, options);
  const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, options);
  for (const sitemapRef of index.sitemaps) {
    for await (const item of iterateSitemap(sitemapRef.url, options)) {
      yield await fetchEntity(item.url, options);
    }
  }
}

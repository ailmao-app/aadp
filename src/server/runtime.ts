/**
 * Declarative AADP v1.0 server runtime (`defineAADP()` / `defineResource()`)
 * — see `docs/vi/_doc/IMPLEMENTATION_PLAN.md` §11 "Ưu tiên 2". Generalizes
 * the hand-written manifest/sitemap/entity builder + HTTP cache/error
 * plumbing that a single Next.js AADP adapter (Ailmao's) already
 * implements by hand, so a second implementer does not have to copy it.
 *
 * Data access stays entirely the application's: `list`/`get` may call a
 * database, an internal HTTP API, or anything else — this module never
 * assumes a data source. `serialize()` is the one mandatory boundary,
 * since it is the only place a raw record may leak into a public
 * document.
 */
import { checksumOf } from "../canonical-json/index.js";
import { validateDocument } from "../validator/index.js";
import { checkManifestSemantics, hasSemanticErrors } from "../validator/semantic.js";
import { notFound, invalidRequest, unsupportedType, upstreamUnavailable } from "./errors.js";
import { encodeCursor, decodeCursor } from "./cursor.js";
import {
  cacheableJsonResponse,
  manifestResponse,
  errorResponse,
  preflightResponse,
  buildCorsAllowHeaders,
} from "./http.js";
import { RESOURCE_TYPE_GRAMMAR } from "./types.js";
import type {
  AadpServer,
  AadpServerConfig,
  EntityV1,
  GetArgs,
  ListArgs,
  ManifestV1,
  ResourceConfig,
  ResourceDefinition,
  SerializedEntity,
  SitemapIndexV1,
  SitemapV1,
} from "./types.js";

export type {
  AadpServer,
  AadpServerConfig,
  GetArgs,
  ListArgs,
  ListResult,
  ResourceConfig,
  ResourceDefinition,
  SerializedEntity,
} from "./types.js";
export { AadpServerError, type AadpServerErrorCode } from "./errors.js";

const WELL_KNOWN_PATH = "/.well-known/ai-manifest.json";
const DEFAULT_CACHE_MAX_AGE_SECONDS = 300;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100; // schemas/v1.0/sitemap.schema.json items.maxItems

export function defineResource<T>(config: ResourceConfig<T>): ResourceDefinition<T> {
  if (!RESOURCE_TYPE_GRAMMAR.test(config.type)) {
    throw new Error(
      `defineResource(): type "${config.type}" is not a valid AADP resource type (must match ${RESOURCE_TYPE_GRAMMAR}).`
    );
  }
  return { ...config, __aadpResource: true };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
}

/** A malformed percent-encoded path segment (e.g. `%ZZ`) is a client request error, not a data-source failure — `decodeURIComponent` throwing `URIError` must not surface as `upstream_unavailable`. */
function safeDecodeURIComponent(value: string, pathname: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidRequest(`Malformed percent-encoding in path "${pathname}".`);
  }
}

/** Splits a serialized entity's `${type}:${routeId}` id and confirms it belongs to `resource`. */
function routeIdOf(resource: ResourceDefinition<unknown>, serialized: SerializedEntity): string {
  const prefix = `${resource.type}:`;
  if (!serialized.id.startsWith(prefix)) {
    throw upstreamUnavailable(
      `Resource "${resource.type}" serialize() returned id "${serialized.id}", which does not start with "${prefix}".`
    );
  }
  return serialized.id.slice(prefix.length);
}

/**
 * `baseUrl` is published verbatim as the prefix of every URL this server
 * advertises (manifest discovery, sitemap/entity URLs), but `handleRequest`
 * only ever matches an absolute root path (`/ai/v1.0/...`) against the
 * *inbound* request's pathname — it has no way to also require and strip
 * a path prefix. A `baseUrl` with a path, query, fragment or embedded
 * credentials would therefore make the manifest advertise a URL nothing
 * actually serves, so all of those are rejected here rather than at
 * request time.
 */
function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`defineAADP(): baseUrl "${raw}" is not a valid absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`defineAADP(): baseUrl "${raw}" must use http or https.`);
  }
  if (url.username || url.password) {
    throw new Error(`defineAADP(): baseUrl "${raw}" must not contain userinfo credentials.`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(
      `defineAADP(): baseUrl "${raw}" must be a bare origin with no path — got path "${url.pathname}". A path prefix is not supported: handleRequest() only matches an absolute root path.`
    );
  }
  if (url.search || url.hash) {
    throw new Error(`defineAADP(): baseUrl "${raw}" must not contain a query string or fragment.`);
  }
  return url.origin;
}

function validatePositiveInt(value: number | undefined, defaultValue: number, name: string): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`defineAADP(): ${name} must be a positive integer, got ${value}.`);
  }
  return value;
}

function validateNonNegativeInt(value: number | undefined, defaultValue: number, name: string): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`defineAADP(): ${name} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function defineAADP(config: AadpServerConfig): AadpServer {
  const version = config.version ?? "1.0";
  const baseUrl = validateBaseUrl(config.baseUrl);
  const cacheMaxAgeSeconds = validateNonNegativeInt(
    config.cacheMaxAgeSeconds,
    DEFAULT_CACHE_MAX_AGE_SECONDS,
    "cacheMaxAgeSeconds"
  );
  const pageSize = Math.min(
    validatePositiveInt(config.pageSize, DEFAULT_PAGE_SIZE, "pageSize"),
    MAX_PAGE_SIZE
  );
  const basePath = `/ai/v${version}`; // spec/v1.0/specification.md:355-356 — wire base path is "/ai/v1.0", not "/ai/1.0"
  const sitemapIndexPath = `${basePath}/sitemap-index.json`;

  // A configured `api_key` (`in: "header"`) scheme's header name must be
  // preflight-allowed, or a browser blocks the request before the
  // resource's own auth check in list()/get() ever runs.
  const apiKeyHeaderNames = Object.values(config.securitySchemes ?? {})
    .filter((scheme): scheme is { type: "api_key"; in: "header" | "query"; name: string } => scheme.type === "api_key")
    .filter((scheme) => scheme.in === "header")
    .map((scheme) => scheme.name);
  const corsAllowHeaders = buildCorsAllowHeaders(apiKeyHeaderNames);

  const resourcesByType = new Map<string, ResourceDefinition<unknown>>();
  for (const resource of config.resources) {
    if (resourcesByType.has(resource.type)) {
      throw new Error(`defineAADP(): duplicate resource type "${resource.type}".`);
    }
    resourcesByType.set(resource.type, resource);
  }

  function findResource(type: string): ResourceDefinition<unknown> {
    const resource = resourcesByType.get(type);
    if (!resource) throw unsupportedType(`Type "${type}" is not published by this server.`);
    return resource;
  }

  /**
   * `Cache-Control` is the one axis allowed to differ for a resource that
   * declared a `security` scheme — `private, no-store` keeps a shared
   * cache from serving one principal's authorized response to another.
   * `ETag`/`Last-Modified`/conditional-GET stay identical either way
   * (spec v1.0 §7 applies unconditionally to sitemap/entity 2xx responses).
   */
  function cacheControlFor(type: string): string {
    return resourcesByType.get(type)?.security ? "private, no-store" : `public, max-age=${cacheMaxAgeSeconds}`;
  }

  function entityUrl(type: string, routeId: string): string {
    return `${baseUrl}${basePath}/entities/${type}/${encodeURIComponent(routeId)}.json`;
  }

  function sitemapUrl(type: string): string {
    return `${baseUrl}${basePath}/sitemaps/${type}.json`;
  }

  // Built and validated once at definition time — resources/policies are
  // static, and a manifest that fails its own schema/semantic rules is a
  // configuration bug that should fail the app at startup, not on the
  // first inbound request.
  const manifestDoc: ManifestV1 = (() => {
    const manifest: ManifestV1 = {
      aadp_version: version,
      application: config.application,
      ...(config.links ? { links: config.links } : {}),
      discovery: { sitemap_index: `${baseUrl}${sitemapIndexPath}` },
      ...(config.resources.length > 0
        ? {
            resources: config.resources.map((r) => ({
              type: r.type,
              ...(r.mediaTypes ? { media_types: r.mediaTypes } : {}),
              ...(r.security ? { security: r.security } : {}),
            })),
          }
        : {}),
      ...(config.securitySchemes ? { security_schemes: config.securitySchemes } : {}),
      policies: config.policies,
      ...(config.usageGuidance ? { usage_guidance: config.usageGuidance } : {}),
    };

    const schemaResult = validateDocument({ version, kind: "manifest", data: manifest });
    if (!schemaResult.valid) {
      throw new Error(
        `defineAADP(): generated manifest failed schema validation: ${JSON.stringify(schemaResult.errors)}`
      );
    }
    const semanticIssues = checkManifestSemantics(manifest);
    if (hasSemanticErrors(semanticIssues)) {
      throw new Error(
        `defineAADP(): generated manifest failed semantic validation: ${JSON.stringify(semanticIssues)}`
      );
    }
    return manifest;
  })();

  function manifest(): ManifestV1 {
    return manifestDoc;
  }

  function sitemapIndex(): SitemapIndexV1 {
    const sitemaps = config.resources.map((r) => ({ type: r.type, url: sitemapUrl(r.type) }));
    const doc: SitemapIndexV1 = {
      aadp_version: version,
      generated_at: new Date().toISOString(),
      checksum: checksumOf(sitemaps),
      sitemaps,
    };
    const result = validateDocument({ version, kind: "sitemap-index", data: doc });
    if (!result.valid) {
      throw upstreamUnavailable(
        `Generated sitemap index failed schema validation: ${JSON.stringify(result.errors)}`
      );
    }
    return doc;
  }

  async function sitemap(type: string, cursorParam?: string | null, request?: Request): Promise<SitemapV1> {
    const resource = findResource(type);
    const appCursor = cursorParam ? decodeCursor(type, version, cursorParam) : null;
    const { items: records, nextCursor } = await resource.list({
      cursor: appCursor,
      limit: pageSize,
      request,
    } as ListArgs);

    const items = await Promise.all(
      records.map(async (record) => {
        const serialized = await resource.serialize(record);
        const routeId = routeIdOf(resource, serialized);
        return {
          id: serialized.id,
          url: entityUrl(type, routeId),
          updated_at: toIso(serialized.updatedAt),
          checksum: checksumOf(serialized.data),
        };
      })
    );

    const doc: SitemapV1 = {
      aadp_version: version,
      type,
      generated_at: new Date().toISOString(),
      checksum: checksumOf(items),
      items,
      cursor: { next: nextCursor ? encodeCursor(type, version, nextCursor) : null },
    };
    const result = validateDocument({ version, kind: "sitemap", data: doc });
    if (!result.valid) {
      throw upstreamUnavailable(
        `Generated sitemap for type "${type}" failed schema validation: ${JSON.stringify(result.errors)}`
      );
    }
    return doc;
  }

  async function entity(type: string, id: string, request?: Request): Promise<EntityV1> {
    const resource = findResource(type);
    const record = await resource.get({ id, request } as GetArgs);
    if (record === null || record === undefined) {
      throw notFound(`Entity ${type}:${id} was not found.`);
    }
    const serialized = await resource.serialize(record);
    const routeId = routeIdOf(resource, serialized);
    if (routeId !== id) {
      // get() resolved to a different record than the one requested —
      // treat as not-found rather than leaking the mismatch, same as an
      // id that never existed.
      throw notFound(`Entity ${type}:${id} was not found.`);
    }

    const doc: EntityV1 = {
      aadp_version: version,
      id: serialized.id,
      type,
      checksum: checksumOf(serialized.data),
      updated_at: toIso(serialized.updatedAt),
      ...(serialized.canonicalUrl ? { canonical_url: resolveUrl(baseUrl, serialized.canonicalUrl) } : {}),
      ...(serialized.locale ? { locale: serialized.locale } : {}),
      data: serialized.data,
    };
    const result = validateDocument({ version, kind: "entity", data: doc });
    if (!result.valid) {
      throw upstreamUnavailable(
        `Generated entity "${type}:${id}" failed schema validation: ${JSON.stringify(result.errors)}`
      );
    }
    return doc;
  }

  async function handleRequest(request: Request): Promise<Response> {
    try {
      if (request.method === "OPTIONS") return preflightResponse(corsAllowHeaders);
      if (request.method !== "GET") throw notFound(`No route for ${request.method} ${new URL(request.url).pathname}`);

      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === WELL_KNOWN_PATH) {
        return manifestResponse(manifest(), cacheMaxAgeSeconds, corsAllowHeaders);
      }

      if (pathname === sitemapIndexPath) {
        const doc = sitemapIndex();
        return cacheableJsonResponse(
          request,
          doc,
          doc.checksum,
          doc.generated_at,
          `public, max-age=${cacheMaxAgeSeconds}`,
          corsAllowHeaders
        );
      }

      const sitemapsPrefix = `${basePath}/sitemaps/`;
      if (pathname.startsWith(sitemapsPrefix) && pathname.endsWith(".json")) {
        const type = safeDecodeURIComponent(
          pathname.slice(sitemapsPrefix.length, -".json".length),
          pathname
        );
        const doc = await sitemap(type, url.searchParams.get("cursor"), request);
        return cacheableJsonResponse(
          request,
          doc,
          doc.checksum,
          doc.generated_at,
          cacheControlFor(type),
          corsAllowHeaders
        );
      }

      const entitiesPrefix = `${basePath}/entities/`;
      if (pathname.startsWith(entitiesPrefix) && pathname.endsWith(".json")) {
        const rest = pathname.slice(entitiesPrefix.length, -".json".length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex === -1) {
          throw notFound(`No route for ${pathname}`);
        }
        const type = safeDecodeURIComponent(rest.slice(0, slashIndex), pathname);
        const id = safeDecodeURIComponent(rest.slice(slashIndex + 1), pathname);
        const doc = await entity(type, id, request);
        return cacheableJsonResponse(
          request,
          doc,
          doc.checksum,
          doc.updated_at,
          cacheControlFor(type),
          corsAllowHeaders
        );
      }

      throw notFound(`No route for ${pathname}`);
    } catch (error) {
      return errorResponse(error, corsAllowHeaders);
    }
  }

  return { manifest, sitemapIndex, sitemap, entity, handleRequest };
}

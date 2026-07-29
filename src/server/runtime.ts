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
const MAX_CACHE_MAX_AGE_SECONDS = 31536000; // 1 year — RFC 9111 delta-seconds has no hard cap, but this is a sane upper bound
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100; // schemas/v1.0/sitemap.schema.json items.maxItems

export function defineResource<T>(config: ResourceConfig<T>): ResourceDefinition<T> {
  if (!RESOURCE_TYPE_GRAMMAR.test(config.type)) {
    throw new Error(
      `defineResource(): type "${config.type}" is not a valid AADP resource type (must match ${RESOURCE_TYPE_GRAMMAR}).`
    );
  }
  // Frozen so a caller that kept a reference to this object cannot flip
  // `type`/`security` (or swap `list`/`get`/`serialize`) after the fact —
  // `defineAADP()` reads these once at definition time and treats them as
  // an immutable input to manifest/router/cache-policy construction.
  return Object.freeze({ ...config, __aadpResource: true });
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

/** Recursively freezes a plain JSON-like value. Only ever called on a `structuredClone()` of caller-supplied data, never on the caller's own object — freezing someone else's live object as a side effect would be a surprising and unrelated mutation. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Confirms `value` is entirely within the JSON value domain (string,
 * finite number, boolean, null, plain object, array — no `undefined`,
 * function, symbol, bigint, non-finite number, or circular reference)
 * before it is ever handed to `JSON.stringify()`. Schema validation
 * confirms *shape*; it says nothing about `x_*` extension values (typed
 * `unknown`), which is exactly where a non-JSON value would slip through
 * and only fail once a request tries to serialize the response body.
 * `seen` tracks objects currently on the recursion stack (not every
 * object ever visited), so a value legitimately referenced from two
 * sibling branches is fine — only a true cycle (an object containing
 * itself) is rejected.
 */
function assertJsonSafe(value: unknown, path: string, seen: Set<object> = new Set()): void {
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error(`defineAADP(): manifest value at "${path || "/"}" is not JSON-safe: ${value} is not a finite number.`);
    }
    return;
  }
  if (t === "object") {
    const obj = value as object;
    if (seen.has(obj)) {
      throw new Error(`defineAADP(): manifest contains a circular reference at "${path || "/"}".`);
    }
    seen.add(obj);
    if (Array.isArray(obj)) {
      // `.forEach()`/`.map()` silently skip holes in a sparse array, so a
      // hole would pass validation here but come back as `null` from
      // `JSON.stringify` — check every index is actually present first,
      // the same way `canonical-json/canonicalize.ts` does.
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) {
          throw new Error(`defineAADP(): manifest array at "${path || "/"}" has a hole at index ${i}, which is not JSON-safe.`);
        }
      }
      obj.forEach((item, i) => assertJsonSafe(item, `${path}/${i}`, seen));
    } else {
      // `typeof` alone can't tell a plain object from a `Map`/`Set`/`Date`/
      // typed array/class instance — all report `"object"`, but each
      // serializes to something JSON.stringify produces with no relation
      // to what was just walked here (`{}`, an ISO string, `{}`, an index
      // object, ...). Only a plain object literal or `Object.create(null)`
      // is accepted; anything else is rejected instead of silently
      // re-shaped on the wire.
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        const ctorName = (obj as { constructor?: { name?: string } }).constructor?.name ?? "non-plain object";
        throw new Error(
          `defineAADP(): manifest value at "${path || "/"}" is a ${ctorName} instance, which is not JSON-safe — only plain objects and arrays are supported in x_* extension values.`
        );
      }
      for (const [key, v] of Object.entries(obj as Record<string, unknown>)) {
        assertJsonSafe(v, `${path}/${key}`, seen);
      }
    }
    seen.delete(obj);
    return;
  }
  throw new Error(`defineAADP(): manifest value at "${path || "/"}" is a ${t}, which is not JSON-safe.`);
}

/** Validates the shape `resource.list()` MUST return before its `nextCursor` is ever encoded into a published wire cursor — a malformed result (missing/undefined/non-string `nextCursor`, non-array `items`) must fail loudly now, not two requests later when a client tries to decode a cursor that was never valid. */
function assertValidListResult(
  type: string,
  result: { items: unknown; nextCursor: unknown }
): asserts result is { items: unknown[]; nextCursor: string | null } {
  if (!result || !Array.isArray(result.items)) {
    throw upstreamUnavailable(`Resource "${type}" list() did not return an "items" array.`);
  }
  if (result.nextCursor !== null && typeof result.nextCursor !== "string") {
    throw upstreamUnavailable(
      `Resource "${type}" list() returned a "nextCursor" that is neither a string nor null (got ${JSON.stringify(result.nextCursor)}).`
    );
  }
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
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`defineAADP(): ${name} must be a positive integer, got ${value}.`);
  }
  return value;
}

/**
 * `Number.isInteger()` alone still accepts values like `1e21`, which
 * round-trip through template interpolation as exponent notation
 * (`"1e+21"`) — not a valid HTTP `delta-seconds` token, so a
 * downstream proxy/browser silently ignores the `Cache-Control`
 * directive built from it. `Number.isSafeInteger()` plus an explicit
 * `max` keeps every accepted value representable as a plain decimal
 * string.
 */
function validateBoundedNonNegativeInt(
  value: number | undefined,
  defaultValue: number,
  name: string,
  max: number
): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`defineAADP(): ${name} must be a non-negative integer <= ${max}, got ${value}.`);
  }
  return value;
}

/** RFC 7230 §3.2.6 `token` grammar — what an HTTP header field-name must match. A `securitySchemes` `api_key` header `name` that fails this would either throw when placed into a `Headers` object or be silently misinterpreted by a browser. */
const HTTP_TOKEN_GRAMMAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function defineAADP(config: AadpServerConfig): AadpServer {
  const version = config.version ?? "1.0";
  const baseUrl = validateBaseUrl(config.baseUrl);
  const cacheMaxAgeSeconds = validateBoundedNonNegativeInt(
    config.cacheMaxAgeSeconds,
    DEFAULT_CACHE_MAX_AGE_SECONDS,
    "cacheMaxAgeSeconds",
    MAX_CACHE_MAX_AGE_SECONDS
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
  for (const name of apiKeyHeaderNames) {
    if (!HTTP_TOKEN_GRAMMAR.test(name)) {
      throw new Error(
        `defineAADP(): security scheme header name "${name}" is not a valid HTTP field name (must match ${HTTP_TOKEN_GRAMMAR}).`
      );
    }
  }
  const corsAllowHeaders = buildCorsAllowHeaders(apiKeyHeaderNames);

  // Snapshot the array itself — `resourceList`/`resourcesByType` must not
  // see a later `push`/`splice` on the caller's own array reference.
  // Each individual resource definition is already frozen by
  // `defineResource()`, so no per-object clone is needed here.
  const resourceList = [...config.resources];

  const resourcesByType = new Map<string, ResourceDefinition<unknown>>();
  for (const resource of resourceList) {
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
  // first inbound request. `structuredClone` fully decouples the result
  // from `config.application`/`config.policies`/etc: those come straight
  // from the caller, and without cloning, a mutation of the caller's own
  // object after `defineAADP()` returns would silently reach into an
  // already-"validated" published document. The clone is then deep-frozen
  // so `manifest()` can safely hand out the same object on every call
  // without a caller being able to corrupt it for subsequent requests.
  const manifestDoc: ManifestV1 = (() => {
    const manifest: ManifestV1 = {
      aadp_version: version,
      application: config.application,
      ...(config.links ? { links: config.links } : {}),
      discovery: { sitemap_index: `${baseUrl}${sitemapIndexPath}` },
      ...(resourceList.length > 0
        ? {
            resources: resourceList.map((r) => ({
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
    // Schema validation only constrains shape; `x_*` extension fields are
    // typed `unknown` and can carry a value schema validation would never
    // catch (a BigInt, a function, a cycle) that only fails once a request
    // tries to JSON.stringify the response body. Reject that here, before
    // structuredClone (which tolerates BigInt) or JSON.stringify ever run
    // against it.
    assertJsonSafe(manifest, "");
    const snapshot = structuredClone(manifest);

    const schemaResult = validateDocument({ version, kind: "manifest", data: snapshot });
    if (!schemaResult.valid) {
      throw new Error(
        `defineAADP(): generated manifest failed schema validation: ${JSON.stringify(schemaResult.errors)}`
      );
    }
    const semanticIssues = checkManifestSemantics(snapshot);
    if (hasSemanticErrors(semanticIssues)) {
      throw new Error(
        `defineAADP(): generated manifest failed semantic validation: ${JSON.stringify(semanticIssues)}`
      );
    }
    return deepFreeze(snapshot);
  })();

  // `manifest()`'s declared return type is `ManifestV1` — an ordinary
  // mutable interface — so handing out the frozen `manifestDoc` itself
  // would let code that type-checks fine (`aadp.manifest().application.name
  // = "x"`) throw a `TypeError` at runtime. Returning a fresh clone each
  // call keeps the internal frozen snapshot as the single source of truth
  // while making the public API's mutability contract actually true.
  function manifest(): ManifestV1 {
    return structuredClone(manifestDoc);
  }

  function sitemapIndex(): SitemapIndexV1 {
    const sitemaps = resourceList.map((r) => ({ type: r.type, url: sitemapUrl(r.type) }));
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
    // Nullish, not truthy: an empty-string wire cursor ("?cursor=") is a
    // present-but-malformed cursor that must fail decodeCursor()'s own
    // shape check, not silently collapse to "no cursor" and replay page 1.
    const appCursor = cursorParam == null ? null : decodeCursor(type, version, cursorParam);
    const listResult = await resource.list({
      cursor: appCursor,
      limit: pageSize,
      request,
    } as ListArgs);
    assertValidListResult(type, listResult);
    const { items: records, nextCursor } = listResult;

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
      // Strict null check: `ListResult.nextCursor` distinguishes "no more
      // pages" (`null`) from an application-minted opaque cursor that
      // happens to be the empty string — the latter must still round-trip
      // as a real wire cursor, not collapse into end-of-pagination.
      cursor: { next: nextCursor === null ? null : encodeCursor(type, version, nextCursor) },
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
    // Canonical ID grammar (spec v1.0 §2) is a protocol boundary, not an
    // implementation detail of any one resource — reject before the id
    // ever reaches application data access, so a path-traversal-shaped or
    // otherwise unsafe id is never handed to get().
    if (!RESOURCE_TYPE_GRAMMAR.test(id)) {
      throw invalidRequest(`"${id}" is not a valid AADP canonical id segment.`);
    }
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

import type {
  ManifestV1,
  SitemapIndexV1,
  SitemapV1,
  EntityV1,
} from "../client/v1.0/types.js";

export type { ManifestV1, SitemapIndexV1, SitemapV1, EntityV1 };

/** Grammar for an AADP resource `type` token (spec v1.0 §2). Shared by the runtime's own validation and the `aadp add-resource` scaffold CLI. */
export const RESOURCE_TYPE_GRAMMAR = /^[a-z][a-z0-9_-]*$/;

/** Opaque, application-owned pagination cursor for one `list()` call. */
export interface ListArgs {
  /** `null` for the first page. Never a raw client string — see `../cursor.ts`. */
  cursor: string | null;
  limit: number;
  /**
   * The inbound request, when this call was triggered by `handleRequest()`.
   * `undefined` when the resource is invoked directly through `AadpServer.sitemap()`
   * (e.g. from build-time/SSG code, which has no HTTP request to inspect).
   * `defineAADP()` never inspects `ResourceConfig.security` itself — if this
   * resource declares one, this is where the resource's own code must read
   * credentials off `request` and throw `unauthorized()`/`forbidden()` to
   * enforce it.
   */
  request?: Request;
}

export interface ListResult<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` when this is the last page. */
  nextCursor: string | null;
}

export interface GetArgs {
  /** The id segment recovered from the entity URL — see `ResourceConfig.serialize`. */
  id: string;
  /** See `ListArgs.request` — same caveat: `defineAADP()` does not enforce `security` itself. */
  request?: Request;
}

export interface SerializedEntity<T = unknown> {
  /**
   * Full AADP entity id, i.e. `${type}:${routeId}`. MUST start with
   * `${resource.type}:` — `defineAADP()` uses the remainder as the `id`
   * passed back into `get()` when resolving `/entities/{type}/{id}.json`.
   */
  id: string;
  updatedAt: string | Date;
  /** Absolute URL, or a path resolved against `AadpServerConfig.baseUrl`. */
  canonicalUrl?: string;
  locale?: string;
  /**
   * Public, redacted view of the record. This is the only place a raw
   * database/domain record may leak into the published document, so it
   * is mandatory rather than defaulting to the raw record.
   */
  data: T;
}

export interface ResourceConfig<T> {
  /** AADP resource type, e.g. `"post"`. Must match `^[a-z][a-z0-9_-]*$`. */
  type: string;
  mediaTypes?: string[];
  /**
   * Key into `AadpServerConfig.securitySchemes`, advertised in the manifest
   * for this resource. This is metadata only — `defineAADP()` does not
   * validate credentials or gate `list`/`get` on it. If set, `list`/`get`
   * MUST enforce it themselves using `args.request`, or the manifest will
   * describe a protection the server does not actually apply.
   */
  security?: string;
  list: (args: ListArgs) => Promise<ListResult<T>> | ListResult<T>;
  get: (args: GetArgs) => Promise<T | null | undefined> | T | null | undefined;
  serialize: (record: T) => Promise<SerializedEntity> | SerializedEntity;
}

export interface ResourceDefinition<T> extends ResourceConfig<T> {
  readonly __aadpResource: true;
}

export interface AadpServerConfig {
  /** Origin the manifest and every resolved URL is published under, e.g. `"https://example.com"`. No trailing slash. */
  baseUrl: string;
  /** Wire protocol version this server publishes. Defaults to `"1.0"` — the only version this package's server runtime currently generates. */
  version?: "1.0";
  application: ManifestV1["application"];
  links?: ManifestV1["links"];
  policies: ManifestV1["policies"];
  usageGuidance?: ManifestV1["usage_guidance"];
  securitySchemes?: ManifestV1["security_schemes"];
  resources: ResourceDefinition<any>[];
  /** `Cache-Control: max-age` for manifest, sitemap and entity responses. Default 300. */
  cacheMaxAgeSeconds?: number;
  /** Page size passed as `limit` to every resource's `list()`. Default 50. */
  pageSize?: number;
}

export interface AadpServer {
  manifest(): ManifestV1;
  sitemapIndex(): SitemapIndexV1;
  sitemap(type: string, cursor?: string | null, request?: Request): Promise<SitemapV1>;
  entity(type: string, id: string, request?: Request): Promise<EntityV1>;
  /** Framework-agnostic Fetch handler — pass directly as a Next.js route handler `GET` export. */
  handleRequest(request: Request): Promise<Response>;
}

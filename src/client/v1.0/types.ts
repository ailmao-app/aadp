/**
 * AADP v1.0 client-side types. Deliberately independent of the v0.1
 * types in `../v0.1/index.ts` — per `docs/records/implementation-record-v1.0.md` Phase
 * 4, v1.0 does not share one loosely-optional interface with v0.1. Field
 * shapes here mirror `schemas/v1.0/manifest.schema.json` and
 * `docs/design/manifest-v1.0-design.md`.
 */

/** Every AADP v1.0 object permits `x_*` extension fields (spec v1.0 §3.1.10). */
interface ExtensionFields {
  [key: `x_${string}`]: unknown;
}

export type SecurityScheme =
  | ({ type: "none" } & ExtensionFields)
  | ({ type: "api_key"; in: "header" | "query"; name: string } & ExtensionFields)
  | ({
      type: "oauth2";
      authorization_url: string;
      token_url?: string;
      scopes?: string[];
    } & ExtensionFields);

export interface ManifestV1 extends ExtensionFields {
  aadp_version: "1.0";
  application: {
    name: string;
    description: string;
    mission?: string;
    categories?: string[];
    publisher: { name: string; url: string } & ExtensionFields;
  } & ExtensionFields;
  links?: {
    homepage?: string;
    feed?: string;
    search?: string;
    profiles?: string;
  } & ExtensionFields;
  discovery: { sitemap_index: string } & ExtensionFields;
  modules?: Array<{ id: string; version: string; schema: string } & ExtensionFields>;
  resources?: Array<
    { type: string; media_types?: string[]; security?: string } & ExtensionFields
  >;
  interfaces?: Array<
    {
      id: string;
      type: string;
      version?: string;
      endpoint?: string;
      documentation?: string;
      security?: string;
    } & ExtensionFields
  >;
  security_schemes?: Record<string, SecurityScheme>;
  policies: {
    robots: string;
    terms: string;
    privacy?: string;
    content_license?: { id: string; url: string } & ExtensionFields;
    adult_content?: "not_published" | "published";
    copyright?: string;
  } & ExtensionFields;
  usage_guidance?: {
    default_language?: string;
    available_languages?: string[];
    summary_preference?: string;
    citation_preference?: string;
    attribution?: {
      preferred_text?: string;
      publisher_url?: string;
    } & ExtensionFields;
  } & ExtensionFields;
}

export interface SitemapIndexV1 extends ExtensionFields {
  aadp_version: "1.0";
  generated_at: string;
  /** sha256:<hex> of canonical `sitemaps` — spec v1.0 §6. */
  checksum: string;
  sitemaps: Array<{ type: string; url: string; count?: number }>;
}

export interface SitemapItemV1 extends ExtensionFields {
  id: string;
  url: string;
  updated_at: string;
  checksum: string;
}

export interface SitemapV1 extends ExtensionFields {
  aadp_version: "1.0";
  type: string;
  generated_at: string;
  /** sha256:<hex> of canonical `items` — spec v1.0 §6. */
  checksum: string;
  items: SitemapItemV1[];
  cursor?: { next: string | null };
}

export interface EntityV1<T = unknown> extends ExtensionFields {
  aadp_version: "1.0";
  id: string;
  type: string;
  checksum: string;
  updated_at: string;
  canonical_url?: string;
  locale?: string;
  data: T;
}

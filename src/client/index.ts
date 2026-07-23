/**
 * Reference AADP client: discovery -> sitemap index -> sitemap -> entity.
 * Deliberately independent of any application/Ailmao type — everything
 * here operates on the generic AADP envelope shapes.
 */

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

export interface AadpErrorEnvelope {
  error: { code: string; message: string; request_id: string };
}

export class AadpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly envelope?: AadpErrorEnvelope
  ) {
    super(message);
    this.name = "AadpRequestError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 304) {
    throw new AadpRequestError("Not modified", 304);
  }
  const body = (await res.json()) as T | AadpErrorEnvelope;
  if (!res.ok) {
    const envelope = body as AadpErrorEnvelope;
    throw new AadpRequestError(
      envelope?.error?.message ?? `Request to ${url} failed with ${res.status}`,
      res.status,
      envelope
    );
  }
  return body as T;
}

export async function discover(originBaseUrl: string): Promise<Manifest> {
  const url = new URL("/.well-known/ai-manifest.json", originBaseUrl).toString();
  return getJson<Manifest>(url);
}

export async function fetchSitemapIndex(url: string): Promise<SitemapIndex> {
  return getJson<SitemapIndex>(url);
}

export async function fetchSitemap(
  url: string,
  cursor?: string | null
): Promise<Sitemap> {
  const target = new URL(url);
  if (cursor) target.searchParams.set("cursor", cursor);
  return getJson<Sitemap>(target.toString());
}

/** Follows `cursor.next` until exhausted, yielding every sitemap item. */
export async function* iterateSitemap(
  sitemapUrl: string
): AsyncGenerator<SitemapItem> {
  let cursor: string | null | undefined = undefined;
  const seenCursors = new Set<string>();
  do {
    const page = await fetchSitemap(sitemapUrl, cursor);
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

export async function fetchEntity<T = unknown>(url: string): Promise<Entity<T>> {
  return getJson<Entity<T>>(url);
}

/** Full discovery walk: manifest -> sitemap index -> every sitemap -> every entity. */
export async function* discoverAllEntities(
  originBaseUrl: string
): AsyncGenerator<Entity> {
  const manifest = await discover(originBaseUrl);
  const index = await fetchSitemapIndex(manifest.sitemap_index);
  for (const sitemapRef of index.sitemaps) {
    for await (const item of iterateSitemap(sitemapRef.url)) {
      yield await fetchEntity(item.url);
    }
  }
}

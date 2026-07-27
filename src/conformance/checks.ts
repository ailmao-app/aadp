/**
 * The AADP v1.0 conformance checks, expressed as plain data + async
 * functions so they can run under the standalone runner, the CLI, or any
 * host test framework. This is the same check set the Vitest suite in
 * `tests/conformance/v1.0/conformance.test.ts` asserts, minus everything
 * that only holds for this repo's own mock server.
 *
 * Rules for anything added here:
 * - Assert only invariants that hold for *every* conformant v1.0 server.
 *   A check that needs a specific fixture dataset belongs in the repo's
 *   own Vitest suite, not in a runner people point at production.
 * - Never require a credential. An interface behind auth is exercised
 *   through its public discovery metadata only.
 * - Never execute or interpret free text a document carries: prompt-like
 *   `usage_guidance` is inert data here, exactly as it must be for a
 *   consumer.
 * - A condition this runner could not reach a verdict on is `skipped`,
 *   never a silent pass.
 */
import {
  discover,
  fetchSitemapIndex,
  fetchSitemap,
  fetchEntity,
  iterateSitemap,
  type ClientOptions,
  type ManifestV1,
  type SitemapIndexV1,
  type SitemapV1,
  type EntityV1,
} from "../client/v1.0/index.js";
import { AadpRequestError } from "../client/errors.js";
import { fetchJson, probeUrl } from "../client/http.js";
import { AadpDiscoveryBudgetExceededError, type DiscoveryBudgetState } from "../client/discovery-budget.js";
import { validateDocument, checkManifestSemantics, type SemanticIssue } from "../validator/index.js";
import { checksumOf } from "../canonical-json/checksum.js";
import type { CheckStatus } from "./types.js";

/** Largest page a conformant server may return (spec v1.0 §5). */
const MAX_PAGE_SIZE = 100;

/** Outcome a check can return instead of passing silently. */
export interface CheckOutcome {
  status: Exclude<CheckStatus, "failed">;
  message?: string;
  details?: string[];
}

/** Thrown by a check to record a non-pass without an exception stack. */
export class CheckSignal extends Error {
  constructor(
    public readonly outcome: CheckOutcome | { status: "failed"; message: string; details?: string[] }
  ) {
    super(outcome.message ?? outcome.status);
    this.name = "CheckSignal";
  }
}

/** Documents already fetched during this run, so later checks reuse them. */
export interface RunState {
  manifestUrl: string;
  /** Raw manifest body, fetched once by `manifest.http` and reused by later checks. */
  manifestRaw?: unknown;
  manifest?: ManifestV1;
  semanticIssues?: SemanticIssue[];
  index?: SitemapIndexV1;
  firstSitemapUrl?: string;
  firstSitemap?: SitemapV1;
  firstEntityUrl?: string;
  firstEntity?: EntityV1;
}

export interface CheckContext {
  baseUrl: string;
  /** Client options (URL policy, timeouts, headers) shared by every request. */
  client: ClientOptions;
  /** Traversal budget shared across every paginating check in the run. */
  budget: DiscoveryBudgetState;
  maxSitemaps: number;
  state: RunState;
  /** Record a non-fatal observation and stop this check. */
  skip(message: string, details?: string[]): never;
  warn(message: string, details?: string[]): never;
  fail(message: string, details?: string[]): never;
}

export interface Check {
  /** Stable id, safe for CI to pin. */
  id: string;
  group: string;
  title: string;
  /** Ids that must have passed; otherwise this check is skipped, not failed. */
  requires?: string[];
  run(ctx: CheckContext): Promise<void | CheckOutcome>;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    // Only reachable if `requires` is wrong for a check — a bug here, not
    // a server defect, so it must not be reported as nonconformance.
    throw new Error(`Conformance runner bug: ${what} was not captured by a prerequisite check`);
  }
  return value;
}

function schemaCheck(kind: "manifest" | "sitemap-index" | "sitemap" | "entity" | "error", data: unknown, ctx: CheckContext): void {
  const result = validateDocument({ version: "1.0", kind, data });
  if (!result.valid) {
    ctx.fail(
      `Document failed the AADP v1.0 ${kind} schema`,
      result.errors.map((err) => `${err.instancePath || "/"} ${err.message ?? ""}`.trim())
    );
  }
}

/** Every URL the manifest advertises to consumers, deduplicated. */
export function collectAdvertisedUrls(manifest: ManifestV1): string[] {
  const urls: string[] = [manifest.policies.robots, manifest.policies.terms];
  if (manifest.policies.privacy) urls.push(manifest.policies.privacy);
  if (manifest.policies.content_license?.url) urls.push(manifest.policies.content_license.url);
  if (manifest.links?.homepage) urls.push(manifest.links.homepage);
  if (manifest.links?.feed) urls.push(manifest.links.feed);
  if (manifest.links?.search) urls.push(manifest.links.search);
  if (manifest.links?.profiles) urls.push(manifest.links.profiles);
  for (const mod of manifest.modules ?? []) urls.push(mod.schema);
  for (const iface of manifest.interfaces ?? []) {
    if (iface.documentation) urls.push(iface.documentation);
    if (iface.endpoint) urls.push(iface.endpoint);
  }
  return [...new Set(urls)];
}

/** Replaces the last path segment of `url`, keeping origin and query. */
function withLastSegment(url: string, segment: string): string {
  const target = new URL(url);
  const segments = target.pathname.split("/");
  segments[segments.length - 1] = segment;
  target.pathname = segments.join("/");
  return target.toString();
}

/**
 * Runs the shared shape assertions for one cache-validated document kind:
 * strong `ETag` equal to the declared checksum, a parseable `Last-Modified`
 * agreeing with the document's own timestamp, and a conditional GET that
 * answers `304` with no body — for both the strong and weak form of the
 * tag (spec v1.0 §7).
 */
async function assertCacheValidators(
  ctx: CheckContext,
  url: string,
  declaredChecksum: string,
  declaredTimestamp: string
): Promise<void> {
  const first = await fetchJson(url, ctx.client);
  const etag = first.headers.get("etag");
  if (!etag) ctx.fail(`${url} returned no ETag; a document carrying a checksum must expose one`);
  const strongTag = etag!.startsWith("W/") ? etag!.slice(2) : etag!;
  if (strongTag !== `"${declaredChecksum}"`) {
    ctx.fail(`${url} has ETag ${etag} but declares checksum "${declaredChecksum}"`);
  }

  const lastModified = first.headers.get("last-modified");
  if (!lastModified) ctx.fail(`${url} returned no Last-Modified header`);
  const lastModifiedMs = Date.parse(lastModified!);
  if (Number.isNaN(lastModifiedMs)) {
    ctx.fail(`${url} has an unparseable Last-Modified value "${lastModified}"`);
  }
  const declaredMs = Date.parse(declaredTimestamp);
  if (Math.abs(lastModifiedMs - declaredMs) > 1000) {
    ctx.fail(
      `${url} Last-Modified (${lastModified}) disagrees with the document's own timestamp (${declaredTimestamp})`
    );
  }

  for (const tag of [etag!, strongTag.startsWith("W/") ? strongTag : `W/${strongTag}`]) {
    const conditional = await fetchJson(url, { ...ctx.client, headers: { ...ctx.client.headers, "If-None-Match": tag } });
    if (conditional.status !== 304) {
      ctx.fail(`${url} answered If-None-Match: ${tag} with ${conditional.status}, expected 304`);
    }
    if (conditional.bodyBytes !== 0) {
      ctx.fail(`${url} returned a ${conditional.bodyBytes}-byte body on a 304 response`);
    }
  }
}

export const CHECKS: Check[] = [
  {
    id: "manifest.http",
    group: "manifest",
    title: "Manifest is served at /.well-known/ai-manifest.json as application/json 200",
    async run(ctx) {
      const result = await fetchJson(ctx.state.manifestUrl, ctx.client);
      if (result.status !== 200) {
        ctx.fail(`${ctx.state.manifestUrl} returned HTTP ${result.status}, expected 200`);
      }
      if (!/^application\/json\b/i.test(result.contentType ?? "")) {
        ctx.fail(`${ctx.state.manifestUrl} has content-type "${result.contentType ?? "(none)"}", expected application/json`);
      }
      ctx.state.manifestRaw = result.data;
    },
  },
  {
    id: "manifest.version",
    group: "manifest",
    title: "Manifest declares aadp_version 1.0",
    requires: ["manifest.http"],
    async run(ctx) {
      const data = ctx.state.manifestRaw;
      const declared = (data as { aadp_version?: unknown } | null)?.aadp_version;
      if (declared !== "1.0") {
        ctx.fail(`Manifest declares aadp_version ${JSON.stringify(declared)}, expected "1.0"`);
      }
    },
  },
  {
    id: "manifest.schema",
    group: "manifest",
    title: "Manifest validates against the AADP v1.0 JSON Schema",
    requires: ["manifest.version"],
    async run(ctx) {
      const data = required(ctx.state.manifestRaw, "manifest body");
      schemaCheck("manifest", data, ctx);
      ctx.state.manifest = data as ManifestV1;
    },
  },
  {
    id: "manifest.semantic",
    group: "manifest",
    title: "Manifest passes semantic validation (reference integrity, no placeholder or secret-shaped values)",
    requires: ["manifest.schema"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      const issues = checkManifestSemantics(manifest);
      ctx.state.semanticIssues = issues;
      const format = (issue: SemanticIssue) => `${issue.level}: ${issue.code} at ${issue.path} — ${issue.message}`;
      const errors = issues.filter((issue) => issue.level === "error");
      if (errors.length > 0) {
        ctx.fail(`Manifest has ${errors.length} semantic error(s)`, issues.map(format));
      }
      if (issues.length > 0) {
        ctx.warn(`Manifest has ${issues.length} semantic warning(s)`, issues.map(format));
      }
    },
  },
  {
    id: "manifest.discovery_entry_point",
    group: "manifest",
    title: "discovery.sitemap_index is an http(s) URL usable as the enumeration entry point",
    requires: ["manifest.schema"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      const raw = manifest.discovery.sitemap_index;
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        ctx.fail(`discovery.sitemap_index "${raw}" is not an absolute URL`);
      }
      if (!/^https?:$/.test(parsed!.protocol)) {
        ctx.fail(`discovery.sitemap_index "${raw}" uses scheme "${parsed!.protocol}", expected http(s)`);
      }
    },
  },
  {
    id: "discovery.manifest_usable",
    group: "discovery",
    title: "The reference client can discover the origin without falling back or trusting unvalidated URLs",
    requires: ["manifest.discovery_entry_point"],
    async run(ctx) {
      // Re-runs the whole discover() contract (fetch, version gate, schema,
      // semantic gate) through the public client entry point, so the run
      // proves the documented consumer API works — not just that the
      // pieces do individually.
      await discover(ctx.baseUrl, ctx.client);
    },
  },
  {
    id: "traversal.sitemap_index",
    group: "traversal",
    title: "Sitemap index validates and its checksum matches its own sitemaps payload",
    requires: ["discovery.manifest_usable"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      // fetchSitemapIndex already schema-validates and recomputes the
      // checksum; a mismatch surfaces as a thrown client error, which the
      // runner records as a failure.
      const index = await fetchSitemapIndex(manifest.discovery.sitemap_index, ctx.client);
      ctx.state.index = index;
      if (index.sitemaps.length > ctx.maxSitemaps) {
        ctx.fail(
          `Sitemap index declares ${index.sitemaps.length} sitemaps, above this run's maxSitemaps limit of ${ctx.maxSitemaps}`
        );
      }
      if (index.checksum !== checksumOf(index.sitemaps)) {
        ctx.fail(`Sitemap index checksum "${index.checksum}" does not match its sitemaps payload`);
      }
      if (index.sitemaps.length === 0) {
        ctx.skip("Sitemap index publishes no sitemaps; there is nothing to enumerate");
      }
    },
  },
  {
    id: "traversal.sitemap",
    group: "traversal",
    title: "First sitemap validates, checksums, and namespaces its item ids with its own type",
    requires: ["traversal.sitemap_index"],
    async run(ctx) {
      const index = required(ctx.state.index, "sitemap index");
      const ref = index.sitemaps[0];
      const sitemap = await fetchSitemap(ref.url, null, ctx.client);
      ctx.state.firstSitemapUrl = ref.url;
      ctx.state.firstSitemap = sitemap;

      if (sitemap.type !== ref.type) {
        ctx.fail(`Sitemap at ${ref.url} declares type "${sitemap.type}" but the index lists it as "${ref.type}"`);
      }
      if (sitemap.checksum !== checksumOf(sitemap.items)) {
        ctx.fail(`Sitemap at ${ref.url} has checksum "${sitemap.checksum}" that does not match its items payload`);
      }
      const misnamed = sitemap.items.filter((item) => !item.id.startsWith(`${sitemap.type}:`));
      if (misnamed.length > 0) {
        ctx.fail(
          `${misnamed.length} item id(s) are not namespaced with the sitemap type "${sitemap.type}"`,
          misnamed.slice(0, 5).map((item) => item.id)
        );
      }
      if (sitemap.items.length === 0) {
        ctx.skip(`Sitemap at ${ref.url} publishes no items; there is no entity to exercise`);
      }
    },
  },
  {
    id: "traversal.entity",
    group: "traversal",
    title: "First entity agrees with its sitemap item on id, type and checksum",
    requires: ["traversal.sitemap"],
    async run(ctx) {
      const sitemap = required(ctx.state.firstSitemap, "first sitemap");
      const item = sitemap.items[0];
      const entity = await fetchEntity(item.url, ctx.client);
      ctx.state.firstEntityUrl = item.url;
      ctx.state.firstEntity = entity;

      if (entity.id !== item.id) ctx.fail(`Entity at ${item.url} has id "${entity.id}", sitemap item says "${item.id}"`);
      if (entity.type !== sitemap.type) {
        ctx.fail(`Entity at ${item.url} has type "${entity.type}", its sitemap namespace is "${sitemap.type}"`);
      }
      if (entity.checksum !== item.checksum) {
        ctx.fail(`Entity at ${item.url} has checksum "${entity.checksum}", sitemap item says "${item.checksum}"`);
      }
      if (entity.checksum !== checksumOf(entity.data)) {
        ctx.fail(`Entity at ${item.url} declares a checksum that does not match its own data payload`);
      }
    },
  },
  {
    id: "pagination.contract",
    group: "pagination",
    title: "Pages stay within the size cap, terminate at cursor.next = null, and never repeat an id",
    requires: ["traversal.sitemap_index"],
    async run(ctx) {
      const index = required(ctx.state.index, "sitemap index");
      let budgetStop: string | undefined;
      for (const ref of index.sitemaps) {
        const first = await fetchSitemap(ref.url, null, ctx.client);
        if (first.items.length > MAX_PAGE_SIZE) {
          ctx.fail(`Sitemap ${ref.url} returned ${first.items.length} items, above the ${MAX_PAGE_SIZE}-item page cap`);
        }
        const seen = new Set<string>();
        try {
          for await (const item of iterateSitemap(ref.url, { ...ctx.client, expectedType: ref.type, budget: ctx.budget })) {
            if (seen.has(item.id)) {
              ctx.fail(`Sitemap ${ref.url} yielded id "${item.id}" on more than one page`);
            }
            seen.add(item.id);
          }
        } catch (err) {
          if (!(err instanceof AadpDiscoveryBudgetExceededError)) throw err;
          budgetStop = err.message;
          break;
        }
      }
      if (budgetStop) {
        ctx.skip(`Pagination walk stopped early by this run's traversal budget: ${budgetStop}`);
      }
    },
  },
  {
    id: "http.cache.sitemap_index",
    group: "http",
    title: "Sitemap index exposes ETag/Last-Modified and answers a conditional GET with an empty 304",
    requires: ["traversal.sitemap_index"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      const index = required(ctx.state.index, "sitemap index");
      await assertCacheValidators(ctx, manifest.discovery.sitemap_index, index.checksum, index.generated_at);
    },
  },
  {
    id: "http.cache.sitemap",
    group: "http",
    title: "Sitemap exposes ETag/Last-Modified and answers a conditional GET with an empty 304",
    requires: ["traversal.sitemap"],
    async run(ctx) {
      const url = required(ctx.state.firstSitemapUrl, "first sitemap url");
      const sitemap = required(ctx.state.firstSitemap, "first sitemap");
      await assertCacheValidators(ctx, url, sitemap.checksum, sitemap.generated_at);
    },
  },
  {
    id: "http.cache.entity",
    group: "http",
    title: "Entity exposes ETag/Last-Modified and answers a conditional GET with an empty 304",
    requires: ["traversal.entity"],
    async run(ctx) {
      const url = required(ctx.state.firstEntityUrl, "first entity url");
      const entity = required(ctx.state.firstEntity, "first entity");
      await assertCacheValidators(ctx, url, entity.checksum, entity.updated_at);
    },
  },
  {
    id: "links.no_dead_urls",
    group: "links",
    title: "No URL the manifest advertises is a dead link",
    requires: ["manifest.schema"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      const urls = collectAdvertisedUrls(manifest);
      if (urls.length === 0) {
        ctx.skip("Manifest advertises no policy, link, module or interface URL");
      }
      const dead: string[] = [];
      const unreachable: string[] = [];
      for (const url of urls) {
        try {
          // Body discarded and content type unchecked: these are ordinary
          // web pages, not AADP documents.
          const probe = await probeUrl(url, ctx.client);
          if (probe.status === 404 || probe.status === 410) dead.push(`${url} -> HTTP ${probe.status}`);
        } catch (err) {
          unreachable.push(`${url} -> ${(err as Error).message}`);
        }
      }
      if (dead.length > 0) {
        ctx.fail(`${dead.length} advertised URL(s) do not exist`, [...dead, ...unreachable]);
      }
      if (unreachable.length > 0) {
        // A transport failure is not proof the URL is unpublished (network
        // policy, TLS, rate limiting), so it is reported rather than
        // treated as nonconformance.
        ctx.warn(`${unreachable.length} advertised URL(s) could not be reached from this runner`, unreachable);
      }
    },
  },
  {
    id: "errors.not_found",
    group: "errors",
    title: "Unknown entity id returns 404 with a schema-valid not_found envelope",
    requires: ["traversal.entity"],
    async run(ctx) {
      const sampleUrl = required(ctx.state.firstEntityUrl, "first entity url");
      const target = withLastSegment(sampleUrl, "aadp-conformance-runner-does-not-exist.json");
      const err = await captureRequestError(() => fetchEntity(target, ctx.client), ctx, target);
      if (err.status !== 404) ctx.fail(`${target} returned HTTP ${err.status}, expected 404`);
      if (!err.envelope) ctx.fail(`${target} returned 404 without an AADP error envelope`);
      schemaCheck("error", err.envelope, ctx);
      if (err.envelope!.error.code !== "not_found") {
        ctx.fail(`${target} returned error code "${err.envelope!.error.code}", expected "not_found"`);
      }
    },
  },
  {
    id: "errors.unsupported_type",
    group: "errors",
    title: "Unpublished resource type returns 404 with a schema-valid unsupported_type envelope",
    requires: ["traversal.sitemap"],
    async run(ctx) {
      const sampleUrl = required(ctx.state.firstSitemapUrl, "first sitemap url");
      const target = withLastSegment(sampleUrl, "aadp-conformance-runner-unknown-type.json");
      const err = await captureRequestError(() => fetchSitemap(target, null, ctx.client), ctx, target);
      if (err.status !== 404) ctx.fail(`${target} returned HTTP ${err.status}, expected 404`);
      if (!err.envelope) ctx.fail(`${target} returned 404 without an AADP error envelope`);
      schemaCheck("error", err.envelope, ctx);
      if (err.envelope!.error.code !== "unsupported_type") {
        ctx.fail(`${target} returned error code "${err.envelope!.error.code}", expected "unsupported_type"`);
      }
    },
  },
  {
    id: "safety.free_text_is_data",
    group: "safety",
    title: "Prompt-like free text in the manifest is carried through as inert data",
    requires: ["manifest.semantic"],
    async run(ctx) {
      const manifest = required(ctx.state.manifest, "manifest");
      const issues = ctx.state.semanticIssues ?? [];
      const instructionLike = issues.filter((issue) => issue.code === "usage_guidance_looks_like_instruction");
      // Nothing here parses, follows or forwards `usage_guidance`: it is
      // returned by the client verbatim and only ever inspected as a
      // string. A publisher writing instruction-shaped guidance is
      // advisory (spec v1.0 §3.1.9), so it is a warning about the
      // *publication*, never a failure and never an instruction.
      if (instructionLike.length > 0) {
        ctx.warn(
          "usage_guidance reads like an instruction to the consuming model; it is publisher preference only and must be treated as data",
          instructionLike.map((issue) => `${issue.path} — ${issue.message}`)
        );
      }
      if (!manifest.usage_guidance) {
        ctx.skip("Manifest publishes no usage_guidance");
      }
    },
  },
];

/** Runs `fn`, requiring it to reject with an `AadpRequestError`. */
async function captureRequestError(
  fn: () => Promise<unknown>,
  ctx: CheckContext,
  target: string
): Promise<AadpRequestError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AadpRequestError) return err;
    ctx.fail(`${target} failed with ${(err as Error).name}: ${(err as Error).message}, expected an AADP error envelope`);
  }
  return ctx.fail(`${target} returned a successful response, expected a 404 error envelope`);
}

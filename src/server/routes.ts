/**
 * AADP server route templates — see `docs/vi/SERVER_CUSTOM_ROUTES_IMPLEMENTATION_PLAN.md`.
 *
 * Owns the one thing `runtime.ts` must never do itself: turn an
 * `AadpRouteConfig` (or the built-in `/ai/v{version}/...` default) into both
 * a URL builder and an inbound-request matcher, compiled once from the same
 * tokenized template so the two can never drift apart from each other.
 */
import { invalidRequest } from "./errors.js";
import type { AadpRouteConfig } from "./types.js";

export type { AadpRouteConfig } from "./types.js";

/** Fixed discovery entry point — never configurable, never part of `AadpRouteConfig`. */
export const WELL_KNOWN_PATH = "/.well-known/ai-manifest.json";

export type AadpRouteName = "sitemapIndex" | "sitemap" | "entity";

export type AadpRouteMatch =
  | { kind: "sitemap-index" }
  | { kind: "sitemap"; type: string }
  | { kind: "entity"; type: string; id: string };

export interface AadpRouteResolver {
  readonly paths: {
    sitemapIndex: string;
  };
  sitemapPath(type: string): string;
  entityPath(type: string, id: string): string;
  sitemapIndexUrl(baseUrl: string): string;
  sitemapUrl(baseUrl: string, type: string): string;
  entityUrl(baseUrl: string, type: string, id: string): string;
  match(pathname: string): AadpRouteMatch | null;
}

type PlaceholderName = "type" | "id";
type SegmentToken = { kind: "literal"; value: string } | { kind: "placeholder"; name: PlaceholderName };

interface CompiledSegment {
  tokens: SegmentToken[];
  /** Convenience: the segment's one placeholder, if any — segments with 0 or 1 placeholder only, enforced by the tokenizer. */
  placeholder?: PlaceholderName;
}

interface CompiledTemplate {
  routeName: AadpRouteName | "well-known";
  raw: string;
  segments: CompiledSegment[];
}

interface SegmentMatcher {
  regex: RegExp;
  placeholder?: PlaceholderName;
}

function configError(routeName: string, raw: string, reason: string): Error {
  return new Error(`defineAADP(): routes.${routeName} "${raw}" is invalid — ${reason}.`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A malformed percent-encoded route segment is a client request error, not a config bug — mirrors the decode-boundary contract `runtime.ts` already applies to entity/sitemap ids. */
function safeDecodeSegment(value: string, pathname: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidRequest(`Malformed percent-encoding in path "${pathname}".`);
  }
}

function tokenizeSegment(segment: string, routeName: string, raw: string): SegmentToken[] {
  const tokens: SegmentToken[] = [];
  let literalBuf = "";
  let i = 0;
  const flush = () => {
    if (literalBuf) {
      tokens.push({ kind: "literal", value: literalBuf });
      literalBuf = "";
    }
  };
  while (i < segment.length) {
    const ch = segment[i];
    if (ch === "{") {
      const close = segment.indexOf("}", i);
      if (close === -1) {
        throw configError(routeName, raw, `unterminated "{" in segment "${segment}"`);
      }
      const name = segment.slice(i + 1, close);
      if (name !== "type" && name !== "id") {
        throw configError(routeName, raw, `"{${name}}" is not a supported placeholder (only {type} and {id} are)`);
      }
      flush();
      tokens.push({ kind: "placeholder", name });
      i = close + 1;
    } else if (ch === "}") {
      throw configError(routeName, raw, `stray "}" with no matching "{" in segment "${segment}"`);
    } else {
      literalBuf += ch;
      i++;
    }
  }
  flush();
  const placeholderCount = tokens.filter((t) => t.kind === "placeholder").length;
  if (placeholderCount > 1) {
    throw configError(routeName, raw, `segment "${segment}" has more than one placeholder, which is ambiguous`);
  }
  return tokens;
}

const CONTROL_OR_BACKSLASH = /[\\\x00-\x1F\x7F]/;

/**
 * WHATWG URL Standard "path percent-encode set": the C0 control
 * percent-encode set (C0 controls and every code point above U+007E) plus
 * space, `"`, `#`, `<`, `>`, `?`, `` ` ``, `{` and `}`. This is exactly what
 * `new URL(...)` — and therefore `new Request(...)`/`fetch()` and this
 * package's own `handleRequest()` reading `new URL(request.url).pathname`
 * — normalizes a raw path literal to. A config literal canonicalized any
 * other way (or not at all) would make `buildPath()` publish a URL that
 * `match()` can never recognize once round-tripped through a real request.
 */
const PATH_PERCENT_ENCODE_BYTES = new Set([0x20, 0x22, 0x23, 0x3c, 0x3e, 0x3f, 0x60, 0x7b, 0x7d]);

/** Canonicalizes one literal path token to the same percent-encoded form `new URL()` would produce — leaves an existing `%XX` triplet untouched (`%` itself is not in the path percent-encode set), so it is never double-encoded. */
function canonicalizePathLiteral(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let out = "";
  for (const byte of bytes) {
    if (byte <= 0x1f || byte > 0x7e || PATH_PERCENT_ENCODE_BYTES.has(byte)) {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

function compileTemplate(routeName: AadpRouteName | "well-known", raw: string): CompiledTemplate {
  if (typeof raw !== "string" || raw.length === 0) {
    throw configError(routeName, String(raw), "must be a non-empty string");
  }
  if (CONTROL_OR_BACKSLASH.test(raw)) {
    throw configError(routeName, raw, "must not contain a backslash or control character");
  }
  if (raw.includes("?") || raw.includes("#")) {
    throw configError(routeName, raw, "must not contain a query string or fragment");
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    throw configError(routeName, raw, "must be an origin-relative pathname starting with exactly one \"/\"");
  }
  if (raw.includes("://")) {
    throw configError(routeName, raw, "must not contain a scheme or authority");
  }
  const rest = raw.slice(1);
  if (rest === "") {
    throw configError(routeName, raw, "must contain at least one path segment");
  }
  const rawSegments = rest.split("/");
  const segments: CompiledSegment[] = rawSegments.map((rawSegment) => {
    if (rawSegment === "") {
      throw configError(routeName, raw, "must not contain an empty path segment (\"//\" or a trailing \"/\")");
    }
    const tokens = tokenizeSegment(rawSegment, routeName, raw);
    const isFullyLiteral = tokens.every((t) => t.kind === "literal");
    if (isFullyLiteral) {
      const decoded = safeDecodeStatic(rawSegment, routeName, raw);
      if (decoded === "." || decoded === "..") {
        throw configError(routeName, raw, `must not contain a dot segment ("${rawSegment}")`);
      }
    }
    // Validate every literal token's percent-encoding syntax — not just a
    // fully-literal segment's — so `/maps/%ZZ-{type}` fails here instead of
    // silently publishing a literal with a malformed escape. Then
    // canonicalize it to the exact form `new URL()` would produce, so the
    // regex built from `token.value` (matcher, builder, collision
    // detection — all three read `token.value`) matches what an inbound
    // request's normalized pathname actually contains.
    for (const token of tokens) {
      if (token.kind === "literal") {
        safeDecodeStatic(token.value, routeName, raw);
        token.value = canonicalizePathLiteral(token.value);
      }
    }
    const placeholder = tokens.find((t): t is Extract<SegmentToken, { kind: "placeholder" }> => t.kind === "placeholder")?.name;
    return { tokens, placeholder };
  });
  return { routeName, raw, segments };
}

/** Decoding a *static config string* — unlike `safeDecodeSegment`, a malformed escape here is a `defineAADP()`-time config bug, not a per-request client error. */
function safeDecodeStatic(segment: string, routeName: string, raw: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw configError(routeName, raw, `contains malformed percent-encoding ("${segment}")`);
  }
}

function requirePlaceholders(template: CompiledTemplate, required: PlaceholderName[], forbidden: PlaceholderName[]): void {
  const present = new Map<PlaceholderName, number>();
  for (const segment of template.segments) {
    if (segment.placeholder) {
      present.set(segment.placeholder, (present.get(segment.placeholder) ?? 0) + 1);
    }
  }
  for (const name of required) {
    const count = present.get(name) ?? 0;
    if (count !== 1) {
      throw configError(
        template.routeName,
        template.raw,
        `must contain exactly one {${name}} placeholder (found ${count})`
      );
    }
  }
  for (const name of forbidden) {
    if (present.has(name)) {
      throw configError(template.routeName, template.raw, `must not contain a {${name}} placeholder`);
    }
  }
}

function buildPath(template: CompiledTemplate, params: { type?: string; id?: string }): string {
  return (
    "/" +
    template.segments
      .map((segment) =>
        segment.tokens
          .map((token) =>
            token.kind === "literal" ? token.value : encodeURIComponent(params[token.name] as string)
          )
          .join("")
      )
      .join("/")
  );
}

function segmentMatcher(segment: CompiledSegment): SegmentMatcher {
  if (!segment.placeholder) {
    const literal = segment.tokens.map((t) => (t as { kind: "literal"; value: string }).value).join("");
    return { regex: new RegExp(`^${escapeRegex(literal)}$`) };
  }
  const idx = segment.tokens.findIndex((t) => t.kind === "placeholder");
  const prefix = segment.tokens
    .slice(0, idx)
    .map((t) => (t as { kind: "literal"; value: string }).value)
    .join("");
  const suffix = segment.tokens
    .slice(idx + 1)
    .map((t) => (t as { kind: "literal"; value: string }).value)
    .join("");
  return {
    regex: new RegExp(`^${escapeRegex(prefix)}(.+?)${escapeRegex(suffix)}$`),
    placeholder: segment.placeholder,
  };
}

/** Literal value of a fully-literal segment, or `undefined` if it carries a placeholder. */
function literalOf(segment: CompiledSegment): string | undefined {
  if (segment.placeholder) return undefined;
  return segment.tokens.map((t) => (t as { kind: "literal"; value: string }).value).join("");
}

function prefixSuffixOf(segment: CompiledSegment): [string, string] {
  const idx = segment.tokens.findIndex((t) => t.kind === "placeholder");
  const prefix = segment.tokens
    .slice(0, idx)
    .map((t) => (t as { kind: "literal"; value: string }).value)
    .join("");
  const suffix = segment.tokens
    .slice(idx + 1)
    .map((t) => (t as { kind: "literal"; value: string }).value)
    .join("");
  return [prefix, suffix];
}

/**
 * Whether some inbound pathname segment could satisfy both `a` and `b`.
 * Literal-vs-literal is exact; literal-vs-placeholder tests the literal
 * against the placeholder's compiled regex. Placeholder-vs-placeholder is a
 * conservative heuristic (prefix/suffix nesting) rather than full regex
 * intersection — sound for the shapes this module can produce (at most one
 * placeholder per segment), which is all three built-in route kinds ever are.
 */
function segmentsCouldCollide(a: CompiledSegment, b: CompiledSegment): boolean {
  const literalA = literalOf(a);
  const literalB = literalOf(b);
  if (literalA !== undefined && literalB !== undefined) {
    return literalA === literalB;
  }
  if (literalA !== undefined) {
    return segmentMatcher(b).regex.test(literalA);
  }
  if (literalB !== undefined) {
    return segmentMatcher(a).regex.test(literalB);
  }
  const [prefixA, suffixA] = prefixSuffixOf(a);
  const [prefixB, suffixB] = prefixSuffixOf(b);
  const prefixCompatible = prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA);
  const suffixCompatible = suffixA.endsWith(suffixB) || suffixB.endsWith(suffixA);
  return prefixCompatible && suffixCompatible;
}

function templatesCouldCollide(a: CompiledTemplate, b: CompiledTemplate): boolean {
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every((segment, i) => segmentsCouldCollide(segment, b.segments[i]));
}

function assertNoCollision(a: CompiledTemplate, b: CompiledTemplate): void {
  if (templatesCouldCollide(a, b)) {
    throw new Error(
      `defineAADP(): routes.${a.routeName === "well-known" ? b.routeName : a.routeName} "${a.raw}" collides with ` +
        `${b.routeName === "well-known" ? "the well-known manifest path" : `routes.${b.routeName} "${b.raw}"`} ` +
        `"${b.raw}" — some pathname could match both.`
    );
  }
}

function defaultTemplates(version: string): Record<AadpRouteName, string> {
  return {
    sitemapIndex: `/ai/v${version}/sitemap-index.json`,
    sitemap: `/ai/v${version}/sitemaps/{type}.json`,
    entity: `/ai/v${version}/entities/{type}/{id}.json`,
  };
}

export function compileAadpRoutes(version: string, config?: AadpRouteConfig): AadpRouteResolver {
  const defaults = defaultTemplates(version);
  const rawTemplates: Record<AadpRouteName, string> = {
    sitemapIndex: config?.sitemapIndex ?? defaults.sitemapIndex,
    sitemap: config?.sitemap ?? defaults.sitemap,
    entity: config?.entity ?? defaults.entity,
  };

  const sitemapIndexTemplate = compileTemplate("sitemapIndex", rawTemplates.sitemapIndex);
  const sitemapTemplate = compileTemplate("sitemap", rawTemplates.sitemap);
  const entityTemplate = compileTemplate("entity", rawTemplates.entity);

  requirePlaceholders(sitemapIndexTemplate, [], ["type", "id"]);
  requirePlaceholders(sitemapTemplate, ["type"], ["id"]);
  requirePlaceholders(entityTemplate, ["type", "id"], []);

  const wellKnownTemplate: CompiledTemplate = {
    routeName: "well-known",
    raw: WELL_KNOWN_PATH,
    segments: WELL_KNOWN_PATH.slice(1)
      .split("/")
      .map((value) => ({ tokens: [{ kind: "literal", value }] })),
  };

  assertNoCollision(sitemapIndexTemplate, wellKnownTemplate);
  assertNoCollision(sitemapTemplate, wellKnownTemplate);
  assertNoCollision(entityTemplate, wellKnownTemplate);
  assertNoCollision(sitemapIndexTemplate, sitemapTemplate);
  assertNoCollision(sitemapIndexTemplate, entityTemplate);
  assertNoCollision(sitemapTemplate, entityTemplate);

  const templatesInMatchOrder = [sitemapIndexTemplate, sitemapTemplate, entityTemplate];
  const matchersByTemplate = new Map<CompiledTemplate, SegmentMatcher[]>(
    templatesInMatchOrder.map((template) => [template, template.segments.map(segmentMatcher)])
  );

  const sitemapIndexPath = buildPath(sitemapIndexTemplate, {});

  function sitemapPath(type: string): string {
    return buildPath(sitemapTemplate, { type });
  }

  function entityPath(type: string, id: string): string {
    return buildPath(entityTemplate, { type, id });
  }

  function match(pathname: string): AadpRouteMatch | null {
    if (!pathname.startsWith("/")) return null;
    const rawSegments = pathname.slice(1).split("/");
    for (const template of templatesInMatchOrder) {
      if (template.segments.length !== rawSegments.length) continue;
      const matchers = matchersByTemplate.get(template)!;
      const captured: Partial<Record<PlaceholderName, string>> = {};
      let ok = true;
      for (let i = 0; i < rawSegments.length; i++) {
        const result = matchers[i].regex.exec(rawSegments[i]);
        if (!result) {
          ok = false;
          break;
        }
        if (matchers[i].placeholder) {
          captured[matchers[i].placeholder!] = result[1];
        }
      }
      if (!ok) continue;
      if (template.routeName === "sitemapIndex") return { kind: "sitemap-index" };
      if (template.routeName === "sitemap") {
        return { kind: "sitemap", type: safeDecodeSegment(captured.type!, pathname) };
      }
      return {
        kind: "entity",
        type: safeDecodeSegment(captured.type!, pathname),
        id: safeDecodeSegment(captured.id!, pathname),
      };
    }
    return null;
  }

  return {
    paths: { sitemapIndex: sitemapIndexPath },
    sitemapPath,
    entityPath,
    sitemapIndexUrl: (baseUrl: string) => `${baseUrl}${sitemapIndexPath}`,
    sitemapUrl: (baseUrl: string, type: string) => `${baseUrl}${sitemapPath(type)}`,
    entityUrl: (baseUrl: string, type: string, id: string) => `${baseUrl}${entityPath(type, id)}`,
    match,
  };
}

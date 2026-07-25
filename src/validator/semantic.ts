/**
 * AADP v1.0 manifest semantic validator. Pure functions only — no HTTP,
 * no filesystem access. Input MUST already be schema-valid
 * (`validateDocument({ version: "1.0", kind: "manifest", data })`); this
 * module checks constraints JSON Schema cannot express: cross-field
 * references, uniqueness by key, and heuristic content checks.
 *
 * Reference-URL reachability and cross-document consistency (e.g.
 * `resources[].type` vs the live sitemap index) are conformance-suite
 * concerns (Phase 5), not semantic-validator concerns — see ADR-0005
 * "Resource authority" and `docs/IMPLEMENTATION_PLAN.md` §4
 * ("Validator không tự thực hiện HTTP request").
 */

export type SemanticIssueLevel = "error" | "warning";

export interface SemanticIssue {
  level: SemanticIssueLevel;
  /** Stable machine-readable code, e.g. "duplicate_module_id". */
  code: string;
  /** JSON-pointer-style path into the manifest document. */
  path: string;
  message: string;
}

interface ManifestLike {
  application?: { publisher?: { url?: unknown } };
  links?: Record<string, unknown>;
  discovery?: { sitemap_index?: unknown };
  modules?: Array<{ id?: unknown; version?: unknown; schema?: unknown }>;
  resources?: Array<{ type?: unknown; security?: unknown }>;
  interfaces?: Array<{
    id?: unknown;
    endpoint?: unknown;
    documentation?: unknown;
    security?: unknown;
  }>;
  security_schemes?: Record<
    string,
    { type?: unknown; authorization_url?: unknown; token_url?: unknown }
  >;
  policies?: Record<string, unknown>;
  usage_guidance?: {
    default_language?: unknown;
    available_languages?: unknown;
    summary_preference?: unknown;
    citation_preference?: unknown;
    attribution?: { preferred_text?: unknown; publisher_url?: unknown };
  };
  [key: string]: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * Known placeholder/example hosts. This is deliberately narrow (exact
 * host or subdomain match, not a substring match) so a real domain that
 * happens to contain "example" as a word fragment (unlikely, but
 * possible) is not falsely flagged.
 */
const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "test.com",
  "your-domain.com",
]);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isPlaceholderUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (PLACEHOLDER_HOSTS.has(host)) return true;
  // subdomains of a placeholder host, e.g. api.example.com
  for (const placeholder of PLACEHOLDER_HOSTS) {
    if (host.endsWith(`.${placeholder}`)) return true;
  }
  return false;
}

/**
 * Credential-shaped value patterns. Each is a well-known, high-confidence
 * secret format (cloud provider key prefixes, JWT structure, bearer
 * token framing) — deliberately not a generic "looks like a random
 * string" heuristic, which would drown real findings in false positives
 * from checksums, IDs and the like.
 */
const SECRET_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "aws_access_key_id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "google_api_key", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { code: "openai_style_secret_key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { code: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/ },
];

/**
 * Advisory only: multiple independent signals, not a single regex, per
 * the spec's explicit caution against naive prompt-injection detection.
 * A `usage_guidance_looks_like_instruction` warning is NOT a security
 * boundary — the reference client MUST treat every `usage_guidance`
 * field as untrusted data regardless of whether this heuristic fires or
 * stays silent (spec v1.0 §3.1.9).
 */
const INSTRUCTION_SIGNALS: RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i,
  /\byou\s+must\s+(now\s+)?(always|never)\b/i,
  /\bsystem\s*:\s*/i,
  /\bdisregard\s+(the\s+)?(policy|policies|guidelines?)\b/i,
  /\bact\s+as\s+(if|though)\b/i,
];

function walkStrings(
  value: unknown,
  path: string,
  visit: (path: string, value: string) => void
): void {
  if (isString(value)) {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkStrings(item, `${path}/${i}`, visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(v, `${path}/${key}`, visit);
    }
  }
}

function findDuplicates<T>(
  items: T[],
  keyOf: (item: T) => string | undefined
): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = keyOf(item);
    if (key === undefined) return;
    const indices = seen.get(key) ?? [];
    indices.push(i);
    seen.set(key, indices);
  });
  const duplicates = new Map<string, number[]>();
  for (const [key, indices] of seen) {
    if (indices.length > 1) duplicates.set(key, indices);
  }
  return duplicates;
}

function checkUsageGuidanceLanguage(manifest: ManifestLike, issues: SemanticIssue[]): void {
  const ug = manifest.usage_guidance;
  if (!ug) return;
  const { default_language, available_languages } = ug;
  if (!isString(default_language) || !Array.isArray(available_languages)) return;
  const available = available_languages.filter(isString);
  if (!available.includes(default_language)) {
    issues.push({
      level: "error",
      code: "default_language_not_available",
      path: "/usage_guidance/default_language",
      message: `usage_guidance.default_language "${default_language}" is not present in usage_guidance.available_languages [${available.join(", ")}].`,
    });
  }
}

function checkModuleUniqueness(manifest: ManifestLike, issues: SemanticIssue[]): void {
  const modules = manifest.modules;
  if (!Array.isArray(modules)) return;
  const duplicates = findDuplicates(modules, (m) => (isString(m.id) ? m.id : undefined));
  for (const [id, indices] of duplicates) {
    issues.push({
      level: "error",
      code: "duplicate_module_id",
      path: `/modules/${indices[1]}/id`,
      message: `Module id "${id}" appears more than once (indices ${indices.join(", ")}); each module id MUST appear at most once in manifest.modules.`,
    });
  }
}

function checkResourceTypeUniqueness(manifest: ManifestLike, issues: SemanticIssue[]): void {
  const resources = manifest.resources;
  if (!Array.isArray(resources)) return;
  const duplicates = findDuplicates(resources, (r) => (isString(r.type) ? r.type : undefined));
  for (const [type, indices] of duplicates) {
    issues.push({
      level: "error",
      code: "duplicate_resource_type",
      path: `/resources/${indices[1]}/type`,
      message: `Resource type "${type}" appears more than once (indices ${indices.join(", ")}); each type MUST appear at most once in manifest.resources.`,
    });
  }
}

function checkInterfaceIdUniqueness(manifest: ManifestLike, issues: SemanticIssue[]): void {
  const interfaces = manifest.interfaces;
  if (!Array.isArray(interfaces)) return;
  const duplicates = findDuplicates(interfaces, (i) => (isString(i.id) ? i.id : undefined));
  for (const [id, indices] of duplicates) {
    issues.push({
      level: "error",
      code: "duplicate_interface_id",
      path: `/interfaces/${indices[1]}/id`,
      message: `Interface id "${id}" appears more than once (indices ${indices.join(", ")}); each interface id MUST be unique.`,
    });
  }
}

function checkSecurityReferences(manifest: ManifestLike, issues: SemanticIssue[]): void {
  const references: Array<{ path: string; scheme: string }> = [];

  (manifest.resources ?? []).forEach((r, i) => {
    if (isString(r.security)) {
      references.push({ path: `/resources/${i}/security`, scheme: r.security });
    }
  });
  (manifest.interfaces ?? []).forEach((iface, i) => {
    if (isString(iface.security)) {
      references.push({ path: `/interfaces/${i}/security`, scheme: iface.security });
    }
  });

  if (references.length === 0) return;

  const schemes = manifest.security_schemes;
  if (!schemes) {
    for (const ref of references) {
      issues.push({
        level: "error",
        code: "missing_security_schemes",
        path: ref.path,
        message: `"${ref.path}" references security scheme "${ref.scheme}", but manifest.security_schemes is absent. security_schemes is conditionally required whenever any resource/interface references a scheme (ADR-0005).`,
      });
    }
    return;
  }

  for (const ref of references) {
    if (!(ref.scheme in schemes)) {
      issues.push({
        level: "error",
        code: "unknown_security_scheme_reference",
        path: ref.path,
        message: `"${ref.path}" references security scheme "${ref.scheme}", which does not exist in manifest.security_schemes.`,
      });
    }
  }
}

function checkInterfaceEndpoints(manifest: ManifestLike, issues: SemanticIssue[]): void {
  (manifest.interfaces ?? []).forEach((iface, i) => {
    if (!isString(iface.endpoint) && !isString(iface.documentation)) {
      issues.push({
        level: "error",
        code: "interface_not_resolvable",
        path: `/interfaces/${i}`,
        message: `Interface at index ${i} has neither "endpoint" nor "documentation" — a discoverable interface MUST resolve to something.`,
      });
    }
  });
}

function checkPlaceholderUrls(manifest: ManifestLike, issues: SemanticIssue[]): void {
  walkStrings(manifest, "", (path, value) => {
    if (!/^https?:\/\//i.test(value)) return;
    if (isPlaceholderUrl(value)) {
      issues.push({
        level: "warning",
        code: "placeholder_url",
        path,
        message: `"${path}" advertises a placeholder URL (${value}). Placeholder hosts (example.com, localhost, ...) are acceptable in fixtures/documentation but MUST NOT be published by a live server.`,
      });
    }
  });
}

function checkSecretShapedValues(manifest: ManifestLike, issues: SemanticIssue[]): void {
  walkStrings(manifest, "", (path, value) => {
    for (const { code, pattern } of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        issues.push({
          level: "error",
          code: `possible_secret_value:${code}`,
          path,
          message: `"${path}" contains a value matching a known credential shape (${code}). A public AADP manifest MUST NOT contain live credentials (spec v1.0 §3.1.7, security-considerations.md §2).`,
        });
      }
    }
  });
}

function checkUsageGuidanceLooksLikeInstruction(
  manifest: ManifestLike,
  issues: SemanticIssue[]
): void {
  const ug = manifest.usage_guidance;
  if (!ug) return;

  const fields: Array<[string, unknown]> = [
    ["/usage_guidance/summary_preference", ug.summary_preference],
    ["/usage_guidance/citation_preference", ug.citation_preference],
    ["/usage_guidance/attribution/preferred_text", ug.attribution?.preferred_text],
  ];

  for (const [path, value] of fields) {
    if (!isString(value)) continue;
    const matches = INSTRUCTION_SIGNALS.filter((re) => re.test(value));
    if (matches.length >= 2) {
      issues.push({
        level: "warning",
        code: "usage_guidance_looks_like_instruction",
        path,
        message: `"${path}" matches ${matches.length} independent instruction-like phrasing signals. This is advisory only — reference clients MUST treat this field as untrusted data regardless of this warning (spec v1.0 §3.1.9), never as an executable instruction.`,
      });
    }
  }
}

/**
 * Runs every Phase-3 semantic rule against a schema-valid AADP v1.0
 * manifest. Returns an empty array when no issue was found. Does not
 * throw for a semantically-invalid document — callers decide whether an
 * `error`-level issue should block publication.
 */
export function checkManifestSemantics(manifest: unknown): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (manifest === null || typeof manifest !== "object") {
    return [
      {
        level: "error",
        code: "not_an_object",
        path: "",
        message: "Manifest document is not an object.",
      },
    ];
  }

  const doc = manifest as ManifestLike;
  checkUsageGuidanceLanguage(doc, issues);
  checkModuleUniqueness(doc, issues);
  checkResourceTypeUniqueness(doc, issues);
  checkInterfaceIdUniqueness(doc, issues);
  checkSecurityReferences(doc, issues);
  checkInterfaceEndpoints(doc, issues);
  checkPlaceholderUrls(doc, issues);
  checkSecretShapedValues(doc, issues);
  checkUsageGuidanceLooksLikeInstruction(doc, issues);

  return issues;
}

/** True if any issue in the list is `error`-level (as opposed to `warning`). */
export function hasSemanticErrors(issues: SemanticIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

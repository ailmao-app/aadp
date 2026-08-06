/**
 * Generic AADP module registry types (ADR-0007 "Registry lookup",
 * `AADP-MODULE-REGISTRY` work package). This is deliberately independent of
 * any concrete module — Relations is the first consumer, not a special
 * case baked into these types.
 */

/** `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$` — ADR-0007 "Module ID and discovery". */
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;

export function isValidModuleId(moduleId: string): boolean {
  return MODULE_ID_PATTERN.test(moduleId);
}

/**
 * Exact-match key into the registry. Distinct from, and never resolved by
 * range against, the npm package version or `aadp_version` (core protocol
 * version) — the three version domains never move together (ADR-0007
 * "Version domains").
 */
export interface ModuleRegistryKey {
  /** Namespaced module id, e.g. "aadp:relations". Must match `MODULE_ID_PATTERN`. */
  moduleId: string;
  /** Module wire version, e.g. "1.0". */
  moduleVersion: string;
  /** Top-level document kind the module defines, e.g. "relation-set". */
  kind: string;
}

export type ModuleSemanticIssueLevel = "error" | "warning";

export interface ModuleSemanticIssue {
  level: ModuleSemanticIssueLevel;
  /** Stable machine-readable code. */
  code: string;
  /** JSON-pointer-style path into the document. */
  path: string;
  message: string;
}

/**
 * A pure, in-memory semantic check over an already schema-valid module
 * document. MUST NOT fetch a target, collection or schema URL — reference
 * resolution and traversal are a separate module client/traversal layer
 * (ADR-0007 "Envelope boundary"; plan `AADP-REL-004`), not the registry.
 */
export type ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[];

export interface ModuleRegistryEntry {
  /** JSON Schema for this exact {moduleId, moduleVersion, kind}. */
  schema: object;
  /** Optional pure semantic validator; omitted means schema-only validation. */
  validateSemantics?: ModuleSemanticValidator;
  /**
   * Additional schemas `schema` references by `$id` via `$ref` (e.g. a
   * document schema that `$ref`s out to shared component schemas shipped
   * as their own files). Each MUST declare its own `$id`. Registered into
   * the shared AJV instance once per `$id` — safe to pass the same
   * dependency for multiple document kinds that share a component.
   */
  schemaDependencies?: object[];
}

/** True if any issue in the list is `error`-level (as opposed to `warning`). */
export function hasModuleSemanticErrors(issues: ModuleSemanticIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

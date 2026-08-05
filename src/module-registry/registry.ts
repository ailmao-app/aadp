/**
 * Version-aware module registry (ADR-0007 "Registry lookup"). Exact-match
 * `{moduleId, moduleVersion, kind}` only — this file MUST NOT fall back to
 * a different module, version or kind, and a document is only ever pure
 * schema/semantic-validated here. Reference resolution and traversal
 * (fetching a target, a collection or a schema URL) belong to a module's
 * own client, not the registry (ADR-0007 "Envelope boundary").
 */
import { createRequire } from "node:module";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import {
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
  InvalidModuleDocumentError,
} from "./errors.js";
import {
  hasModuleSemanticErrors,
  isValidModuleId,
  type ModuleRegistryEntry,
  type ModuleRegistryKey,
  type ModuleSemanticIssue,
} from "./types.js";

// ajv-formats ships CJS-only types that don't interop cleanly under
// NodeNext ESM default-import resolution; require() sidesteps it (mirrors
// ../validator/index.ts).
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

interface CompiledEntry extends ModuleRegistryEntry {
  compiled: ValidateFunction;
}

// moduleId -> moduleVersion -> kind -> entry. Nested maps (rather than one
// flat `${moduleId}:${moduleVersion}:${kind}` key) keep "this moduleId
// doesn't exist", "this version doesn't exist" and "this kind doesn't
// exist" distinguishable without re-deriving them from a miss.
const registry = new Map<string, Map<string, Map<string, CompiledEntry>>>();

/**
 * Registers the schema (and optional pure semantic validator) for one
 * exact `{moduleId, moduleVersion, kind}`. Registration is additive only:
 * re-registering an already-registered key throws, matching the "released
 * artifacts are immutable" rule in ADR-0007 rather than silently replacing
 * a shipped schema.
 */
export function registerModule(key: ModuleRegistryKey, entry: ModuleRegistryEntry): void {
  if (!isValidModuleId(key.moduleId)) {
    throw new Error(
      `Invalid module id "${key.moduleId}": must match ^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$ (ADR-0007).`
    );
  }
  const byVersion = registry.get(key.moduleId) ?? new Map();
  const byKind = byVersion.get(key.moduleVersion) ?? new Map();
  if (byKind.has(key.kind)) {
    throw new Error(
      `Module "${key.moduleId}@${key.moduleVersion}" kind "${key.kind}" is already registered; registered module entries are immutable.`
    );
  }
  byKind.set(key.kind, { ...entry, compiled: ajv.compile(entry.schema) });
  byVersion.set(key.moduleVersion, byKind);
  registry.set(key.moduleId, byVersion);
}

function lookup(key: ModuleRegistryKey): CompiledEntry {
  const byVersion = registry.get(key.moduleId);
  if (!byVersion) throw new UnsupportedModuleError(key.moduleId);
  const byKind = byVersion.get(key.moduleVersion);
  if (!byKind) throw new UnsupportedModuleVersionError(key.moduleId, key.moduleVersion);
  const entry = byKind.get(key.kind);
  if (!entry) throw new UnsupportedModuleKindError(key.moduleId, key.moduleVersion, key.kind);
  return entry;
}

/**
 * Exact-match lookup of the registered schema/validator pair. Throws one
 * of the three ADR-0007 lookup errors (`unsupported_module`,
 * `unsupported_module_version`, `unsupported_module_kind`) instead of
 * resolving to a nearby version or kind.
 */
export function getModuleEntry(key: ModuleRegistryKey): ModuleRegistryEntry {
  const { compiled: _compiled, ...entry } = lookup(key);
  return entry;
}

export interface ModuleValidationResult {
  valid: boolean;
  errors: unknown[];
  semanticIssues: ModuleSemanticIssue[];
}

/**
 * Validates `data` against the schema (and, if registered, the pure
 * semantic validator) for `key`. Throws the ADR-0007 lookup errors when
 * `key` itself is unknown; returns `{valid: false, ...}` — never throws —
 * when `key` is known but `data` fails validation, so callers can inspect
 * `errors`/`semanticIssues` without a try/catch.
 */
export function validateModuleDocument(
  key: ModuleRegistryKey,
  data: unknown
): ModuleValidationResult {
  const entry = lookup(key);
  const valid = entry.compiled(data) as boolean;
  const errors = valid ? [] : (entry.compiled.errors ?? []);
  const semanticIssues = valid && entry.validateSemantics ? entry.validateSemantics(data) : [];
  return {
    valid: valid && !hasModuleSemanticErrors(semanticIssues),
    errors,
    semanticIssues,
  };
}

/**
 * Throwing counterpart of `validateModuleDocument`, for call sites that
 * want a single `InvalidModuleDocumentError` on any failure (unknown key
 * or invalid document) instead of branching on `{valid}`. Unlike
 * `validateModuleDocument`, this does not distinguish an unknown key from
 * an invalid document — use `validateModuleDocument` directly when that
 * distinction matters.
 */
export function assertValidModuleDocument(key: ModuleRegistryKey, data: unknown): void {
  const result = validateModuleDocument(key, data);
  if (!result.valid) {
    throw new InvalidModuleDocumentError(key, [...result.errors, ...result.semanticIssues]);
  }
}

/** True if any version of `moduleId` is registered. Introspection only — not a version check. */
export function isModuleRegistered(moduleId: string): boolean {
  return registry.has(moduleId);
}

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
import { canonicalize } from "../canonical-json/canonicalize.js";
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

/**
 * Recursively freezes a cloned schema so a later mutation of the
 * caller's original object (or of a `getModuleEntry().schema` reference)
 * can never desync from the validator AJV already compiled for it — see
 * the registration-is-immutable contract on `registerModule`.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// moduleId -> moduleVersion -> kind -> entry. Nested maps (rather than one
// flat `${moduleId}:${moduleVersion}:${kind}` key) keep "this moduleId
// doesn't exist", "this version doesn't exist" and "this kind doesn't
// exist" distinguishable without re-deriving them from a miss.
const registry = new Map<string, Map<string, Map<string, CompiledEntry>>>();

// $id -> canonical JSON of the schema last registered under it. Lets a
// second `registerModule` call reuse a shared dependency (two document
// kinds `$ref`ing the same component, e.g. Relations' `relation-set` and
// `relation-collection` both depending on `target.schema.json`) while
// still rejecting a *different* schema smuggled in under the same `$id` —
// see the P1 "schema-poisoning" finding this replaced (an `$id`-only
// existence check let whichever caller registered first silently win).
const dependencyCanonicalById = new Map<string, string>();

/**
 * Adds `dependency` to the shared AJV instance so a document schema's
 * internal `$ref` to it resolves. Reuses an already-registered schema only
 * when it is canonically identical to the one being added; a same-`$id`,
 * different-content dependency throws instead of silently keeping
 * whichever version was registered first.
 */
function addSchemaDependency(dependency: object): void {
  const id = (dependency as { $id?: string }).$id;
  if (!id) {
    // No `$id` to dedupe or conflict-check against — add it standalone.
    ajv.addSchema(deepFreeze(structuredClone(dependency)));
    return;
  }
  const canonical = canonicalize(dependency);
  const existingCanonical = dependencyCanonicalById.get(id);
  if (existingCanonical !== undefined) {
    if (existingCanonical !== canonical) {
      throw new Error(
        `Schema dependency conflict: "${id}" was already registered with different content. A schema dependency's $id MUST always resolve to the same schema — this looks like two modules (or two registrations) shipping conflicting schemas under the same $id.`
      );
    }
    return; // Canonically identical to what's already registered — safe to reuse.
  }
  dependencyCanonicalById.set(id, canonical);
  ajv.addSchema(deepFreeze(structuredClone(dependency)));
}

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
  for (const dependency of entry.schemaDependencies ?? []) {
    addSchemaDependency(dependency);
  }
  // Snapshot the schema before compiling: a deep clone, frozen, so neither
  // the caller's original object nor the entry `getModuleEntry` later
  // returns can drift from what `ajv.compile` actually validates against.
  const schema = deepFreeze(structuredClone(entry.schema));
  byKind.set(key.kind, { ...entry, schema, compiled: ajv.compile(schema) });
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
 * want a single try/catch instead of branching on `{valid}`. Only wraps
 * the "known key, invalid document" case as `InvalidModuleDocumentError`;
 * an unknown `moduleId`/`moduleVersion`/`kind` still throws its own
 * `UnsupportedModule*Error` from the underlying lookup — this function
 * does NOT collapse the ADR-0007 lookup-error taxonomy into one error
 * type. Callers that need to tell "unsupported key" apart from "invalid
 * document" can distinguish by `error.code`; callers that only care
 * whether the document was accepted can catch `Error` generically.
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

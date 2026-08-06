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

interface PendingDependency {
  id: string;
  canonical: string;
  frozen: object;
}

/**
 * Preflight for one dependency: pure conflict-checking against both the
 * global registry and `pending` (other dependencies already checked in
 * this same `registerModule` call), with no mutation of any shared state.
 * Throws on a same-`$id`, different-content conflict; returns `undefined`
 * for a dependency that's already registered and canonically identical
 * (nothing new to add), or the info needed to actually add it otherwise.
 */
function preflightDependency(dependency: object, pending: Map<string, string>): PendingDependency | undefined {
  const id = (dependency as { $id?: string }).$id;
  if (!id) {
    throw new Error(
      `Schema dependency is missing "$id": a dependency can only be $ref'd (and safely conflict-checked/rolled back) by $id.`
    );
  }
  const canonical = canonicalize(dependency);
  const existingCanonical = pending.get(id) ?? dependencyCanonicalById.get(id);
  if (existingCanonical !== undefined) {
    if (existingCanonical !== canonical) {
      throw new Error(
        `Schema dependency conflict: "${id}" was already registered with different content. A schema dependency's $id MUST always resolve to the same schema — this looks like two modules (or two registrations) shipping conflicting schemas under the same $id.`
      );
    }
    pending.set(id, canonical);
    return undefined; // Canonically identical to what's already registered/pending — nothing new to add.
  }
  pending.set(id, canonical);
  return { id, canonical, frozen: deepFreeze(structuredClone(dependency)) };
}

/**
 * Registers the schema (and optional pure semantic validator) for one
 * exact `{moduleId, moduleVersion, kind}`. Registration is additive only:
 * re-registering an already-registered key throws, matching the "released
 * artifacts are immutable" rule in ADR-0007 rather than silently replacing
 * a shipped schema.
 *
 * All-or-nothing: a conflicting/invalid dependency or a document schema
 * that fails to compile leaves no trace — no dependency `$id` is left
 * occupying the shared AJV instance or `dependencyCanonicalById`, and the
 * module key itself is never registered. Without this, a failed attempt
 * partway through could permanently claim a dependency `$id` (or leave the
 * AJV instance and the canonical map out of sync with each other), making
 * a later, correct registration attempt fail for a reason that has nothing
 * to do with its own content.
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

  // Phase 1 (pure): resolve which dependencies are actually new and check
  // every conflict — global vs. global, global vs. this call, and within
  // this call's own dependency list — before touching AJV or any shared
  // map. Throwing here leaves no state to roll back.
  const pending = new Map<string, string>();
  const toAdd: PendingDependency[] = [];
  for (const dependency of entry.schemaDependencies ?? []) {
    const resolved = preflightDependency(dependency, pending);
    if (resolved) toAdd.push(resolved);
  }

  // Phase 2 (mutating, rolled back on any failure below): add only the
  // genuinely new dependencies to the shared AJV instance.
  const added: string[] = [];
  try {
    for (const dep of toAdd) {
      ajv.addSchema(dep.frozen, dep.id);
      added.push(dep.id);
    }
    // Snapshot the schema before compiling: a deep clone, frozen, so
    // neither the caller's original object nor the entry `getModuleEntry`
    // later returns can drift from what `ajv.compile` actually validates
    // against.
    const schema = deepFreeze(structuredClone(entry.schema));
    const compiled = ajv.compile(schema);

    // Phase 3 (commit): only now record the new dependencies as
    // permanent and publish the module key — every fallible step above
    // already succeeded.
    for (const dep of toAdd) {
      dependencyCanonicalById.set(dep.id, dep.canonical);
    }
    byKind.set(key.kind, { ...entry, schema, compiled });
    byVersion.set(key.moduleVersion, byKind);
    registry.set(key.moduleId, byVersion);
  } catch (err) {
    for (const id of added) {
      ajv.removeSchema(id);
    }
    throw err;
  }
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

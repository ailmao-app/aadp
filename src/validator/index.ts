import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  getSchema,
  isSupportedVersion,
  schemasByKind,
  SUPPORTED_VERSIONS,
  KINDS,
  type AadpVersion,
  type ResourceKind,
} from "./schemas.js";

// ajv-formats ships CJS-only types that don't interop cleanly under
// NodeNext ESM default-import resolution; require() sidesteps it.
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

export type { ResourceKind, AadpVersion };
export { SUPPORTED_VERSIONS, KINDS };

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export class UnsupportedAadpVersionError extends Error {
  readonly code = "unsupported_version" as const;
  readonly version: string;

  constructor(version: string) {
    super(
      `Unsupported AADP version "${version}". Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`
    );
    this.name = "UnsupportedAadpVersionError";
    this.version = version;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const compiled = new Map<string, ValidateFunction>();

function compileFor(version: AadpVersion, kind: ResourceKind): ValidateFunction {
  const key = `${version}:${kind}`;
  let fn = compiled.get(key);
  if (!fn) {
    fn = ajv.compile(getSchema(version, kind));
    compiled.set(key, fn);
  }
  return fn;
}

export interface ValidateDocumentInput {
  version: string;
  kind: ResourceKind;
  data: unknown;
}

/**
 * Version-aware validation entry point. Throws `UnsupportedAadpVersionError`
 * (distinct from a schema-invalid `ValidationResult`) for any version this
 * package has no schema for — it never silently falls back to a
 * different version's schema (e.g. v1.0 -> v0.1), per
 * `docs/IMPLEMENTATION_PLAN.md` Phase 2.
 */
export function validateDocument(input: ValidateDocumentInput): ValidationResult {
  if (!isSupportedVersion(input.version)) {
    throw new UnsupportedAadpVersionError(input.version);
  }
  if (!KINDS.includes(input.kind)) {
    throw new Error(`Unknown AADP resource kind: ${input.kind}`);
  }
  const validateFn = compileFor(input.version, input.kind);
  const valid = validateFn(input.data) as boolean;
  return { valid, errors: valid ? [] : (validateFn.errors ?? []) };
}

// --- v0.1-pinned API, kept unchanged for backward compatibility with
// existing consumers/tests. New code that needs a specific version should
// call `validateDocument` instead. ---

const v01Validators = new Map(
  Object.entries(schemasByKind).map(([kind, schema]) => [
    kind,
    ajv.compile(schema),
  ])
);

/** Validates `data` against the AADP v0.1 schema for `kind`. */
export function validate(kind: ResourceKind, data: unknown): ValidationResult {
  const validateFn = v01Validators.get(kind);
  if (!validateFn) {
    throw new Error(`Unknown AADP resource kind: ${kind}`);
  }
  const valid = validateFn(data) as boolean;
  return { valid, errors: valid ? [] : (validateFn.errors ?? []) };
}

export const validateManifest = (data: unknown) => validate("manifest", data);
export const validateSitemapIndex = (data: unknown) =>
  validate("sitemap-index", data);
export const validateSitemap = (data: unknown) => validate("sitemap", data);
export const validateEntity = (data: unknown) => validate("entity", data);
export const validateError = (data: unknown) => validate("error", data);

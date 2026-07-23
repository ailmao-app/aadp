import { createRequire } from "node:module";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { schemasByKind, type ResourceKind } from "./schemas.js";

// ajv-formats ships CJS-only types that don't interop cleanly under
// NodeNext ESM default-import resolution; require() sidesteps it.
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

export type { ResourceKind };

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validators = new Map(
  Object.entries(schemasByKind).map(([kind, schema]) => [
    kind,
    ajv.compile(schema),
  ])
);

/** Validates `data` against the AADP v0.1 schema for `kind`. */
export function validate(kind: ResourceKind, data: unknown): ValidationResult {
  const validateFn = validators.get(kind);
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

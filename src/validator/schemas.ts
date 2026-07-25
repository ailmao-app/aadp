import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(__dirname, "..", "..", "schemas");

export type AadpVersion = "0.1" | "1.0";

export type ResourceKind =
  | "manifest"
  | "sitemap-index"
  | "sitemap"
  | "entity"
  | "error";

/**
 * Every AADP version this package ships a schema for. Adding a version
 * means adding a `schemas/vX.Y/` directory with all five files below —
 * there is no partial/mixed-version registration.
 */
export const SUPPORTED_VERSIONS: readonly AadpVersion[] = ["0.1", "1.0"];

export const KINDS: readonly ResourceKind[] = [
  "manifest",
  "sitemap-index",
  "sitemap",
  "entity",
  "error",
];

export function isSupportedVersion(version: string): version is AadpVersion {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(version);
}

function loadSchema(version: AadpVersion, kind: ResourceKind): object {
  const file = `${kind}.schema.json`;
  return JSON.parse(
    readFileSync(path.join(schemasRoot, `v${version}`, file), "utf8")
  );
}

function registryKey(version: AadpVersion, kind: ResourceKind): string {
  return `${version}:${kind}`;
}

/** {version, kind} -> parsed JSON Schema. Populated eagerly at import time. */
const registry = new Map<string, object>();
for (const version of SUPPORTED_VERSIONS) {
  for (const kind of KINDS) {
    registry.set(registryKey(version, kind), loadSchema(version, kind));
  }
}

/**
 * Looks up the schema for an exact {version, kind} pair. Never falls back
 * to a different version — an unregistered version is a caller error, not
 * something this function silently papers over.
 */
export function getSchema(version: AadpVersion, kind: ResourceKind): object {
  const schema = registry.get(registryKey(version, kind));
  if (!schema) {
    throw new Error(
      `No schema registered for AADP version "${version}", kind "${kind}"`
    );
  }
  return schema;
}

// --- v0.1-pinned exports, kept for backward compatibility with existing
// consumers/tests that import the schema objects directly. ---
export const manifestSchema = getSchema("0.1", "manifest");
export const sitemapIndexSchema = getSchema("0.1", "sitemap-index");
export const sitemapSchema = getSchema("0.1", "sitemap");
export const entitySchema = getSchema("0.1", "entity");
export const errorSchema = getSchema("0.1", "error");

export const schemasByKind: Record<ResourceKind, object> = {
  manifest: manifestSchema,
  "sitemap-index": sitemapIndexSchema,
  sitemap: sitemapSchema,
  entity: entitySchema,
  error: errorSchema,
};

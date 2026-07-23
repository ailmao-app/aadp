import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, "..", "..", "schemas", "v0.1");

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(schemasDir, file), "utf8"));
}

export const manifestSchema = loadSchema("manifest.schema.json");
export const sitemapIndexSchema = loadSchema("sitemap-index.schema.json");
export const sitemapSchema = loadSchema("sitemap.schema.json");
export const entitySchema = loadSchema("entity.schema.json");
export const errorSchema = loadSchema("error.schema.json");

export type ResourceKind =
  | "manifest"
  | "sitemap-index"
  | "sitemap"
  | "entity"
  | "error";

export const schemasByKind: Record<ResourceKind, object> = {
  manifest: manifestSchema,
  "sitemap-index": sitemapIndexSchema,
  sitemap: sitemapSchema,
  entity: entitySchema,
  error: errorSchema,
};

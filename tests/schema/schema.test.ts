import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateManifest,
  validateSitemapIndex,
  validateSitemap,
  validateEntity,
  validateError,
} from "../../src/validator/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "..", "..", "examples", "v0.1");
const invalidDir = path.resolve(__dirname, "..", "fixtures", "invalid");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("positive fixtures validate against their schema", () => {
  it("manifest.json is a valid manifest", () => {
    const result = validateManifest(readJson(path.join(examplesDir, "manifest.json")));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("sitemap-index.json is a valid sitemap index", () => {
    const result = validateSitemapIndex(
      readJson(path.join(examplesDir, "sitemap-index.json"))
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("sitemap.json is a valid sitemap", () => {
    const result = validateSitemap(readJson(path.join(examplesDir, "sitemap.json")));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("entity.json and entity-2.json are valid entities", () => {
    for (const file of ["entity.json", "entity-2.json"]) {
      const result = validateEntity(readJson(path.join(examplesDir, file)));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it("error-not-found.json is a valid error envelope", () => {
    const result = validateError(readJson(path.join(examplesDir, "error-not-found.json")));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("every example file in examples/v0.1 validates", () => {
  const validators: Record<string, (d: unknown) => { valid: boolean }> = {
    manifest: validateManifest,
    "sitemap-index": validateSitemapIndex,
    sitemap: validateSitemap,
    entity: validateEntity,
    error: validateError,
  };

  const kindFor = (filename: string): keyof typeof validators => {
    if (filename.startsWith("manifest")) return "manifest";
    if (filename.startsWith("sitemap-index")) return "sitemap-index";
    if (filename.startsWith("sitemap")) return "sitemap";
    if (filename.startsWith("entity")) return "entity";
    if (filename.startsWith("error")) return "error";
    throw new Error(`Cannot infer AADP kind for example file: ${filename}`);
  };

  for (const filename of readdirSync(examplesDir)) {
    it(`${filename} validates as ${kindFor(filename)}`, () => {
      const kind = kindFor(filename);
      const result = validators[kind](readJson(path.join(examplesDir, filename)));
      expect(result.valid).toBe(true);
    });
  }
});

describe("negative fixtures fail schema validation", () => {
  it("manifest missing aidp_version is invalid", () => {
    const result = validateManifest(
      readJson(path.join(invalidDir, "manifest-missing-version.json"))
    );
    expect(result.valid).toBe(false);
  });

  it("manifest with a non-namespaced extra field is invalid", () => {
    const result = validateManifest(
      readJson(path.join(invalidDir, "manifest-extra-field.json"))
    );
    expect(result.valid).toBe(false);
  });

  it("sitemap index with a malformed URL is invalid", () => {
    const result = validateSitemapIndex(
      readJson(path.join(invalidDir, "sitemap-index-bad-url.json"))
    );
    expect(result.valid).toBe(false);
  });

  it("sitemap with a non-sha256 checksum is invalid", () => {
    const result = validateSitemap(
      readJson(path.join(invalidDir, "sitemap-bad-checksum.json"))
    );
    expect(result.valid).toBe(false);
  });

  it("sitemap item id containing a slash is invalid", () => {
    const result = validateSitemap(
      readJson(path.join(invalidDir, "sitemap-item-id-slash.json"))
    );
    expect(result.valid).toBe(false);
  });

  it.each([
    "entity-id-path-traversal.json",
    "entity-id-query-marker.json",
    "entity-id-whitespace.json",
    "entity-id-unicode.json",
  ])("entity with an out-of-grammar canonical id is invalid: %s", (file) => {
    const result = validateEntity(readJson(path.join(invalidDir, file)));
    expect(result.valid).toBe(false);
  });

  it("entity missing data is invalid", () => {
    const result = validateEntity(
      readJson(path.join(invalidDir, "entity-missing-data.json"))
    );
    expect(result.valid).toBe(false);
  });

  it("error envelope missing request_id is invalid", () => {
    const result = validateError(
      readJson(path.join(invalidDir, "error-missing-request-id.json"))
    );
    expect(result.valid).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDocument,
  UnsupportedAadpVersionError,
  SUPPORTED_VERSIONS,
} from "../../src/validator/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(__dirname, "..", "..", "examples");
const invalidV1Dir = path.resolve(__dirname, "..", "fixtures", "invalid", "v1.0");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("validateDocument is version-aware", () => {
  it("has a registry entry for every supported version", () => {
    expect(SUPPORTED_VERSIONS).toEqual(["0.1", "1.0"]);
  });

  it("validates a v0.1 manifest against the v0.1 schema", () => {
    const data = readJson(path.join(examplesRoot, "v0.1", "manifest.json"));
    const result = validateDocument({ version: "0.1", kind: "manifest", data });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates a v1.0 manifest against the v1.0 schema", () => {
    const data = readJson(path.join(examplesRoot, "v1.0", "manifest.json"));
    const result = validateDocument({ version: "1.0", kind: "manifest", data });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not silently fall back: a v1.0 manifest fails the v0.1 schema", () => {
    const data = readJson(path.join(examplesRoot, "v1.0", "manifest.json"));
    const result = validateDocument({ version: "0.1", kind: "manifest", data });
    expect(result.valid).toBe(false);
  });

  it("does not silently fall back: a v0.1 manifest fails the v1.0 schema", () => {
    const data = readJson(path.join(examplesRoot, "v0.1", "manifest.json"));
    const result = validateDocument({ version: "1.0", kind: "manifest", data });
    expect(result.valid).toBe(false);
  });

  it("throws UnsupportedAadpVersionError (not a schema_invalid result) for an unknown version", () => {
    const data = readJson(path.join(examplesRoot, "v1.0", "manifest.json"));
    expect(() => validateDocument({ version: "0.5", kind: "manifest", data })).toThrow(
      UnsupportedAadpVersionError
    );
  });

  it("UnsupportedAadpVersionError carries the offending version and a code", () => {
    try {
      validateDocument({ version: "9.9", kind: "manifest", data: {} });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedAadpVersionError);
      expect((err as UnsupportedAadpVersionError).version).toBe("9.9");
      expect((err as UnsupportedAadpVersionError).code).toBe("unsupported_version");
    }
  });

  it("every v1.0 example validates against the v1.0 schema for its kind", () => {
    const examplesDir = path.join(examplesRoot, "v1.0");
    const kindFor = (filename: string) => {
      if (filename.startsWith("manifest")) return "manifest" as const;
      if (filename.startsWith("sitemap-index")) return "sitemap-index" as const;
      if (filename.startsWith("sitemap")) return "sitemap" as const;
      if (filename.startsWith("entity")) return "entity" as const;
      if (filename.startsWith("error")) return "error" as const;
      throw new Error(`Cannot infer AADP kind for example file: ${filename}`);
    };
    for (const filename of readdirSync(examplesDir)) {
      const data = readJson(path.join(examplesDir, filename));
      const result = validateDocument({ version: "1.0", kind: kindFor(filename), data });
      expect(result.valid, `${filename}: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });

  it("every v1.0 invalid manifest fixture fails validateDocument", () => {
    for (const filename of readdirSync(invalidV1Dir)) {
      const data = readJson(path.join(invalidV1Dir, filename));
      const result = validateDocument({ version: "1.0", kind: "manifest", data });
      expect(result.valid, `${filename} unexpectedly validated`).toBe(false);
    }
  });
});

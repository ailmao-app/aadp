/**
 * `module.schema.json` is the schema URL a manifest's `modules[]` entry
 * points at (specification.md §2, §10) — a standalone dispatch artifact,
 * not something the generic module registry compiles for us. This test
 * exercises it directly with its own AJV instance (mirroring how an
 * external consumer fetching the schema over HTTP would resolve its
 * `$ref`s) to verify it `oneOf`-dispatches to exactly the three document
 * kinds and is never used to validate a manifest discovery entry.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "relations", "v1.0");

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(schemasRoot, file), "utf8"));
}

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

function compileModuleDispatch() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(loadSchema("target.schema.json"));
  ajv.addSchema(loadSchema("collection-link.schema.json"));
  ajv.addSchema(loadSchema("relation-item.schema.json"));
  ajv.addSchema(loadSchema("relation-set.schema.json"));
  ajv.addSchema(loadSchema("relation-collection.schema.json"));
  ajv.addSchema(loadSchema("relation-registry.schema.json"));
  return ajv.compile(loadSchema("module.schema.json"));
}

describe("module.schema.json dispatch", () => {
  const validate = compileModuleDispatch();

  it("accepts a relation-set document", () => {
    expect(
      validate({
        module: "aadp:relations",
        version: "1.0",
        kind: "relation-set",
        items: [],
      })
    ).toBe(true);
  });

  it("accepts a relation-collection document", () => {
    expect(
      validate({
        aadp_version: "1.0",
        module: "aadp:relations",
        module_version: "1.0",
        kind: "relation-collection",
        source: { id: "character:alice", type: "character" },
        rel: "posts",
        target_type: "post",
        generated_at: "2026-08-05T00:00:00Z",
        checksum: `sha256:${"0".repeat(64)}`,
        items: [],
        cursor: { next: null },
      })
    ).toBe(true);
  });

  it("accepts a relation-registry document", () => {
    expect(
      validate({
        aadp_version: "1.0",
        module: "aadp:relations",
        module_version: "1.0",
        kind: "relation-registry",
        generated_at: "2026-08-05T00:00:00Z",
        checksum: `sha256:${"0".repeat(64)}`,
        relations: [],
      })
    ).toBe(true);
  });

  it("rejects a document matching none of the three document kinds", () => {
    expect(validate({ kind: "relation-graph" })).toBe(false);
  });

  it("does NOT validate a manifest discovery entry ({id, version, schema}) as any of the three kinds", () => {
    expect(
      validate({
        id: "aadp:relations",
        version: "1.0",
        schema: "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json",
      })
    ).toBe(false);
  });
});

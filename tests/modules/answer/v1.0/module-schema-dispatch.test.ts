/**
 * `module.schema.json` is the schema URL a manifest's `modules[]` entry
 * points at — a standalone dispatch artifact, not something the generic
 * module registry compiles for us. Exercised directly with its own AJV
 * instance (mirroring an external consumer resolving its `$ref`s over
 * HTTP), verifying it resolves to the `answer` document schema and is
 * never used to validate a manifest discovery entry.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const answerSchemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "answer", "v1.0");
const relationsSchemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "relations", "v1.0");

function loadSchema(root: string, file: string): object {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"));
}

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => void;

function compileModuleDispatch() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(loadSchema(relationsSchemasRoot, "target.schema.json"));
  ajv.addSchema(loadSchema(answerSchemasRoot, "answer-reference.schema.json"));
  ajv.addSchema(loadSchema(answerSchemasRoot, "authorship.schema.json"));
  ajv.addSchema(loadSchema(answerSchemasRoot, "freshness.schema.json"));
  ajv.addSchema(loadSchema(answerSchemasRoot, "applicability.schema.json"));
  ajv.addSchema(loadSchema(answerSchemasRoot, "answer.schema.json"));
  return ajv.compile(loadSchema(answerSchemasRoot, "module.schema.json"));
}

function validXAnswer(): Record<string, unknown> {
  const base = {
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is Orbit?",
    concise_answer: "Orbit is a neutral example service.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
  };
  return { ...base, content_checksum: checksumOf(base) };
}

describe("module.schema.json dispatch", () => {
  const validate = compileModuleDispatch();

  it("accepts an answer document", () => {
    expect(validate(validXAnswer())).toBe(true);
  });

  it("rejects a document matching no known kind", () => {
    expect(validate({ kind: "answer-graph" })).toBe(false);
  });

  it("does NOT validate a manifest discovery entry ({id, version, schema}) as an answer document", () => {
    expect(
      validate({
        id: "aadp:answer",
        version: "1.0",
        schema: "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json",
      })
    ).toBe(false);
  });
});

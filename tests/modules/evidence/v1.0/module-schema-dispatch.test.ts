/**
 * `module.schema.json` is the schema URL a manifest's `modules[]` entry
 * points at — a standalone dispatch artifact, not something the generic
 * module registry compiles for us. Exercised directly with its own AJV
 * instance (mirroring an external consumer resolving its `$ref`s over
 * HTTP), verifying it dispatches to BOTH Evidence document schemas and is
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
const evidenceSchemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "evidence", "v1.0");
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
  ajv.addSchema(loadSchema(evidenceSchemasRoot, "evidence-reference.schema.json"));
  ajv.addSchema(loadSchema(evidenceSchemasRoot, "source.schema.json"));
  ajv.addSchema(loadSchema(evidenceSchemasRoot, "provenance.schema.json"));
  ajv.addSchema(loadSchema(evidenceSchemasRoot, "claim.schema.json"));
  ajv.addSchema(loadSchema(evidenceSchemasRoot, "evidence.schema.json"));
  return ajv.compile(loadSchema(evidenceSchemasRoot, "module.schema.json"));
}

function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

function validClaim(): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "claim",
    statement: "Orbit reported 99.9% uptime in 2026.",
    locale: "en",
    evidence_refs: [
      {
        target_type: "evidence",
        target: { id: "evidence:orbit-report", url: "https://example.com/ai/v1.0/entities/evidence/orbit-report.json" },
        stance: "support",
      },
    ],
  });
}

function validEvidence(): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "evidence",
    summary: "Annual status report published by Example Orbit.",
    locale: "en",
    source: {
      title: "Orbit 2026 Status Report",
      url: "https://example.com/reports/2026-status",
      publisher: { name: "Example Orbit" },
      access: "public",
    },
    provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" },
  });
}

describe("module.schema.json dispatch", () => {
  const validate = compileModuleDispatch();

  it("accepts a claim document", () => {
    expect(validate(validClaim())).toBe(true);
  });

  it("accepts an evidence document", () => {
    expect(validate(validEvidence())).toBe(true);
  });

  it("rejects a document matching no known kind", () => {
    expect(validate({ kind: "source" })).toBe(false);
  });

  it("rejects a hybrid that would satisfy neither branch cleanly", () => {
    expect(validate({ ...validClaim(), kind: "evidence" })).toBe(false);
  });

  it("does NOT validate a manifest discovery entry ({id, version, schema}) as an Evidence document", () => {
    expect(
      validate({
        id: "aadp:evidence",
        version: "1.0",
        schema: "https://aadp.dev/schemas/modules/evidence/v1.0/module.schema.json",
      })
    ).toBe(false);
  });
});

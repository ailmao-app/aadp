/**
 * Runs the normative Relations Module v1.0 fixture catalog
 * (`spec/modules/relations/v1.0/conformance.md` "Normative fixture
 * catalog") through the public `validateRelationsDocument` entry point.
 * Traversal/security fixtures from that catalog (cursor cycles, budgets,
 * SSRF, cross-origin) are deliberately excluded — they require the live
 * client/traversal layer that is `AADP-REL-005`, not this pure
 * schema/semantic validation work package.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRelationsDocument, type RelationsDocumentKind } from "../../../../src/modules/relations/v1.0/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "..", "..", "..", "fixtures", "relations", "v1.0");

function loadFixture(dir: string, file: string): { doc: Record<string, unknown>; kind: RelationsDocumentKind } {
  const doc = JSON.parse(readFileSync(path.join(fixturesRoot, dir, file), "utf8"));
  return { doc, kind: doc.kind as RelationsDocumentKind };
}

describe("Relations v1.0 valid fixture catalog", () => {
  const validDir = path.join(fixturesRoot, "valid");
  const files = readdirSync(validDir).sort();

  it("catalog is non-empty (guards against an accidentally-empty fixtures directory)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s passes schema and semantic validation", (file) => {
    const { doc, kind } = loadFixture("valid", file);
    const result = validateRelationsDocument(kind, doc);
    expect({ file, result }).toEqual({
      file,
      result: { valid: true, errors: [], semanticIssues: [] },
    });
  });
});

// Fixture file name -> expected primary issue code (schema layer surfaces
// an ajv error, not one of our own codes, so those two rows only assert
// `valid: false`/non-empty `errors`).
const EXPECTED_INVALID: Record<string, string | null> = {
  "relations-invalid-wrapper-version.json": null,
  "relations-invalid-unknown-field.json": null,
  "relations-invalid-one-with-targets.json": "invalid_cardinality_container",
  "relations-invalid-many-with-both-containers.json": "invalid_cardinality_container",
  "relations-invalid-many-without-container.json": "invalid_cardinality_container",
  "relations-invalid-inline-over-limit.json": "invalid_cardinality_container",
  "relations-invalid-token.json": "invalid_relation_token",
  "relations-invalid-id-type-prefix.json": "target_identity_mismatch",
  "relations-invalid-duplicate-target.json": "duplicate_target",
  "relations-invalid-collection-context.json": "collection_context_mismatch",
  "relations-invalid-checksum.json": "collection_checksum_mismatch",
  "relations-invalid-registry-duplicate-token.json": "duplicate_registry_token",
  "relations-invalid-registry-checksum.json": "registry_checksum_mismatch",
  "relations-invalid-registry-token.json": "invalid_relation_token",
  "relations-invalid-registry-symmetric-mismatch.json": "symmetric_inverse_mismatch",
  "relations-invalid-registry-symmetric-missing-inverse.json": "symmetric_inverse_mismatch",
};

describe("Relations v1.0 invalid fixture catalog", () => {
  const invalidDir = path.join(fixturesRoot, "invalid");
  const files = readdirSync(invalidDir).sort();

  it("covers every fixture the conformance catalog lists (no silently-added/missing file)", () => {
    expect(files.sort()).toEqual(Object.keys(EXPECTED_INVALID).sort());
  });

  it.each(files)("%s fails validation with its catalog-expected primary issue", (file) => {
    const { doc, kind } = loadFixture("invalid", file);
    const result = validateRelationsDocument(kind, doc);
    expect(result.valid).toBe(false);

    const expectedCode = EXPECTED_INVALID[file];
    if (expectedCode === null) {
      // Schema-layer failure: no semantic issue runs, ajv errors present instead.
      expect(result.semanticIssues).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    } else {
      expect(result.semanticIssues.map((issue) => issue.code)).toContain(expectedCode);
    }
  });
});

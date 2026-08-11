/**
 * Runs the Evidence Module v1.0 fixture catalog
 * (`tests/fixtures/evidence/v1.0/{valid,invalid}`) through the public
 * `validateEvidenceV1` entry point (schema + pure wrapper semantic
 * validation only — entity-context, client and conformance behavior are
 * covered by their own test files).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEvidenceV1 } from "../../../../src/modules/evidence/v1.0/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "..", "..", "..", "fixtures", "evidence", "v1.0");

function loadFixture(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixturesRoot, dir, file), "utf8"));
}

describe("Evidence v1.0 valid fixture catalog", () => {
  const validDir = path.join(fixturesRoot, "valid");
  const files = readdirSync(validDir).sort();

  it("catalog is non-empty (guards against an accidentally-empty fixtures directory)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("covers both document kinds", () => {
    const kinds = new Set(files.map((file) => (loadFixture("valid", file) as { kind: string }).kind));
    expect([...kinds].sort()).toEqual(["claim", "evidence"]);
  });

  it.each(files)("%s passes schema and semantic validation", (file) => {
    const doc = loadFixture("valid", file);
    const result = validateEvidenceV1(doc);
    expect({ file, result }).toEqual({
      file,
      result: { valid: true, errors: [], semanticIssues: [] },
    });
  });
});

// Fixture file name -> expected primary issue code. `null` means the fixture
// is rejected at the schema layer (ajv errors, no semantic issue runs —
// `validateModuleDocument` only calls the semantic validator on a
// schema-valid document).
const EXPECTED_INVALID: Record<string, string | null> = {
  "claim-invalid-confidence-out-of-range.json": null,
  "claim-invalid-confidence-string.json": null,
  "claim-invalid-evidence-refs-empty.json": null,
  "claim-invalid-evidence-refs-over-limit.json": null,
  "claim-invalid-locale-profile.json": null,
  "claim-invalid-missing-required-fields.json": null,
  "claim-invalid-stance-enum.json": null,
  "claim-invalid-target-type-claim.json": null,
  "claim-invalid-unknown-field.json": null,
  "claim-invalid-wrapper-version.json": null,
  "claim-invalid-confidence-precision.json": "evidence.semantic.confidence_precision_violation",
  "claim-invalid-content-checksum-evidence-refs.json": "evidence.semantic.content_checksum_mismatch",
  "claim-invalid-content-checksum-statement.json": "evidence.semantic.content_checksum_mismatch",
  "claim-invalid-content-checksum-wrong-key-ordering.json": "evidence.semantic.content_checksum_mismatch",
  "claim-invalid-duplicate-target.json": "evidence.semantic.duplicate_target",
  "claim-invalid-statement-not-trimmed.json": "evidence.semantic.not_trimmed",
  "claim-invalid-statement-over-limit.json": "evidence.semantic.code_point_bounds_violation",
  "evidence-invalid-access-enum.json": null,
  "evidence-invalid-missing-source.json": null,
  "evidence-invalid-publisher-url-malformed.json": null,
  "evidence-invalid-source-url-http.json": null,
  "evidence-invalid-source-url-private.json": "evidence.semantic.source_url_policy_violation",
  "evidence-invalid-timestamp-format.json": null,
  "evidence-invalid-content-checksum-excerpt.json": "evidence.semantic.content_checksum_mismatch",
  "evidence-invalid-content-checksum-provenance.json": "evidence.semantic.content_checksum_mismatch",
  "evidence-invalid-content-checksum-source.json": "evidence.semantic.content_checksum_mismatch",
  "evidence-invalid-modified-after-retrieved.json": "evidence.semantic.timestamp_order_violation",
  "evidence-invalid-publisher-name-over-limit.json": "evidence.semantic.code_point_bounds_violation",
  "evidence-invalid-source-url-fragment.json": "evidence.semantic.source_url_policy_violation",
  "evidence-invalid-source-url-userinfo.json": "evidence.semantic.source_url_policy_violation",
  "evidence-invalid-summary-over-limit.json": "evidence.semantic.code_point_bounds_violation",
  "evidence-invalid-timestamp-order.json": "evidence.semantic.timestamp_order_violation",
};

describe("Evidence v1.0 invalid fixture catalog", () => {
  const invalidDir = path.join(fixturesRoot, "invalid");
  const files = readdirSync(invalidDir).sort();

  it("covers every fixture on disk (no silently-added/missing file)", () => {
    expect(files.sort()).toEqual(Object.keys(EXPECTED_INVALID).sort());
  });

  it.each(files)("%s fails validation with its catalog-expected primary issue", (file) => {
    const doc = loadFixture("invalid", file);
    const result = validateEvidenceV1(doc);
    expect(result.valid).toBe(false);

    const expectedCode = EXPECTED_INVALID[file];
    if (expectedCode === null) {
      expect(result.semanticIssues).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    } else {
      expect(result.semanticIssues.map((issue) => issue.code)).toContain(expectedCode);
    }
  });
});

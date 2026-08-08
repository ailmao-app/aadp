/**
 * Runs the Answer Module v1.0 fixture catalog
 * (`tests/fixtures/answer/v1.0/{valid,invalid}`) through the public
 * `validateAnswerV1` entry point (schema + pure wrapper semantic
 * validation only — entity-context and client/conformance behavior are
 * covered by their own test files).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateAnswerV1 } from "../../../../src/modules/answer/v1.0/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, "..", "..", "..", "fixtures", "answer", "v1.0");

function loadFixture(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixturesRoot, dir, file), "utf8"));
}

describe("Answer v1.0 valid fixture catalog", () => {
  const validDir = path.join(fixturesRoot, "valid");
  const files = readdirSync(validDir).sort();

  it("catalog is non-empty (guards against an accidentally-empty fixtures directory)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s passes schema and semantic validation", (file) => {
    const doc = loadFixture("valid", file);
    const result = validateAnswerV1(doc);
    expect({ file, result }).toEqual({
      file,
      result: { valid: true, errors: [], semanticIssues: [] },
    });
  });
});

// Fixture file name -> expected primary issue code. `null` means the
// fixture is rejected at the schema layer (ajv errors, no semantic issue
// runs — validateModuleDocument only calls the semantic validator on a
// schema-valid document).
const EXPECTED_INVALID: Record<string, string | null> = {
  "answer-invalid-alias-short-answer.json": null,
  "answer-invalid-applicability-duplicate-and-bad-jurisdiction.json": null,
  "answer-invalid-applicability-empty.json": null,
  "answer-invalid-author-url-http.json": "answer.semantic.author_url_policy_violation",
  "answer-invalid-authorship-mixed-branches.json": null,
  "answer-invalid-concise-answer-over-limit.json": "answer.semantic.code_point_bounds_violation",
  "answer-invalid-content-checksum-answer.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-applicability.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-authorship.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-concise-answer.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-freshness.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-question.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-related-entities.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-content-checksum-wrong-key-ordering.json": "answer.semantic.content_checksum_mismatch",
  "answer-invalid-generated-summary-duplicate-source-targets.json": "answer.semantic.duplicate_target",
  "answer-invalid-generated-summary-no-source-targets.json": null,
  "answer-invalid-locale-profile.json": null,
  "answer-invalid-missing-required-fields.json": null,
  "answer-invalid-reference-missing-target-type.json": null,
  "answer-invalid-related-entities-duplicate.json": "answer.semantic.duplicate_target",
  "answer-invalid-related-entities-over-limit.json": null,
  "answer-invalid-timestamp-order.json": "answer.semantic.timestamp_order_violation",
  "answer-invalid-unknown-field-legacy-canonical-url.json": null,
  "answer-invalid-whitespace-only-question.json": "answer.semantic.not_trimmed",
};

describe("Answer v1.0 invalid fixture catalog", () => {
  const invalidDir = path.join(fixturesRoot, "invalid");
  const files = readdirSync(invalidDir).sort();

  it("covers every fixture on disk (no silently-added/missing file)", () => {
    expect(files.sort()).toEqual(Object.keys(EXPECTED_INVALID).sort());
  });

  it.each(files)("%s fails validation with its catalog-expected primary issue", (file) => {
    const doc = loadFixture("invalid", file);
    const result = validateAnswerV1(doc);
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

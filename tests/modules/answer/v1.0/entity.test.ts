/**
 * Tests for `validateAnswerEntityV1`/`parseAnswerEntityV1` — the
 * Answer-module-layer entity-context validator (specification.md
 * "Entity-context validator"). Covers each of its six steps: core entity
 * validity, type/x_answer/canonical_url presence, canonical_url URL
 * policy, x_answer registry dispatch, `freshness.updated_at` equality,
 * and the typed success shape.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";
import {
  validateAnswerEntityV1,
  parseAnswerEntityV1,
  AnswerEntityValidationError,
} from "../../../../src/modules/answer/v1.0/entity.js";

function buildXAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is Orbit?",
    concise_answer: "Orbit is a neutral example service.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    ...overrides,
  };
  const { content_checksum: _drop, ...rest } = base as Record<string, unknown>;
  return { ...base, content_checksum: checksumOf(rest) };
}

function buildEntity(xAnswerOverrides: Record<string, unknown> = {}, entityOverrides: Record<string, unknown> = {}) {
  const xAnswer = buildXAnswer(xAnswerOverrides);
  return {
    aadp_version: "1.0",
    id: "answer:what-is-orbit",
    type: "answer",
    checksum: checksumOf({}),
    updated_at: "2026-08-06T00:00:00Z",
    canonical_url: "https://example.com/answers/what-is-orbit",
    data: {},
    x_answer: xAnswer,
    ...entityOverrides,
  };
}

describe("validateAnswerEntityV1", () => {
  it("accepts a fully valid entity and returns the typed validated shape", () => {
    const entity = buildEntity();
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(true);
    expect(result.entity?.entity.id).toBe("answer:what-is-orbit");
    expect(result.entity?.answer.question).toBe("What is Orbit?");
  });

  it("rejects an entity failing core v1.0 schema validation", () => {
    const entity = buildEntity();
    delete (entity as Record<string, unknown>).id;
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects entity.type !== \"answer\"", () => {
    const entity = buildEntity({}, { type: "document" });
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toContain("answer.semantic.entity_type_mismatch");
  });

  it("rejects a missing x_answer", () => {
    const entity = buildEntity();
    delete (entity as Record<string, unknown>).x_answer;
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toContain("answer.semantic.missing_x_answer");
  });

  it("rejects a missing entity.canonical_url", () => {
    const entity = buildEntity();
    delete (entity as Record<string, unknown>).canonical_url;
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toContain("answer.semantic.missing_canonical_url");
  });

  it("rejects entity.canonical_url violating the shared URL policy (HTTP)", () => {
    const entity = buildEntity({}, { canonical_url: "http://example.com/answers/what-is-orbit" });
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toContain("answer.semantic.canonical_url_policy_violation");
  });

  it("rejects x_answer that fails registry dispatch (schema-invalid wrapper)", () => {
    const entity = buildEntity();
    (entity as Record<string, unknown>).x_answer = { module: "aadp:answer", version: "1.0", kind: "answer" };
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects x_answer.freshness.updated_at !== entity.updated_at", () => {
    const entity = buildEntity({}, { updated_at: "2026-09-01T00:00:00Z" });
    const result = validateAnswerEntityV1(entity);
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toContain("answer.semantic.updated_at_mismatch");
  });
});

describe("parseAnswerEntityV1", () => {
  it("returns the validated entity on success", () => {
    const entity = buildEntity();
    const parsed = parseAnswerEntityV1(entity);
    expect(parsed.entity.type).toBe("answer");
    expect(parsed.answer.concise_answer).toBe("Orbit is a neutral example service.");
  });

  it("throws AnswerEntityValidationError carrying the structured result on failure", () => {
    const entity = buildEntity({}, { type: "document" });
    expect(() => parseAnswerEntityV1(entity)).toThrow(AnswerEntityValidationError);
    try {
      parseAnswerEntityV1(entity);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AnswerEntityValidationError);
      expect((err as AnswerEntityValidationError).result.valid).toBe(false);
    }
  });
});

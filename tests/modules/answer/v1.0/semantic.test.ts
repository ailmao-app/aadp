/**
 * Direct unit tests for the Answer v1.0 pure semantic helpers
 * (`checkAnswerSemantics`, `isValidAnswerLocale`, `checkUrlPolicy`).
 * Exercises `isValidAnswerLocale`/`checkAnswerSemantics`'s own locale
 * branch directly (bypassing the registry's schema gate), since the
 * schema's `locale` pattern is byte-identical and would otherwise always
 * short-circuit that branch before it can run in a registry-dispatched
 * fixture (see `fixtures.test.ts`'s `answer-invalid-locale-profile.json`
 * row, which is schema-layer-only for that reason).
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";
import { checkAnswerSemantics, isValidAnswerLocale, checkUrlPolicy } from "../../../../src/modules/answer/v1.0/semantic.js";

function validAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

describe("isValidAnswerLocale", () => {
  it.each(["vi", "en", "en-US", "zh-Hant", "zh-Hant-TW", "en-001", "de-1994"])("accepts %s", (locale) => {
    expect(isValidAnswerLocale(locale)).toBe(true);
  });

  it.each(["en_US", "EN", "en-us", "x-private", "en-a-bbb", "en--US"])("rejects %s", (locale) => {
    expect(isValidAnswerLocale(locale)).toBe(false);
  });
});

describe("checkUrlPolicy", () => {
  it("accepts an absolute HTTPS URL with no userinfo/fragment", () => {
    expect(checkUrlPolicy("https://example.com/editorial")).toBeUndefined();
  });
  it("rejects http", () => {
    expect(checkUrlPolicy("http://example.com/editorial")).toMatch(/https/);
  });
  it("rejects userinfo", () => {
    expect(checkUrlPolicy("https://user:pass@example.com/editorial")).toMatch(/userinfo/);
  });
  it("rejects a fragment", () => {
    expect(checkUrlPolicy("https://example.com/editorial#section")).toMatch(/fragment/);
  });
  it("rejects a malformed URL", () => {
    expect(checkUrlPolicy("not a url")).toBeDefined();
  });
});

describe("checkAnswerSemantics", () => {
  it("returns no issues for a valid document", () => {
    expect(checkAnswerSemantics(validAnswer())).toEqual([]);
  });

  it("flags a locale that fails the Answer 1.0 profile even when schema-adjacent constants are bypassed", () => {
    const issues = checkAnswerSemantics(validAnswer({ locale: "en_us" }));
    expect(issues.map((i) => i.code)).toContain("answer.semantic.locale_profile_violation");
  });

  it("flags a question that isn't trimmed", () => {
    const issues = checkAnswerSemantics(validAnswer({ question: "  padded  " }));
    expect(issues.map((i) => i.code)).toContain("answer.semantic.not_trimmed");
  });

  it("flags concise_answer over the 500 code-point bound", () => {
    const issues = checkAnswerSemantics(validAnswer({ concise_answer: "x".repeat(501) }));
    expect(issues.map((i) => i.code)).toContain("answer.semantic.code_point_bounds_violation");
  });

  it("counts Unicode code points, not UTF-16 code units, for bounds", () => {
    // U+10000 is one code point but two UTF-16 code units; 500 of them
    // must pass the 500-code-point bound even though `.length` would be 1000.
    const surrogatePairChar = String.fromCodePoint(0x10000);
    const value = surrogatePairChar.repeat(500);
    const issues = checkAnswerSemantics(validAnswer({ concise_answer: value }));
    expect(issues.map((i) => i.code)).not.toContain("answer.semantic.code_point_bounds_violation");
  });

  it("flags published_at after updated_at", () => {
    const issues = checkAnswerSemantics(
      validAnswer({ freshness: { published_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" } })
    );
    expect(issues.map((i) => i.code)).toContain("answer.semantic.timestamp_order_violation");
  });

  it("flags expires_at before updated_at", () => {
    const issues = checkAnswerSemantics(
      validAnswer({
        freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z", expires_at: "2026-08-03T00:00:00Z" },
      })
    );
    expect(issues.map((i) => i.code)).toContain("answer.semantic.timestamp_order_violation");
  });

  it("flags authorship.author.url that is not HTTPS", () => {
    const issues = checkAnswerSemantics(
      validAnswer({ authorship: { kind: "source-authored", author: { name: "Team", url: "http://example.com" } } })
    );
    expect(issues.map((i) => i.code)).toContain("answer.semantic.author_url_policy_violation");
  });

  it("flags duplicate related_entities by canonical {id, normalizedUrl}", () => {
    const ref = { target_type: "service", target: { id: "service:orbit", url: "https://example.com/a/service/orbit.json" } };
    const issues = checkAnswerSemantics(validAnswer({ related_entities: [ref, ref] }));
    expect(issues.map((i) => i.code)).toContain("answer.semantic.duplicate_target");
  });

  it("flags applicability.valid_from not strictly before valid_until", () => {
    const issues = checkAnswerSemantics(
      validAnswer({ applicability: { valid_from: "2026-08-10T00:00:00Z", valid_until: "2026-08-01T00:00:00Z" } })
    );
    expect(issues.map((i) => i.code)).toContain("answer.semantic.applicability_time_range_violation");
  });

  it("flags a content_checksum that does not match the recomputed canonical digest", () => {
    const doc = validAnswer();
    doc.content_checksum = `sha256:${"0".repeat(64)}`;
    const issues = checkAnswerSemantics(doc);
    expect(issues.map((i) => i.code)).toContain("answer.semantic.content_checksum_mismatch");
  });

  it("recomputes content_checksum over x_answer minus content_checksum itself (order-independent of where the field sits)", () => {
    const doc = validAnswer({ answer: "A longer, optional full answer body." });
    expect(checkAnswerSemantics(doc)).toEqual([]);
  });
});

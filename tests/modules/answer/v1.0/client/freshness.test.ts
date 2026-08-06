import { describe, expect, it } from "vitest";
import { classifyAnswerFreshness } from "../../../../../src/modules/answer/v1.0/client/freshness.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import { buildXAnswer } from "./server-helpers.js";

function answer(overrides: Record<string, unknown> = {}): AnswerDocumentV1 {
  return buildXAnswer(overrides) as unknown as AnswerDocumentV1;
}

describe("classifyAnswerFreshness", () => {
  it("is fresh when no expires_at is declared, regardless of clock", () => {
    const doc = answer();
    expect(classifyAnswerFreshness(doc, new Date("2099-01-01T00:00:00Z"))).toBe("fresh");
  });

  it("is fresh strictly before expires_at", () => {
    const doc = answer({ freshness: { published_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" } });
    expect(classifyAnswerFreshness(doc, new Date("2026-06-01T00:00:00Z"))).toBe("fresh");
  });

  it("is stale at or after expires_at", () => {
    const doc = answer({ freshness: { published_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" } });
    expect(classifyAnswerFreshness(doc, new Date("2027-01-01T00:00:00Z"))).toBe("stale");
    expect(classifyAnswerFreshness(doc, new Date("2028-01-01T00:00:00Z"))).toBe("stale");
  });

  it("is pure — the same input/clock always yields the same result", () => {
    const doc = answer({ freshness: { published_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", expires_at: "2027-01-01T00:00:00Z" } });
    const now = new Date("2026-06-01T00:00:00Z");
    expect(classifyAnswerFreshness(doc, now)).toBe(classifyAnswerFreshness(doc, now));
  });
});

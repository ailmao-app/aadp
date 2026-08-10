/**
 * `classifyEvidenceFreshness` (specification.md §14): freshness is a
 * CLIENT-computed classification with an injected clock, not publisher
 * metadata — Evidence `1.0` has no `expires_at` and no `freshness` field.
 */
import { describe, expect, it } from "vitest";
import { classifyEvidenceFreshness, evidenceContentDate } from "../../../../../src/modules/evidence/v1.0/client/freshness.js";
import { buildEvidenceWrapper } from "./server-helpers.js";
import type { EvidenceDocumentV1 } from "../../../../../src/modules/evidence/v1.0/types.js";

function evidence(provenance: Record<string, string>): EvidenceDocumentV1 {
  return buildEvidenceWrapper({ provenance }) as unknown as EvidenceDocumentV1;
}

const DAY = 24 * 60 * 60 * 1000;

describe("content-date precedence", () => {
  it("uses modified_at when present", () => {
    const doc = evidence({ published_at: "2026-01-15T00:00:00Z", modified_at: "2026-03-02T00:00:00Z", retrieved_at: "2026-08-01T00:00:00Z" });
    expect(evidenceContentDate(doc)).toBe("2026-03-02T00:00:00Z");
  });

  it("falls back to published_at when modified_at is absent", () => {
    const doc = evidence({ published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T00:00:00Z" });
    expect(evidenceContentDate(doc)).toBe("2026-01-15T00:00:00Z");
  });

  it("never uses retrieved_at — re-fetching an old source does not make it recent", () => {
    const doc = evidence({ published_at: "2020-01-01T00:00:00Z", retrieved_at: "2026-08-01T00:00:00Z" });
    expect(evidenceContentDate(doc)).toBe("2020-01-01T00:00:00Z");
    expect(classifyEvidenceFreshness(doc, new Date("2026-08-01T00:00:01Z"), 30 * DAY)).toBe("stale");
  });
});

describe("classification uses the injected clock only", () => {
  const doc = evidence({ published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T00:00:00Z" });

  it("is fresh within maxAgeMs", () => {
    expect(classifyEvidenceFreshness(doc, new Date("2026-01-20T00:00:00Z"), 30 * DAY)).toBe("fresh");
  });

  it("is stale past maxAgeMs", () => {
    expect(classifyEvidenceFreshness(doc, new Date("2026-06-20T00:00:00Z"), 30 * DAY)).toBe("stale");
  });

  it("treats exactly maxAgeMs as still fresh", () => {
    expect(classifyEvidenceFreshness(doc, new Date("2026-02-14T00:00:00Z"), 30 * DAY)).toBe("fresh");
  });

  it("is deterministic for one clock value", () => {
    const now = new Date("2026-06-20T00:00:00Z");
    expect(classifyEvidenceFreshness(doc, now, 30 * DAY)).toBe(classifyEvidenceFreshness(doc, now, 30 * DAY));
  });

  it("accepts maxAgeMs 0 as a meaningful boundary", () => {
    expect(classifyEvidenceFreshness(doc, new Date("2026-01-15T00:00:00Z"), 0)).toBe("fresh");
    expect(classifyEvidenceFreshness(doc, new Date("2026-01-15T00:00:01Z"), 0)).toBe("stale");
  });
});

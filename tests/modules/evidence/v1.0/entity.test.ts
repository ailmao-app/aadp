/**
 * Entity-context validation for Evidence `1.0` (specification.md §11): the
 * invariants that need the core envelope around `x_evidence`, which the pure
 * wrapper validator deliberately never sees.
 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";
import { validateDocument } from "../../../../src/validator/index.js";
import {
  validateEvidenceEntityV1,
  parseEvidenceEntityV1,
  EvidenceEntityValidationError,
  validateEvidenceV1,
} from "../../../../src/modules/evidence/v1.0/index.js";

function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

function claimWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  });
}

function evidenceWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  });
}

function entity(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aadp_version: "1.0",
    id: "claim:orbit-uptime-2026",
    type: "claim",
    checksum: checksumOf({}),
    updated_at: "2026-08-06T09:00:00Z",
    canonical_url: "https://example.com/claims/orbit-uptime-2026",
    data: {},
    x_evidence: claimWrapper(),
    ...over,
  };
}

function evidenceEntity(over: Record<string, unknown> = {}, wrapperOver: Record<string, unknown> = {}): Record<string, unknown> {
  return entity({
    id: "evidence:orbit-status-report-2026",
    type: "evidence",
    canonical_url: "https://example.com/evidence/orbit-status-report-2026",
    updated_at: "2026-08-06T09:00:00Z",
    x_evidence: evidenceWrapper(wrapperOver),
    ...over,
  });
}

const codes = (result: { semanticIssues: { code: string }[] }) => result.semanticIssues.map((i) => i.code);

describe("validateEvidenceEntityV1", () => {
  it("accepts a valid claim entity and returns the typed document", () => {
    const result = validateEvidenceEntityV1(entity());
    expect(result.valid).toBe(true);
    expect(result.entity?.kind).toBe("claim");
    expect(result.entity?.document.kind).toBe("claim");
  });

  it("accepts a valid evidence entity", () => {
    const result = validateEvidenceEntityV1(evidenceEntity());
    expect(result.valid).toBe(true);
    expect(result.entity?.kind).toBe("evidence");
  });

  it("rejects an entity whose type is neither claim nor evidence", () => {
    expect(codes(validateEvidenceEntityV1(entity({ type: "answer" })))).toContain("evidence.semantic.entity_type_mismatch");
  });

  it("rejects an entity whose type and wrapper kind disagree", () => {
    const result = validateEvidenceEntityV1(entity({ type: "evidence" }));
    expect(result.valid).toBe(false);
    // Dispatched by entity type; the wrapper's `kind` constant is what rejects it.
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("requires an x_evidence wrapper", () => {
    const { x_evidence: _drop, ...withoutWrapper } = entity();
    expect(codes(validateEvidenceEntityV1(withoutWrapper))).toContain("evidence.semantic.missing_x_evidence");
  });

  it("requires a canonical_url and applies the shared URL policy to it", () => {
    const { canonical_url: _drop, ...withoutUrl } = entity();
    expect(codes(validateEvidenceEntityV1(withoutUrl))).toContain("evidence.semantic.missing_canonical_url");
    expect(codes(validateEvidenceEntityV1(entity({ canonical_url: "http://example.com/claims/x" })))).toContain(
      "evidence.semantic.canonical_url_policy_violation"
    );
    expect(codes(validateEvidenceEntityV1(entity({ canonical_url: "https://example.com/claims/x#frag" })))).toContain(
      "evidence.semantic.canonical_url_policy_violation"
    );
  });

  describe("retrieved_at vs entity.updated_at is ORDERING, not equality (ADR-0010 §5)", () => {
    it("accepts retrieved_at strictly earlier than updated_at — a correction without re-retrieval", () => {
      const result = validateEvidenceEntityV1(
        evidenceEntity({ updated_at: "2026-08-06T09:00:00Z" }, { provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" } })
      );
      expect(result.valid).toBe(true);
    });

    it("accepts retrieved_at equal to updated_at", () => {
      const result = validateEvidenceEntityV1(
        evidenceEntity({ updated_at: "2026-08-01T09:00:00Z" }, { provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" } })
      );
      expect(result.valid).toBe(true);
    });

    it("rejects retrieved_at later than updated_at", () => {
      const result = validateEvidenceEntityV1(
        evidenceEntity({ updated_at: "2026-07-01T00:00:00Z" }, { provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" } })
      );
      expect(codes(result)).toContain("evidence.semantic.retrieved_at_order_violation");
    });

    it("does not apply the ordering rule to a claim entity, which has no provenance", () => {
      expect(validateEvidenceEntityV1(entity({ updated_at: "2020-01-01T00:00:00Z" })).valid).toBe(true);
    });
  });

  it("parseEvidenceEntityV1 throws a structured error carrying the same result", () => {
    expect(() => parseEvidenceEntityV1(entity({ type: "answer" }))).toThrow(EvidenceEntityValidationError);
    try {
      parseEvidenceEntityV1(entity({ type: "answer" }));
    } catch (err) {
      expect((err as EvidenceEntityValidationError).result.valid).toBe(false);
    }
  });
});

describe("wrapper-level dispatch", () => {
  it("reports an unrecognizable kind instead of guessing one of the two", () => {
    const result = validateEvidenceV1({ module: "aadp:evidence", version: "1.0", kind: "source" });
    expect(result.valid).toBe(false);
    expect(result.semanticIssues.map((i) => i.code)).toEqual(["evidence.semantic.unknown_document_kind"]);
  });
});

describe("core-only compatibility", () => {
  it("a core v1.0 consumer validates the entity and ignores x_evidence entirely", () => {
    // `x_*` is the released core extension point: an entity carrying an
    // Evidence wrapper is a perfectly ordinary core entity, and a core-only
    // consumer neither needs the module nor is affected by it.
    expect(validateDocument({ version: "1.0", kind: "entity", data: entity() }).valid).toBe(true);
    expect(validateDocument({ version: "1.0", kind: "entity", data: evidenceEntity() }).valid).toBe(true);
    // Even a wrapper this package would reject stays invisible to core.
    expect(validateDocument({ version: "1.0", kind: "entity", data: entity({ x_evidence: { kind: "nonsense" } }) }).valid).toBe(true);
  });
});

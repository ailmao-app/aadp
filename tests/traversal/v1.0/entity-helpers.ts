/**
 * Entity builders shared by the traversal Phase 1 tests.
 *
 * They produce entities that the RELEASED module validators accept, so a test
 * asserting "this extension was planned" is asserting about the same payloads a
 * standalone module client would accept — not about a shape invented here.
 */
import { checksumOf } from "../../../src/canonical-json/checksum.js";
import type { EntityV1 } from "../../../src/client/v1.0/index.js";

/** Seals a module wrapper with the `content_checksum` its semantic validator verifies. */
function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

export const ANSWER_UPDATED_AT = "2026-08-06T00:00:00Z";

export function answerWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is Orbit?",
    concise_answer: "Orbit is a neutral example service.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: ANSWER_UPDATED_AT },
    related_entities: [
      {
        target_type: "claim",
        target: { id: "claim:orbit-uptime-2026", url: "https://example.com/entities/claim/orbit-uptime.json" },
      },
    ],
    ...over,
  });
}

export function generatedSummaryAuthorship(): Record<string, unknown> {
  return {
    kind: "generated-summary",
    generator: { name: "Example Summarizer" },
    generated_at: "2026-08-05T00:00:00Z",
    source_targets: [
      {
        target_type: "document",
        target: { id: "document:orbit-overview", url: "https://example.com/entities/document/orbit-overview.json" },
      },
    ],
  };
}

export function claimWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "claim",
    statement: "Orbit reported 99.9% uptime in 2026.",
    locale: "en",
    evidence_refs: [
      {
        target_type: "evidence",
        target: { id: "evidence:orbit-report", url: "https://example.com/entities/evidence/orbit-report.json" },
        stance: "support",
      },
    ],
    ...over,
  });
}

export function evidenceWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "evidence",
    summary: "Annual status report published by Example Orbit.",
    locale: "en",
    source: {
      title: "Orbit 2026 Status Report",
      url: "https://example.com/reports/2026-status",
      publisher: { name: "Example Orbit", url: "https://example.com" },
      access: "public",
    },
    provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" },
    ...over,
  });
}

/** A `relation-set` with one `one`-cardinality item and one inline `many` item. */
export function relationSet(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    module: "aadp:relations",
    version: "1.0",
    kind: "relation-set",
    items: [
      {
        rel: "creator",
        target_type: "character",
        cardinality: "one",
        target: { id: "character:phu_diep", url: "https://example.com/entities/character/phu_diep.json" },
      },
      {
        rel: "related",
        target_type: "document",
        cardinality: "many",
        targets: [
          { id: "document:a", url: "https://example.com/entities/document/a.json" },
          { id: "document:b", url: "https://example.com/entities/document/b.json" },
        ],
      },
    ],
    ...over,
  };
}

export function entityOf(over: Record<string, unknown> = {}): EntityV1 {
  return {
    aadp_version: "1.0",
    id: "answer:what-is-orbit",
    type: "answer",
    checksum: checksumOf({}),
    updated_at: ANSWER_UPDATED_AT,
    canonical_url: "https://example.com/entities/answer/what-is-orbit.json",
    data: {},
    ...over,
  } as EntityV1;
}

export function answerEntity(over: Record<string, unknown> = {}): EntityV1 {
  return entityOf({ x_answer: answerWrapper(), ...over });
}

export function claimEntity(over: Record<string, unknown> = {}): EntityV1 {
  return entityOf({
    id: "claim:orbit-uptime-2026",
    type: "claim",
    canonical_url: "https://example.com/entities/claim/orbit-uptime.json",
    x_evidence: claimWrapper(),
    ...over,
  });
}

export function evidenceEntity(over: Record<string, unknown> = {}): EntityV1 {
  return entityOf({
    id: "evidence:orbit-report",
    type: "evidence",
    canonical_url: "https://example.com/entities/evidence/orbit-report.json",
    x_evidence: evidenceWrapper(),
    ...over,
  });
}

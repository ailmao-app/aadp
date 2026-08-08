/**
 * AADP Answer Module v1.0 wire types. Field shapes mirror
 * `schemas/modules/answer/v1.0/*.schema.json` and
 * `spec/modules/answer/v1.0/specification.md`.
 *
 * Deliberately independent of `../../../client/v1.0/types.ts` (the core
 * entity envelope) and of `../../relations/v1.0/types.ts` (only
 * `RelationTargetV1` is reused, by reference, never redefined here).
 *
 * Unlike Relations, Answer `1.0` wrapper objects do NOT accept an `x_*`
 * vendor extension point (specification.md "Field contract" — "Extension
 * vendor trong Answer wrapper chưa được hỗ trợ ở 1.0"), so none of these
 * interfaces extend an `ExtensionFields` index signature.
 */
import type { RelationTargetV1 } from "../../relations/v1.0/types.js";

/** specification.md "Related entity and Evidence boundary". */
export interface AnswerEntityReferenceV1 {
  target_type: string;
  target: RelationTargetV1;
}

/** specification.md "Authorship contract" — source-authored branch. */
export interface AnswerAuthorshipSourceAuthoredV1 {
  kind: "source-authored";
  author: {
    name: string;
    url?: string;
  };
}

/** specification.md "Authorship contract" — generated-summary branch. */
export interface AnswerAuthorshipGeneratedSummaryV1 {
  kind: "generated-summary";
  generator: {
    name: string;
    version?: string;
  };
  generated_at: string;
  source_targets: AnswerEntityReferenceV1[];
  reviewed_by?: { name: string };
}

/** Tagged union discriminated by `kind`; the two branches are mutually exclusive. */
export type AnswerAuthorshipV1 = AnswerAuthorshipSourceAuthoredV1 | AnswerAuthorshipGeneratedSummaryV1;

/** specification.md "Freshness contract". */
export interface AnswerFreshnessV1 {
  published_at: string;
  updated_at: string;
  reviewed_at?: string;
  expires_at?: string;
}

/** specification.md "Applicability contract". */
export interface AnswerApplicabilityV1 {
  audiences?: string[];
  jurisdictions?: string[];
  valid_from?: string;
  valid_until?: string;
  notes?: string;
}

/**
 * specification.md "Wire boundary" — top-level module document kind
 * `answer`: the value of an AADP v1.0 entity's `x_answer` field. Nested
 * inside an already-versioned entity, so it self-describes
 * `module`/`version`/`kind` but not `aadp_version`.
 */
export interface AnswerDocumentV1 {
  module: "aadp:answer";
  version: "1.0";
  kind: "answer";
  question: string;
  concise_answer: string;
  answer?: string;
  locale: string;
  authorship: AnswerAuthorshipV1;
  freshness: AnswerFreshnessV1;
  /** `sha256:<64 hex>` digest over `x_answer` minus this field — see "Content checksum contract". */
  content_checksum: string;
  applicability?: AnswerApplicabilityV1;
  related_entities?: AnswerEntityReferenceV1[];
}

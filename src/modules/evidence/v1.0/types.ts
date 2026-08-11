/**
 * AADP Evidence & Provenance Module v1.0 wire types. Field shapes mirror
 * `schemas/modules/evidence/v1.0/*.schema.json` and
 * `spec/modules/evidence/v1.0/specification.md`.
 *
 * Deliberately independent of `../../../client/v1.0/types.ts` (the core
 * entity envelope) and of `../../relations/v1.0/types.ts` (only
 * `RelationTargetV1` is reused, by reference, never redefined here).
 *
 * Like Answer `1.0` — and unlike Relations — Evidence `1.0` wrapper objects
 * do NOT accept an `x_*` vendor extension point (specification.md §5), so
 * none of these interfaces extend an `ExtensionFields` index signature. The
 * Relations extension point on `EvidenceReferenceV1["target"]` is untouched.
 */
import type { RelationTargetV1 } from "../../relations/v1.0/types.js";

/** specification.md §7 — a producer assertion about the relationship between evidence and claim, never a conclusion about truth value. */
export type EvidenceStanceV1 = "support" | "contradict" | "neutral";

/**
 * specification.md §12 — presentation metadata about the source OUTSIDE
 * AADP. It grants nothing and takes part in no traversal, authorization or
 * conformance decision.
 */
export type EvidenceAccessV1 = "public" | "authenticated" | "restricted";

/** specification.md §7 — the only edge in the model: claim → evidence. */
export interface EvidenceReferenceV1 {
  /** Constant `evidence`: what makes the `1.0` model acyclic by construction (§7.1). */
  target_type: "evidence";
  target: RelationTargetV1;
  stance: EvidenceStanceV1;
  /** `[0, 1]`, at most 2 decimals. Absent means "not declared" — not `0`, not `1`. */
  confidence?: number;
}

/** specification.md §5.3 — where the evidence came from; never fetched by this package. */
export interface EvidenceSourceV1 {
  title: string;
  url: string;
  publisher: {
    name: string;
    url?: string;
  };
  access: EvidenceAccessV1;
}

/** specification.md §8 — `retrieved_at` is when the producer fetched the source, never the date of the content. */
export interface EvidenceProvenanceV1 {
  published_at: string;
  retrieved_at: string;
  modified_at?: string;
}

/**
 * specification.md §4 — top-level module document kind `claim`: the value of
 * an AADP v1.0 entity's `x_evidence` field on an entity of `type: "claim"`.
 * Nested inside an already-versioned entity, so it self-describes
 * `module`/`version`/`kind` but not `aadp_version`.
 */
export interface EvidenceClaimDocumentV1 {
  module: "aadp:evidence";
  version: "1.0";
  kind: "claim";
  statement: string;
  locale: string;
  /** 1-50 references, no two sharing a canonical target identity (§7). */
  evidence_refs: EvidenceReferenceV1[];
  /** `sha256:<64 hex>` digest over `x_evidence` minus this field — see §9. */
  content_checksum: string;
  notes?: string;
}

/** specification.md §4 — top-level module document kind `evidence`, on an entity of `type: "evidence"`. */
export interface EvidenceDocumentV1 {
  module: "aadp:evidence";
  version: "1.0";
  kind: "evidence";
  summary: string;
  locale: string;
  source: EvidenceSourceV1;
  provenance: EvidenceProvenanceV1;
  /** `sha256:<64 hex>` digest over `x_evidence` minus this field — see §9. */
  content_checksum: string;
  excerpt?: string;
}

/** Either top-level Evidence `1.0` document kind, discriminated by `kind`. */
export type EvidenceModuleDocumentV1 = EvidenceClaimDocumentV1 | EvidenceDocumentV1;

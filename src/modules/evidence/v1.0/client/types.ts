/**
 * Wire-adjacent types for the Evidence v1.0 client layer. Deliberately
 * separate from `../types.ts` (the wire shapes) — mirrors
 * `../../../answer/v1.0/client/types.ts`.
 */
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { RelationsClientOptions, RelationsTraversalBudgetState } from "../../../relations/v1.0/client/index.js";
import type { ClientOptions } from "../../../../client/v1.0/index.js";
import type { AnswerEntityReferenceV1 } from "../../../answer/v1.0/types.js";
import type { AnswerTargetResolutionStatus } from "../../../answer/v1.0/client/types.js";
import type { EvidenceClaimDocumentV1, EvidenceDocumentV1, EvidenceStanceV1 } from "../types.js";

export type EvidenceFreshnessState = "fresh" | "stale";

/**
 * specification.md §10.2 — the status vocabulary is the one Answer `1.0`
 * released, reused as is. This alias exists so Evidence consumers have a
 * name in their own module's vocabulary; it is NOT a new enum, and the two
 * types are interchangeable by construction.
 */
export type EvidenceTargetResolutionStatus = AnswerTargetResolutionStatus;

/** The two Evidence `1.0` document kinds, as observed on a resolved entity. */
export type EvidenceNodeKindV1 = "claim" | "evidence";

export type EvidenceClientOptions = ClientOptions;

export interface EvidenceResolveOptions extends RelationsClientOptions {
  /** Caller-owned traversal budget, shared with the rest of the traversal this resolution is part of — Evidence never creates a child budget (specification.md §10.3). */
  budget: RelationsTraversalBudgetState;
}

/**
 * One canonical target in the graph. `status` describes ONLY the
 * fetch/schema/checksum outcome of that target — it never carries any
 * reference's `target_type` verdict, which is per-occurrence and lives on
 * `EvidenceGraphReference`/`EvidenceGraphEdge` (specification.md §10.4-10.5).
 * Keeping the two apart is what stops one reference declaring the wrong type
 * from poisoning another reference pointing at the same target.
 */
export interface EvidenceGraphNode<T = unknown> {
  /** Canonical `{id, normalizedUrl}` key — the released Relations identity rule. */
  key: string;
  /** Derived from the validated document, never from a reference's declaration. Absent while the target could not be resolved. */
  kind?: EvidenceNodeKindV1;
  status: EvidenceTargetResolutionStatus;
  /** Present only when `status === "resolved"`. */
  entity?: EntityV1<T>;
  /** Present only when `status === "resolved"`. */
  document?: EvidenceClaimDocumentV1 | EvidenceDocumentV1;
  /** Present for every status other than `"resolved"`. */
  message?: string;
}

/** One occurrence in `answer.related_entities`, with its own verdict. */
export interface EvidenceGraphReference {
  /** Index in the Answer's ORIGINAL `related_entities`, not an index into the filtered subset. */
  index: number;
  reference: AnswerEntityReferenceV1;
  /** Canonical key of the corresponding node. */
  key: string;
  /** This reference's OWN verdict, including a `target_type` mismatch reported as `invalid`. */
  status: EvidenceTargetResolutionStatus;
  message?: string;
}

/** One occurrence in `claim.evidence_refs`, with its own verdict. */
export interface EvidenceGraphEdge {
  /** `key` of the claim node. Empty string for the caller-supplied root claim of `resolveClaimEvidenceV1`, which has no canonical target of its own. */
  from: string;
  /** `key` of the evidence node. */
  to: string;
  /** Index within `claim.evidence_refs`, so an edge is traceable back to the wire. */
  index: number;
  stance: EvidenceStanceV1;
  confidence?: number;
  status: EvidenceTargetResolutionStatus;
  message?: string;
}

/**
 * Result of `resolveClaimEvidenceV1`/`resolveAnswerEvidenceV1`
 * (specification.md §10.5). A node that could not be resolved still appears
 * in `nodes`, and an edge/reference entry always exists when the wire has a
 * ref — so a consumer can tell "no ref" apart from "a ref whose fetch
 * failed".
 */
export interface EvidenceGraph<T = unknown> {
  /** Exactly one node per canonical target, in discovery order (direct references first, then expansion). Never re-sorted. */
  nodes: EvidenceGraphNode<T>[];
  /** Direct Answer references in input order. Empty for `resolveClaimEvidenceV1`. */
  references: EvidenceGraphReference[];
  /** Ordered by (claim discovery index, ref index). */
  edges: EvidenceGraphEdge[];
  /** True when the walk stopped before every reference was attempted (budget exhausted / caller abort). */
  partial: boolean;
}

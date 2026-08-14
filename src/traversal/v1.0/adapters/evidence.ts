/**
 * Built-in traversal adapter for `aadp:evidence@1.0` / `x_evidence`
 * (edge matrix rows 5-6).
 */
import type { EntityV1 } from "../../../client/v1.0/index.js";
import {
  validateEvidenceEntityV1,
  type EvidenceClaimDocumentV1,
  type ValidatedEvidenceEntityV1,
} from "../../../modules/evidence/v1.0/index.js";
import type {
  TraversalAdapter,
  TraversalEdgePlan,
  TraversalParseResult,
  TraversalPlanContext,
} from "../types.js";

export const EVIDENCE_EXTENSION_FIELD = "x_evidence" as const;
export const EVIDENCE_REF_EDGE_GROUP = "evidence.evidence_ref";

export const evidenceTraversalAdapter: TraversalAdapter<ValidatedEvidenceEntityV1> = {
  key: {
    moduleId: "aadp:evidence",
    moduleVersion: "1.0",
    extensionField: EVIDENCE_EXTENSION_FIELD,
  },
  capabilities: {
    // `x_evidence` appears on both document kinds; only `claim` has edges.
    sourceKinds: ["claim", "evidence"],
    edgeGroups: [EVIDENCE_REF_EDGE_GROUP],
    fetchesTargets: true,
  },

  /**
   * Keeps the whole validated result as the document, because the two Evidence
   * document kinds share one extension field and `kind` is the discriminator
   * `planEdges` needs to tell a claim from an evidence entity.
   */
  parseExtension(entity: EntityV1): TraversalParseResult<ValidatedEvidenceEntityV1> {
    const result = validateEvidenceEntityV1(entity);
    if (!result.valid || !result.entity) {
      return { ok: false, errors: result.errors, semanticIssues: result.semanticIssues };
    }
    return { ok: true, document: result.entity };
  },

  /**
   * Row 5: a claim plans one edge per `evidence_refs[]` entry, `expandable:
   * false` — the Evidence `1.0` model is acyclic by construction because an
   * evidence node has no outgoing edge at all. Row 6: an evidence entity plans
   * nothing; `source.url` and `publisher.url` are presentation metadata about a
   * source OUTSIDE AADP and are NEVER fetched.
   */
  planEdges(
    document: ValidatedEvidenceEntityV1,
    _entity: EntityV1,
    _context: TraversalPlanContext
  ): TraversalEdgePlan[] {
    if (document.kind !== "claim") return [];
    const claim = document.document as EvidenceClaimDocumentV1;
    return claim.evidence_refs.map((reference, index) => ({
      edgeGroup: EVIDENCE_REF_EDGE_GROUP,
      index,
      target: reference.target,
      declaredTargetType: reference.target_type,
      expandable: false,
    }));
  },
};

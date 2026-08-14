/**
 * Built-in traversal adapter for `aadp:answer@1.0` / `x_answer`
 * (edge matrix rows 3-4).
 */
import type { EntityV1 } from "../../../client/v1.0/index.js";
import {
  validateAnswerEntityV1,
  type AnswerDocumentV1,
} from "../../../modules/answer/v1.0/index.js";
import type {
  TraversalAdapter,
  TraversalEdgePlan,
  TraversalParseResult,
  TraversalPlanContext,
} from "../types.js";

export const ANSWER_EXTENSION_FIELD = "x_answer" as const;
export const ANSWER_RELATED_ENTITY_EDGE_GROUP = "answer.related_entity";
export const ANSWER_SOURCE_TARGET_EDGE_GROUP = "answer.source_target";

export const answerTraversalAdapter: TraversalAdapter<AnswerDocumentV1> = {
  key: {
    moduleId: "aadp:answer",
    moduleVersion: "1.0",
    extensionField: ANSWER_EXTENSION_FIELD,
  },
  capabilities: {
    sourceKinds: ["answer"],
    edgeGroups: [ANSWER_RELATED_ENTITY_EDGE_GROUP, ANSWER_SOURCE_TARGET_EDGE_GROUP],
    fetchesTargets: true,
  },

  /**
   * Uses the released ENTITY-context validator, not the wrapper-only
   * `validateAnswerV1`: `x_answer` is only meaningful on an entity of
   * `type: "answer"` whose `updated_at` matches the wrapper's freshness, and an
   * adapter that accepted less than the module client does would let traversal
   * build edges out of a document the module client would reject.
   */
  parseExtension(entity: EntityV1): TraversalParseResult<AnswerDocumentV1> {
    const result = validateAnswerEntityV1(entity);
    if (!result.valid || !result.entity) {
      return { ok: false, errors: result.errors, semanticIssues: result.semanticIssues };
    }
    return { ok: true, document: result.entity.answer };
  },

  /**
   * Row 3 is unconditional; row 4 (`authorship.source_targets`) is the one
   * deliberate widening over Evidence `1.0` and stays behind the caller's
   * explicit `includeGeneratedSummarySources` opt-in, default `false`. It only
   * exists on the `generated-summary` authorship branch.
   *
   * `index` is the position in the wire array of that edge group.
   */
  planEdges(document: AnswerDocumentV1, _entity: EntityV1, context: TraversalPlanContext): TraversalEdgePlan[] {
    const plans: TraversalEdgePlan[] = [];
    document.related_entities?.forEach((reference, index) => {
      plans.push({
        edgeGroup: ANSWER_RELATED_ENTITY_EDGE_GROUP,
        index,
        target: reference.target,
        declaredTargetType: reference.target_type,
        expandable: true,
      });
    });
    if (context.includeGeneratedSummarySources && document.authorship.kind === "generated-summary") {
      document.authorship.source_targets.forEach((reference, index) => {
        plans.push({
          edgeGroup: ANSWER_SOURCE_TARGET_EDGE_GROUP,
          index,
          target: reference.target,
          declaredTargetType: reference.target_type,
          expandable: true,
        });
      });
    }
    return plans;
  },
};

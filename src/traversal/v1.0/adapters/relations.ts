/**
 * Built-in traversal adapter for `aadp:relations@1.0` / `x_relations`
 * (edge matrix rows 1-2).
 *
 * Validation is delegated to the module's own released validator, never
 * re-implemented here, so traversal accepts exactly the payloads a standalone
 * Relations client accepts (ADR-0011 §2).
 */
import type { EntityV1 } from "../../../client/v1.0/index.js";
import {
  validateRelationsDocument,
  type RelationSetV1,
} from "../../../modules/relations/v1.0/index.js";
import type {
  TraversalAdapter,
  TraversalEdgePlan,
  TraversalParseResult,
  TraversalPlanContext,
} from "../types.js";

export const RELATIONS_EXTENSION_FIELD = "x_relations" as const;
export const RELATIONS_ITEM_EDGE_GROUP = "relations.item";
export const RELATIONS_COLLECTION_EDGE_GROUP = "relations.collection";

/**
 * Row 1 of the edge matrix. `x_relations` is defined on entities of ANY type,
 * so the adapter declares the wildcard source kind; what rejects a malformed
 * payload is `validateRelationsDocument`, not a type check here.
 */
export const relationsTraversalAdapter: TraversalAdapter<RelationSetV1> = {
  key: {
    moduleId: "aadp:relations",
    moduleVersion: "1.0",
    extensionField: RELATIONS_EXTENSION_FIELD,
  },
  capabilities: {
    sourceKinds: ["*"],
    edgeGroups: [RELATIONS_ITEM_EDGE_GROUP, RELATIONS_COLLECTION_EDGE_GROUP],
    fetchesTargets: true,
  },

  parseExtension(entity: EntityV1): TraversalParseResult<RelationSetV1> {
    const payload = (entity as { x_relations?: unknown }).x_relations;
    const result = validateRelationsDocument("relation-set", payload);
    if (!result.valid) {
      return { ok: false, errors: result.errors, semanticIssues: result.semanticIssues };
    }
    return { ok: true, document: payload as RelationSetV1 };
  },

  /**
   * Plans one edge per inline target, in wire order: for each item, its `target`
   * then each element of `targets`. `index` is the position of the occurrence in
   * that flattened wire order for this edge group on this entity, so a consumer
   * can trace an edge back to the occurrence that produced it.
   *
   * Row 2 (`items[].collection`) is deliberately NOT planned here. A collection
   * link carries a page URL and no target identity, and its edges are one per
   * item of each fetched page — producing them requires paging the collection,
   * which is a request. Adapters are pure and cannot fetch (ADR-0011 §2), so
   * collection edges belong to the scheduler, which reads
   * `context.followCollections` when it pages. This adapter still declares the
   * `relations.collection` edge group because those edges originate from its
   * extension field.
   */
  planEdges(document: RelationSetV1, _entity: EntityV1, _context: TraversalPlanContext): TraversalEdgePlan[] {
    const plans: TraversalEdgePlan[] = [];
    for (const item of document.items) {
      const targets = [...(item.target ? [item.target] : []), ...(item.targets ?? [])];
      for (const target of targets) {
        plans.push({
          edgeGroup: RELATIONS_ITEM_EDGE_GROUP,
          index: plans.length,
          target,
          declaredTargetType: item.target_type,
          expandable: true,
        });
      }
    }
    return plans;
  },
};

/**
 * Multi-hop Relations graph traversal (`AADP-REL-005`). `resolveRelationItem`
 * (`./resolve.ts`) resolves one entity's direct relations; this walks
 * further by fetching a resolved target's own entity, checking it for an
 * `x_relations` of its own, and resolving those too — up to `maxDepth`
 * (root = 0, each edge = +1), with the graph-cycle containment documented
 * on `markExpanded`.
 */
import { fetchEntity, AbortedError, type ClientOptions } from "../../../../client/v1.0/index.js";
import { AadpDiscoveryBudgetExceededError } from "../../../../client/discovery-budget.js";
import type { EntityV1 } from "../../../../client/v1.0/types.js";
import type { RelationSetV1 } from "../types.js";
import { validateRelationsKind } from "./fetch.js";
import { resolveRelationItem, type ResolveRelationItemOptions } from "./resolve.js";
import { chargeNode, createRelationsTraversalBudget, markExpanded, type RelationsTraversalBudgetState, type RelationsTraversalLimits } from "./budget.js";
import type { RelationsResolutionResult, RelationsTraversalIssue, TraversedRelationEdge } from "./types.js";

export interface TraverseRelationsOptions extends ResolveRelationItemOptions, RelationsTraversalLimits {
  /**
   * Also expand a resolved target's own `x_relations`, recursing up to
   * `maxDepth`. Default `false`: only the root's direct relations are
   * resolved (depth 1), matching `resolveRelationItem` used standalone.
   */
  followEdges?: boolean;
  /** Threads one budget across multiple calls sharing a walk. Created fresh from the other limit options when omitted. */
  budget?: RelationsTraversalBudgetState;
}

function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

/**
 * Fetches `rootEntityUrl` (depth 0) and resolves its `x_relations` (depth
 * 1), optionally continuing into resolved targets' own relations up to
 * `maxDepth` when `followEdges` is set. Reuses `resolveRelationItem` for
 * every edge, so cardinality dispatch, per-branch issue containment, and
 * budget charging behave identically whether called through here or
 * directly. Never throws for a per-branch issue — only for the global
 * stop conditions documented on `resolveRelationItem`.
 */
export async function traverseRelations(
  rootEntityUrl: string,
  options: TraverseRelationsOptions = {}
): Promise<RelationsResolutionResult<TraversedRelationEdge>> {
  const budget = options.budget ?? createRelationsTraversalBudget(options);
  const rootOrigin = options.rootOrigin ?? safeOrigin(rootEntityUrl);
  const resolvedOptions: ResolveRelationItemOptions = { ...options, rootOrigin };

  const edges: TraversedRelationEdge[] = [];
  const issues: RelationsTraversalIssue[] = [];
  let partial = false;

  async function expand(entity: EntityV1, entityUrl: string, depth: number): Promise<void> {
    if (!markExpanded(budget, entity.id, entityUrl)) return; // already expanded — graph cycle contained here

    const xRelations = (entity as unknown as { x_relations?: unknown }).x_relations;
    if (xRelations === undefined) return;

    const validation = validateRelationsKind("relation-set", xRelations);
    if (!validation.valid) {
      partial = true;
      issues.push({
        level: "error",
        code: "invalid_module_document",
        message: `Entity ${entity.id}'s x_relations failed Relations v1.0 validation.`,
        url: entityUrl,
      });
      return;
    }
    const relationSet = xRelations as RelationSetV1;

    for (const item of relationSet.items) {
      let result;
      try {
        result = await resolveRelationItem(item, entity.id, depth + 1, resolvedOptions, budget);
      } catch (err) {
        // `resolveRelationItem` itself already contains per-branch issues
        // (blocked URL, cursor cycle, ...) inside a `RelationsResolutionResult`
        // without throwing. What CAN still escape it uncaught is a global
        // stop raised before it even starts dispatching cardinality — its
        // own `chargeDepth(budget, depth, ...)` call at the top — since
        // that happens outside any of its internal try/catch blocks. An
        // `AbortedError` still propagates (a caller cancellation must stop
        // everything, immediately); a budget error is folded into this
        // walk's partial result instead, exactly like every other
        // budget-exceeded condition this function handles.
        if (err instanceof AadpDiscoveryBudgetExceededError) {
          partial = true;
          issues.push({ level: "error", code: "traversal_budget_exceeded", message: (err as Error).message, rel: item.rel });
          return;
        }
        throw err;
      }
      if (result.partial) partial = true;
      issues.push(...result.issues);
      for (const target of result.items) {
        edges.push({ depth: depth + 1, sourceId: entity.id, item, target });
        if (options.followEdges && target.entity) {
          await expand(target.entity, target.hint.url, depth + 1);
        }
      }
    }
  }

  const root = await fetchEntity(rootEntityUrl, resolvedOptions, budget);
  // Root counts as a node exactly like any resolved target, charged under
  // its real id/url now that both are known — there's no relation item
  // pointing at the root to have charged it via `resolveRelationTarget`.
  // If a cycle elsewhere in the graph resolves an edge back to this same
  // {id, url}, `chargeNode` there sees it as already visited, same as any
  // other duplicate target.
  chargeNode(budget, root.id, rootEntityUrl, "traverseRelations root");
  await expand(root, rootEntityUrl, 0);

  return { items: edges, partial, issues };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export type { ClientOptions };

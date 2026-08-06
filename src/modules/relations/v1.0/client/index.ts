export {
  createRelationsTraversalBudget,
  canonicalTargetKey,
  isCrossOrigin,
  type RelationsTraversalLimits,
  type RelationsTraversalBudgetState,
} from "./budget.js";
export {
  RelationsSchemaValidationError,
  RelationsIntegrityMismatchError,
  RelationsCursorCycleError,
} from "./errors.js";
export { fetchAndValidateRelationsDocument, validateRelationsKind } from "./fetch.js";
export {
  resolveRelationTarget,
  resolveRelationItem,
  iterateRelationCollection,
  type RelationsClientOptions,
  type ResolveRelationItemOptions,
  type RelationCollectionExpectation,
} from "./resolve.js";
export { traverseRelations, type TraverseRelationsOptions } from "./graph.js";
export type {
  RelationsTraversalIssue,
  ResolvedRelationTarget,
  RelationsResolutionResult,
  TraversedRelationEdge,
} from "./types.js";

/**
 * Public API for AADP Relations Module v1.0 (`ail-aadp/modules/relations/v1.0`).
 * Importing this module registers `aadp:relations@1.0`'s three document
 * kinds into the shared module registry as a side effect (`./register.js`).
 * Deliberately NOT re-exported from the package root — ADR-0007 "Package
 * exports": module APIs live only under their own versioned subpath.
 */
import "./register.js";
import { validateModuleDocument, type ModuleValidationResult } from "../../../module-registry/index.js";
import type { RelationsDocumentKind } from "./schemas.js";

export type {
  RelationCardinality,
  RelationTargetV1,
  RelationCollectionLinkV1,
  RelationItemV1,
  RelationSetV1,
  RelationCollectionV1,
  RelationRegistryEntryV1,
  RelationRegistryV1,
  RelationsDocumentV1,
} from "./types.js";

export {
  relationSetSchema,
  relationCollectionSchema,
  relationRegistrySchema,
  relationItemSchema,
  targetSchema,
  collectionLinkSchema,
  moduleDispatchSchema,
  schemasByKind as relationsSchemasByKind,
  RELATIONS_DOCUMENT_KINDS,
  type RelationsDocumentKind,
} from "./schemas.js";

export {
  checkRelationSetSemantics,
  checkRelationCollectionSemantics,
  checkRelationRegistrySemantics,
  isValidRelationToken,
  STANDARD_RELATION_TOKENS,
} from "./semantic.js";

export { registerRelationsModule } from "./register.js";

// Client/traversal (AADP-REL-005). Reuses core client HTTP/URL-policy/
// scheduler/cancellation; adds only cardinality dispatch, collection
// pagination, and node/depth/cross-origin budget dimensions.
export {
  createRelationsTraversalBudget,
  canonicalTargetKey,
  isCrossOrigin,
  resolveRelationTarget,
  resolveRelationItem,
  iterateRelationCollection,
  traverseRelations,
  fetchAndValidateRelationsDocument,
  RelationsSchemaValidationError,
  RelationsIntegrityMismatchError,
  RelationsCursorCycleError,
  type RelationsTraversalLimits,
  type RelationsTraversalBudgetState,
  type RelationsClientOptions,
  type ResolveRelationItemOptions,
  type RelationCollectionExpectation,
  type TraverseRelationsOptions,
  type RelationsTraversalIssue,
  type ResolvedRelationTarget,
  type RelationsResolutionResult,
  type TraversedRelationEdge,
} from "./client/index.js";

// Conformance (AADP-REL-006). Own suite/check-ID registry, sharing only
// the core `renderCheckLines` report primitive — core `CHECKS` and check
// IDs are never touched (ADR-0007 "Conformance boundary").
export {
  runRelationsConformance,
  renderRelationsTextReport,
  renderRelationsSummary,
  renderRelationsJsonReport,
  renderRelationsJUnitReport,
  relationsExitCodeFor,
  RELATIONS_CHECKS,
  RELATIONS_CONFORMANCE_PROFILES,
  InvalidRelationsConformanceOptionsError,
  type RelationsCheck,
  type RelationsJUnitReportOptions,
  type RelationsConformanceOptions,
  type RelationsConformanceProfile,
  type RelationsConformanceReport,
} from "./conformance/index.js";

const MODULE_ID = "aadp:relations" as const;
const MODULE_VERSION = "1.0" as const;

/**
 * Convenience wrapper over the generic registry's `validateModuleDocument`,
 * pinned to `aadp:relations@1.0` so a neutral consumer can validate any of
 * the three document kinds using only this public export — no need to
 * import the generic `module-registry` subpath or know its key shape.
 */
export function validateRelationsDocument(kind: RelationsDocumentKind, data: unknown): ModuleValidationResult {
  return validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind }, data);
}

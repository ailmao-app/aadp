/**
 * Public API for AADP Evidence & Provenance Module v1.0
 * (`ail-aadp/modules/evidence/v1.0`). Importing this module registers
 * `aadp:evidence@1.0`'s two document kinds into the shared module registry
 * as a side effect (`./register.js`). Deliberately NOT re-exported from the
 * package root — module APIs live only under their own versioned subpath
 * (mirrors `../../answer/v1.0/index.ts`).
 *
 * The shared canonical resolution layer this module's client runs on
 * (`../../shared/canonical-resolution.js`) is internal and is exported from
 * nowhere: its preconditions cannot be checked from outside, and a caller
 * holding the raw state could replay an outcome under a request context it
 * never used (specification.md §16).
 */
import "./register.js";

export type {
  EvidenceStanceV1,
  EvidenceAccessV1,
  EvidenceReferenceV1,
  EvidenceSourceV1,
  EvidenceProvenanceV1,
  EvidenceClaimDocumentV1,
  EvidenceDocumentV1,
  EvidenceModuleDocumentV1,
} from "./types.js";

export {
  claimSchema,
  evidenceSchema,
  evidenceReferenceSchema,
  sourceSchema,
  provenanceSchema,
  moduleDispatchSchema,
  schemasByKind as evidenceSchemasByKind,
  EVIDENCE_DOCUMENT_KINDS,
  type EvidenceDocumentKind,
} from "./schemas.js";

export {
  checkEvidenceClaimSemantics,
  checkEvidenceSemantics,
  isValidEvidenceLocale,
  checkUrlPolicy,
} from "./semantic.js";

export { registerEvidenceModule } from "./register.js";

export {
  validateEvidenceV1,
  validateEvidenceEntityV1,
  parseEvidenceEntityV1,
  EvidenceEntityValidationError,
  type EvidenceValidationIssue,
  type EvidenceValidationResult,
  type EvidenceEntityValidationResult,
  type ValidatedEvidenceEntityV1,
} from "./entity.js";

// Client (fetch / freshness / graph resolution). Reuses the core client's
// HTTP/URL-policy/scheduler, the Relations `1.0` shared traversal budget and
// the shared canonical resolution layer; adds only Evidence-specific
// dispatch and graph assembly.
export {
  EvidenceEntityFetchValidationError,
  classifyEvidenceFreshness,
  evidenceContentDate,
  fetchEvidenceEntityV1,
  resolveClaimEvidenceV1,
  resolveAnswerEvidenceV1,
  type EvidenceClientOptions,
  type EvidenceResolveOptions,
  type EvidenceFreshnessState,
  type EvidenceTargetResolutionStatus,
  type EvidenceNodeKindV1,
  type EvidenceGraph,
  type EvidenceGraphNode,
  type EvidenceGraphReference,
  type EvidenceGraphEdge,
} from "./client/index.js";

// Conformance. Own suite/check-ID registry, sharing only the core
// `renderCheckLines` report primitive — core `CHECKS` and the Relations/
// Answer check IDs are never touched.
export {
  runEvidenceConformance,
  renderEvidenceTextReport,
  renderEvidenceSummary,
  renderEvidenceJsonReport,
  renderEvidenceJUnitReport,
  evidenceExitCodeFor,
  EVIDENCE_CHECKS,
  InvalidEvidenceConformanceOptionsError,
  type EvidenceCheck,
  type EvidenceJUnitReportOptions,
  type EvidenceConformanceOptions,
  type EvidenceConformanceReport,
} from "./conformance/index.js";

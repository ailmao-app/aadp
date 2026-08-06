/**
 * Public API for AADP Answer Module v1.0 (`ail-aadp/modules/answer/v1.0`).
 * Importing this module registers `aadp:answer@1.0`'s single document kind
 * into the shared module registry as a side effect (`./register.js`).
 * Deliberately NOT re-exported from the package root — module APIs live
 * only under their own versioned subpath (mirrors
 * `../../relations/v1.0/index.ts`).
 */
import "./register.js";

export type {
  AnswerEntityReferenceV1,
  AnswerAuthorshipSourceAuthoredV1,
  AnswerAuthorshipGeneratedSummaryV1,
  AnswerAuthorshipV1,
  AnswerFreshnessV1,
  AnswerApplicabilityV1,
  AnswerDocumentV1,
} from "./types.js";

export {
  answerSchema,
  authorshipSchema,
  freshnessSchema,
  applicabilitySchema,
  answerReferenceSchema,
  moduleDispatchSchema,
  schemasByKind as answerSchemasByKind,
  ANSWER_DOCUMENT_KINDS,
  type AnswerDocumentKind,
} from "./schemas.js";

export { checkAnswerSemantics, isValidAnswerLocale, checkUrlPolicy, ANSWER_LOCALE_PATTERN } from "./semantic.js";

export { registerAnswerModule } from "./register.js";

export {
  validateAnswerV1,
  validateAnswerEntityV1,
  parseAnswerEntityV1,
  AnswerEntityValidationError,
  type AnswerValidationIssue,
  type AnswerValidationResult,
  type AnswerEntityValidationResult,
  type ValidatedAnswerEntityV1,
} from "./entity.js";

// Client (fetch / freshness / target resolution). Reuses core client
// HTTP/URL-policy/scheduler and the Relations `1.0` resolver/shared
// traversal budget; adds only Answer-specific dispatch.
export {
  AnswerEntityFetchValidationError,
  classifyAnswerFreshness,
  fetchAnswerEntityV1,
  resolveAnswerTargets,
  type AnswerClientOptions,
  type AnswerResolveOptions,
  type AnswerFreshnessState,
  type AnswerTargetResolutionStatus,
  type AnswerResolvedTargetEntry,
  type AnswerResolvedTargets,
} from "./client/index.js";

// Conformance. Own suite/check-ID registry, sharing only the core
// `renderCheckLines` report primitive — core `CHECKS` and check IDs are
// never touched.
export {
  runAnswerConformance,
  renderAnswerTextReport,
  renderAnswerSummary,
  renderAnswerJsonReport,
  renderAnswerJUnitReport,
  answerExitCodeFor,
  ANSWER_CHECKS,
  InvalidAnswerConformanceOptionsError,
  type AnswerCheck,
  type AnswerJUnitReportOptions,
  type AnswerConformanceOptions,
  type AnswerConformanceReport,
} from "./conformance/index.js";

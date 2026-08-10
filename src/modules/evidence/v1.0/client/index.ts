export { EvidenceEntityFetchValidationError } from "./errors.js";
export { classifyEvidenceFreshness, evidenceContentDate } from "./freshness.js";
export { fetchEvidenceEntityV1 } from "./fetch.js";
export { resolveClaimEvidenceV1, resolveAnswerEvidenceV1 } from "./resolve.js";
export type {
  EvidenceClientOptions,
  EvidenceResolveOptions,
  EvidenceFreshnessState,
  EvidenceTargetResolutionStatus,
  EvidenceNodeKindV1,
  EvidenceGraph,
  EvidenceGraphNode,
  EvidenceGraphReference,
  EvidenceGraphEdge,
} from "./types.js";

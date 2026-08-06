export { runRelationsConformance } from "./runner.js";
export {
  renderRelationsTextReport,
  renderRelationsSummary,
  renderRelationsJsonReport,
  renderRelationsJUnitReport,
  relationsExitCodeFor,
  type RelationsJUnitReportOptions,
} from "./report.js";
export { RELATIONS_CHECKS, type RelationsCheck } from "./checks.js";
export {
  RELATIONS_CONFORMANCE_PROFILES,
  InvalidRelationsConformanceOptionsError,
  type RelationsConformanceOptions,
  type RelationsConformanceProfile,
  type RelationsConformanceReport,
} from "./types.js";

export {
  registerModule,
  getModuleEntry,
  validateModuleDocument,
  assertValidModuleDocument,
  isModuleRegistered,
  type ModuleValidationResult,
} from "./registry.js";
export {
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
  InvalidModuleDocumentError,
} from "./errors.js";
export {
  MODULE_ID_PATTERN,
  isValidModuleId,
  hasModuleSemanticErrors,
  type ModuleRegistryKey,
  type ModuleRegistryEntry,
  type ModuleSemanticValidator,
  type ModuleSemanticIssue,
  type ModuleSemanticIssueLevel,
} from "./types.js";

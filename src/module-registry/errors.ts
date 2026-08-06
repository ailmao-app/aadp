/**
 * The four registry lookup outcomes ADR-0007 requires to stay distinct.
 * The registry never falls back to a different module, version or kind —
 * each miss is its own error type so callers can tell "this module doesn't
 * exist here" apart from "it exists, but not at this version".
 */
import type { ModuleRegistryKey } from "./types.js";

/** No module is registered under this `moduleId`, at any version. */
export class UnsupportedModuleError extends Error {
  readonly code = "unsupported_module" as const;
  constructor(public readonly moduleId: string) {
    super(`Unsupported module "${moduleId}": no version of this module is registered.`);
    this.name = "UnsupportedModuleError";
  }
}

/** `moduleId` is registered, but not at `moduleVersion`. No fallback to another version. */
export class UnsupportedModuleVersionError extends Error {
  readonly code = "unsupported_module_version" as const;
  constructor(
    public readonly moduleId: string,
    public readonly moduleVersion: string
  ) {
    super(
      `Unsupported module version "${moduleVersion}" for module "${moduleId}". The registry never falls back to a different version's schema.`
    );
    this.name = "UnsupportedModuleVersionError";
  }
}

/** `{moduleId, moduleVersion}` is registered, but not for this `kind`. */
export class UnsupportedModuleKindError extends Error {
  readonly code = "unsupported_module_kind" as const;
  constructor(
    public readonly moduleId: string,
    public readonly moduleVersion: string,
    public readonly kind: string
  ) {
    super(`Module "${moduleId}@${moduleVersion}" does not define document kind "${kind}".`);
    this.name = "UnsupportedModuleKindError";
  }
}

/** The registry entry resolved, but `data` itself failed schema or semantic validation. */
export class InvalidModuleDocumentError extends Error {
  readonly code = "invalid_module_document" as const;
  constructor(
    public readonly key: ModuleRegistryKey,
    public readonly errors: unknown[]
  ) {
    super(
      `Document for module "${key.moduleId}@${key.moduleVersion}" kind "${key.kind}" failed validation.`
    );
    this.name = "InvalidModuleDocumentError";
  }
}

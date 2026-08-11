/**
 * Verifies Evidence v1.0 registers into the generic module registry at
 * exactly `{aadp:evidence, 1.0, claim}` and `{aadp:evidence, 1.0, evidence}`,
 * with no fallback across versions/kinds, and that the registered schema
 * snapshots are immutable.
 */
import { describe, expect, it } from "vitest";
import {
  getModuleEntry,
  isModuleRegistered,
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
} from "../../../../src/module-registry/index.js";
import { registerEvidenceModule } from "../../../../src/modules/evidence/v1.0/index.js";

describe("aadp:evidence@1.0 registers into the generic module registry", () => {
  it("is registered under moduleId aadp:evidence", () => {
    expect(isModuleRegistered("aadp:evidence")).toBe(true);
  });

  it("registering again is a no-op rather than a duplicate-key throw", () => {
    expect(() => registerEvidenceModule()).not.toThrow();
  });

  it.each(["claim", "evidence"])("resolves an exact entry for kind %s", (kind) => {
    const entry = getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind });
    expect(entry.schema).toBeTypeOf("object");
    expect(entry.validateSemantics).toBeTypeOf("function");
  });

  it("does not register component schemas (source/provenance/evidence-reference) as document kinds", () => {
    for (const kind of ["source", "provenance", "evidence-reference"]) {
      expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind })).toThrow(UnsupportedModuleKindError);
    }
  });

  it("throws UnsupportedModuleVersionError for a version that was never registered, without falling back to 1.0", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.1", kind: "claim" })).toThrow(
      UnsupportedModuleVersionError
    );
    expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "2.0", kind: "evidence" })).toThrow(
      UnsupportedModuleVersionError
    );
  });

  it("throws UnsupportedModuleKindError for an unregistered kind under the registered version", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "evidence-collection" })).toThrow(
      UnsupportedModuleKindError
    );
  });

  it("throws UnsupportedModuleError for an unrelated moduleId", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:citation", moduleVersion: "1.0", kind: "claim" })).toThrow(UnsupportedModuleError);
  });

  it.each(["claim", "evidence"])("returns a frozen %s schema snapshot that cannot desync from the compiled validator", (kind) => {
    const entry = getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind });
    expect(Object.isFrozen(entry.schema)).toBe(true);
  });
});

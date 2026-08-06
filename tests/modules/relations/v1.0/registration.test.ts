/**
 * Verifies Relations v1.0 registers into the generic module registry
 * (`AADP-MODULE-REGISTRY`) at exactly the three ADR-0007 keys the
 * specification defines, with no fallback across versions/kinds, and that
 * the registered schema snapshot is immutable.
 */
import { describe, expect, it } from "vitest";
import {
  getModuleEntry,
  isModuleRegistered,
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
} from "../../../../src/module-registry/index.js";
import "../../../../src/modules/relations/v1.0/index.js";
import { RELATIONS_DOCUMENT_KINDS } from "../../../../src/modules/relations/v1.0/schemas.js";

describe("aadp:relations@1.0 registers into the generic module registry", () => {
  it("is registered under moduleId aadp:relations", () => {
    expect(isModuleRegistered("aadp:relations")).toBe(true);
  });

  it.each(RELATIONS_DOCUMENT_KINDS)("resolves an exact entry for kind %s", (kind) => {
    const entry = getModuleEntry({ moduleId: "aadp:relations", moduleVersion: "1.0", kind });
    expect(entry.schema).toBeTypeOf("object");
    expect(entry.validateSemantics).toBeTypeOf("function");
  });

  it("does not register component schemas (relation-item/target/collection-link) as document kinds", () => {
    for (const kind of ["relation-item", "target", "collection-link"]) {
      expect(() => getModuleEntry({ moduleId: "aadp:relations", moduleVersion: "1.0", kind })).toThrow(
        UnsupportedModuleKindError
      );
    }
  });

  it("throws UnsupportedModuleVersionError for a version that was never registered, without falling back to 1.0", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:relations", moduleVersion: "2.0", kind: "relation-set" })).toThrow(
      UnsupportedModuleVersionError
    );
  });

  it("throws UnsupportedModuleKindError for an unregistered kind under the registered version", () => {
    expect(() =>
      getModuleEntry({ moduleId: "aadp:relations", moduleVersion: "1.0", kind: "relation-graph" })
    ).toThrow(UnsupportedModuleKindError);
  });

  it("throws UnsupportedModuleError for an unrelated moduleId", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "relation-set" })).toThrow(
      UnsupportedModuleError
    );
  });

  it("returns a frozen schema snapshot that cannot be mutated to desync from the compiled validator", () => {
    const entry = getModuleEntry({ moduleId: "aadp:relations", moduleVersion: "1.0", kind: "relation-set" });
    expect(Object.isFrozen(entry.schema)).toBe(true);
  });
});

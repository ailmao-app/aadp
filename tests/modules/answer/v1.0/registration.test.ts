/**
 * Verifies Answer v1.0 registers into the generic module registry at
 * exactly `{aadp:answer, 1.0, answer}`, with no fallback across
 * versions/kinds, and that the registered schema snapshot is immutable.
 */
import { describe, expect, it } from "vitest";
import {
  getModuleEntry,
  isModuleRegistered,
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
} from "../../../../src/module-registry/index.js";
import "../../../../src/modules/answer/v1.0/index.js";

describe("aadp:answer@1.0 registers into the generic module registry", () => {
  it("is registered under moduleId aadp:answer", () => {
    expect(isModuleRegistered("aadp:answer")).toBe(true);
  });

  it("resolves an exact entry for kind answer", () => {
    const entry = getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "1.0", kind: "answer" });
    expect(entry.schema).toBeTypeOf("object");
    expect(entry.validateSemantics).toBeTypeOf("function");
  });

  it("does not register component schemas (authorship/freshness/applicability/answer-reference) as document kinds", () => {
    for (const kind of ["authorship", "freshness", "applicability", "answer-reference"]) {
      expect(() => getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "1.0", kind })).toThrow(UnsupportedModuleKindError);
    }
  });

  it("throws UnsupportedModuleVersionError for a version that was never registered, without falling back to 1.0", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "2.0", kind: "answer" })).toThrow(
      UnsupportedModuleVersionError
    );
  });

  it("throws UnsupportedModuleKindError for an unregistered kind under the registered version", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "1.0", kind: "answer-collection" })).toThrow(
      UnsupportedModuleKindError
    );
  });

  it("throws UnsupportedModuleError for an unrelated moduleId", () => {
    expect(() => getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "answer" })).toThrow(
      UnsupportedModuleError
    );
  });

  it("returns a frozen schema snapshot that cannot be mutated to desync from the compiled validator", () => {
    const entry = getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "1.0", kind: "answer" });
    expect(Object.isFrozen(entry.schema)).toBe(true);
  });
});

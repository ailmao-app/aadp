import { describe, expect, it } from "vitest";
import {
  registerModule,
  getModuleEntry,
  validateModuleDocument,
  assertValidModuleDocument,
  isModuleRegistered,
  isValidModuleId,
  UnsupportedModuleError,
  UnsupportedModuleVersionError,
  UnsupportedModuleKindError,
  InvalidModuleDocumentError,
  type ModuleSemanticIssue,
} from "../../src/module-registry/index.js";

// Every test below registers under a unique module id so registration
// order and vitest's parallel test execution can never collide with the
// "registration is additive-only" invariant under test elsewhere.
let counter = 0;
function freshModuleId(): string {
  counter += 1;
  return `test:registry-${counter}`;
}

const widgetSchema = {
  type: "object",
  properties: {
    kind: { const: "widget" },
    label: { type: "string" },
  },
  required: ["kind", "label"],
  additionalProperties: false,
};

describe("registerModule / getModuleEntry", () => {
  it("resolves an exact {moduleId, moduleVersion, kind} match", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    const entry = getModuleEntry({ moduleId, moduleVersion: "1.0", kind: "widget" });
    // Not `.toBe`: the registry snapshots (deep-clones) the schema at
    // registration time, so the returned object is equal in content but
    // not the same reference as the one passed in.
    expect(entry.schema).toEqual(widgetSchema);
  });

  it("rejects a module id that does not match the ADR-0007 pattern", () => {
    expect(() =>
      registerModule({ moduleId: "Relations", moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema })
    ).toThrow(/Invalid module id/);
    expect(() =>
      registerModule({ moduleId: "no-namespace", moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema })
    ).toThrow(/Invalid module id/);
  });

  it("throws on re-registering an already-registered exact key (immutability)", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() =>
      registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema })
    ).toThrow(/already registered/);
  });

  it("allows registering a different version or kind under the same moduleId", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() =>
      registerModule({ moduleId, moduleVersion: "1.1", kind: "widget" }, { schema: widgetSchema })
    ).not.toThrow();
    expect(() =>
      registerModule({ moduleId, moduleVersion: "1.0", kind: "gadget" }, { schema: widgetSchema })
    ).not.toThrow();
  });

  it("resolves $ref against a schemaDependencies entry, and tolerates the same dependency $id being passed again by another kind", () => {
    const moduleId = freshModuleId();
    const componentSchema = {
      $id: `https://example.com/schemas/${moduleId.replace(":", "-")}/component.schema.json`,
      type: "object",
      required: ["value"],
      properties: { value: { type: "string" } },
      additionalProperties: false,
    };
    const documentSchema = {
      type: "object",
      required: ["item"],
      properties: { item: { $ref: componentSchema.$id } },
      additionalProperties: false,
    };

    registerModule(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { schema: documentSchema, schemaDependencies: [componentSchema] }
    );
    // Same dependency $id registered again via a second kind must not
    // throw (e.g. ajv "schema already exists" for the shared $id).
    expect(() =>
      registerModule(
        { moduleId, moduleVersion: "1.0", kind: "gadget" },
        { schema: documentSchema, schemaDependencies: [componentSchema] }
      )
    ).not.toThrow();

    expect(validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { item: { value: "ok" } }).valid).toBe(
      true
    );
    expect(validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { item: {} }).valid).toBe(false);
  });

  it("rejects a schemaDependencies entry that reuses another dependency's $id with different content (schema-poisoning guard)", () => {
    const moduleId = freshModuleId();
    const sharedId = `https://example.com/schemas/${moduleId.replace(":", "-")}/shared.schema.json`;
    const officialComponent = {
      $id: sharedId,
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", pattern: "^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$" } },
      additionalProperties: false,
    };
    const poisonedComponent = {
      // Same $id, but drops the id-format constraint entirely — a
      // conflicting schema that must never silently win just because it
      // happened to register second (or first).
      $id: sharedId,
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false,
    };
    const documentSchema = {
      type: "object",
      required: ["target"],
      properties: { target: { $ref: sharedId } },
      additionalProperties: false,
    };

    registerModule(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { schema: documentSchema, schemaDependencies: [officialComponent] }
    );

    expect(() =>
      registerModule(
        { moduleId, moduleVersion: "1.0", kind: "gadget" },
        { schema: documentSchema, schemaDependencies: [poisonedComponent] }
      )
    ).toThrow(/dependency conflict/i);

    // The first (official) registration's validation contract must be
    // unaffected by the rejected conflicting registration attempt.
    expect(
      validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { target: { id: "not-a-valid-id" } })
        .valid
    ).toBe(false);
    expect(
      validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { target: { id: "character:alice" } })
        .valid
    ).toBe(true);
  });

  it("snapshots the schema at registration: mutating the caller's original object afterwards does not affect validation", () => {
    const moduleId = freshModuleId();
    const mutableSchema: { type: string; properties: Record<string, unknown>; required: string[] } = {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    };
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: mutableSchema });

    // Sabotage the object the caller still holds a reference to.
    mutableSchema.required = [];
    (mutableSchema as { type: string }).type = "null";

    const result = validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { label: "still required" });
    expect(result.valid).toBe(true);
  });

  it("returns a frozen schema from getModuleEntry that cannot be mutated to desync from the compiled validator", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    const returnedSchema = getModuleEntry({ moduleId, moduleVersion: "1.0", kind: "widget" }).schema as {
      required: string[];
    };
    expect(Object.isFrozen(returnedSchema)).toBe(true);
    expect(() => {
      returnedSchema.required = [];
    }).toThrow();

    // Regardless of the throw above, validation still enforces the original contract.
    const result = validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { kind: "widget" });
    expect(result.valid).toBe(false);
  });
});

describe("registry lookup error taxonomy (ADR-0007)", () => {
  it("throws UnsupportedModuleError for a moduleId with no registered version", () => {
    expect(() => getModuleEntry({ moduleId: "test:never-registered", moduleVersion: "1.0", kind: "widget" })).toThrow(
      UnsupportedModuleError
    );
  });

  it("throws UnsupportedModuleVersionError without falling back to a registered version", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => getModuleEntry({ moduleId, moduleVersion: "2.0", kind: "widget" })).toThrow(
      UnsupportedModuleVersionError
    );
  });

  it("throws UnsupportedModuleKindError when the version exists but the kind does not", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => getModuleEntry({ moduleId, moduleVersion: "1.0", kind: "gadget" })).toThrow(
      UnsupportedModuleKindError
    );
  });

  it("distinguishes the three lookup error codes", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => getModuleEntry({ moduleId: "test:missing", moduleVersion: "1.0", kind: "widget" })).toThrowError(
      expect.objectContaining({ code: "unsupported_module" })
    );
    expect(() => getModuleEntry({ moduleId, moduleVersion: "9.9", kind: "widget" })).toThrowError(
      expect.objectContaining({ code: "unsupported_module_version" })
    );
    expect(() => getModuleEntry({ moduleId, moduleVersion: "1.0", kind: "missing-kind" })).toThrowError(
      expect.objectContaining({ code: "unsupported_module_kind" })
    );
  });
});

describe("validateModuleDocument", () => {
  it("returns valid: true for a schema-conforming document", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    const result = validateModuleDocument(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { kind: "widget", label: "ok" }
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns valid: false with ajv errors for a schema-invalid document, without throwing", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    const result = validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { kind: "widget" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("still throws the lookup error for an unknown key rather than returning valid: false", () => {
    expect(() => validateModuleDocument({ moduleId: "test:missing", moduleVersion: "1.0", kind: "widget" }, {})).toThrow(
      UnsupportedModuleError
    );
  });

  it("runs the pure semantic validator only when the document is schema-valid, and folds error-level issues into valid: false", () => {
    const moduleId = freshModuleId();
    let semanticCalls = 0;
    const validateSemantics = (data: unknown): ModuleSemanticIssue[] => {
      semanticCalls += 1;
      const label = (data as { label?: string }).label;
      return label === "forbidden"
        ? [{ level: "error", code: "forbidden_label", path: "/label", message: "label is forbidden" }]
        : [];
    };
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema, validateSemantics });

    const schemaInvalid = validateModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { kind: "widget" });
    expect(schemaInvalid.valid).toBe(false);
    expect(semanticCalls).toBe(0); // never runs semantics over a schema-invalid document

    const semanticInvalid = validateModuleDocument(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { kind: "widget", label: "forbidden" }
    );
    expect(semanticInvalid.valid).toBe(false);
    expect(semanticInvalid.semanticIssues).toHaveLength(1);
    expect(semanticInvalid.semanticIssues[0].code).toBe("forbidden_label");

    const valid = validateModuleDocument(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { kind: "widget", label: "fine" }
    );
    expect(valid.valid).toBe(true);
  });

  it("a warning-level semantic issue does not flip valid to false", () => {
    const moduleId = freshModuleId();
    const validateSemantics = (): ModuleSemanticIssue[] => [
      { level: "warning", code: "advisory", path: "/label", message: "just a heads up" },
    ];
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema, validateSemantics });
    const result = validateModuleDocument(
      { moduleId, moduleVersion: "1.0", kind: "widget" },
      { kind: "widget", label: "fine" }
    );
    expect(result.valid).toBe(true);
    expect(result.semanticIssues).toHaveLength(1);
  });
});

describe("assertValidModuleDocument", () => {
  it("does not throw for a valid document", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() =>
      assertValidModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, { kind: "widget", label: "ok" })
    ).not.toThrow();
  });

  it("throws InvalidModuleDocumentError with the accumulated errors for an invalid document", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => assertValidModuleDocument({ moduleId, moduleVersion: "1.0", kind: "widget" }, {})).toThrow(
      InvalidModuleDocumentError
    );
  });

  // Unlike validateModuleDocument's error surface, assertValidModuleDocument
  // does NOT collapse lookup misses into InvalidModuleDocumentError — each
  // of the three ADR-0007 lookup errors still propagates as itself.
  it("propagates UnsupportedModuleError, not InvalidModuleDocumentError, for an unknown moduleId", () => {
    expect(() => assertValidModuleDocument({ moduleId: "test:missing", moduleVersion: "1.0", kind: "widget" }, {})).toThrow(
      UnsupportedModuleError
    );
  });

  it("propagates UnsupportedModuleVersionError, not InvalidModuleDocumentError, for an unknown moduleVersion", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => assertValidModuleDocument({ moduleId, moduleVersion: "9.9", kind: "widget" }, {})).toThrow(
      UnsupportedModuleVersionError
    );
  });

  it("propagates UnsupportedModuleKindError, not InvalidModuleDocumentError, for an unknown kind", () => {
    const moduleId = freshModuleId();
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(() => assertValidModuleDocument({ moduleId, moduleVersion: "1.0", kind: "missing-kind" }, {})).toThrow(
      UnsupportedModuleKindError
    );
  });
});

describe("isModuleRegistered / isValidModuleId", () => {
  it("reports registration status by moduleId regardless of version/kind", () => {
    const moduleId = freshModuleId();
    expect(isModuleRegistered(moduleId)).toBe(false);
    registerModule({ moduleId, moduleVersion: "1.0", kind: "widget" }, { schema: widgetSchema });
    expect(isModuleRegistered(moduleId)).toBe(true);
  });

  it("validates the ADR-0007 module id grammar", () => {
    expect(isValidModuleId("aadp:relations")).toBe(true);
    expect(isValidModuleId("vendor-name:my_module")).toBe(true);
    expect(isValidModuleId("Aadp:relations")).toBe(false);
    expect(isValidModuleId("aadp")).toBe(false);
    expect(isValidModuleId("aadp:")).toBe(false);
    expect(isValidModuleId(":relations")).toBe(false);
  });
});

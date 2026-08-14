/**
 * Traversal adapter registry: exact-match lookup, collision rules, per-call
 * replacement and the capability allowlist (ADR-0011 §5, plan 1.5.0
 * §"Registry boundary" and §"Capability negotiation").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAdapterLookup,
  getTraversalAdapter,
  listTraversalAdapters,
  registerTraversalAdapter,
} from "../../../src/traversal/v1.0/registry.js";
import {
  BUILTIN_TRAVERSAL_ADAPTERS,
  registerBuiltinTraversalAdapters,
} from "../../../src/traversal/v1.0/adapters/builtins.js";
import { answerTraversalAdapter } from "../../../src/traversal/v1.0/adapters/answer.js";
import { relationsTraversalAdapter } from "../../../src/traversal/v1.0/adapters/relations.js";
import type { TraversalAdapter, TraversalAdapterKey } from "../../../src/traversal/v1.0/index.js";

/**
 * A vendor adapter under a key no built-in owns. Registry tests share one
 * process-wide registry, so each test that registers uses its own module id
 * rather than resetting shared state that production code never resets.
 */
function fakeAdapter(key: TraversalAdapterKey): TraversalAdapter {
  return {
    key,
    capabilities: { sourceKinds: ["*"], edgeGroups: ["vendor.edge"], fetchesTargets: false },
    parseExtension: () => ({ ok: true, document: {} }),
    planEdges: () => [],
  };
}

// Sampled at module load, after every import above has been evaluated and
// before any test body runs — importing the traversal entry point, the
// built-ins module and the adapters themselves must leave the registry empty.
const adaptersPresentAtImportTime = listTraversalAdapters().length;

describe("global traversal adapter registry", () => {
  it("registers nothing merely by importing the traversal module", () => {
    expect(adaptersPresentAtImportTime).toBe(0);
  });

  it("resolves a registered adapter by its exact key", () => {
    registerBuiltinTraversalAdapters();
    expect(
      getTraversalAdapter({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBe(answerTraversalAdapter);
  });

  it("misses an unsupported module without throwing", () => {
    registerBuiltinTraversalAdapters();
    expect(
      getTraversalAdapter({ moduleId: "vendor:unknown", moduleVersion: "1.0", extensionField: "x_unknown" })
    ).toBeUndefined();
  });

  it("misses an unsupported VERSION of a supported module — no range, no fallback", () => {
    registerBuiltinTraversalAdapters();
    expect(
      getTraversalAdapter({ moduleId: "aadp:answer", moduleVersion: "2.0", extensionField: "x_answer" })
    ).toBeUndefined();
    expect(
      getTraversalAdapter({ moduleId: "aadp:answer", moduleVersion: "1.1", extensionField: "x_answer" })
    ).toBeUndefined();
  });

  it("misses a registered module under a different extension field", () => {
    registerBuiltinTraversalAdapters();
    expect(
      getTraversalAdapter({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answers" })
    ).toBeUndefined();
  });

  it("throws when a DIFFERENT adapter claims a key already taken", () => {
    const key: TraversalAdapterKey = {
      moduleId: "vendor:collision",
      moduleVersion: "1.0",
      extensionField: "x_collision",
    };
    registerTraversalAdapter(fakeAdapter(key));
    expect(() => registerTraversalAdapter(fakeAdapter(key))).toThrow(/already registered/);
  });

  it("treats re-registering the identical adapter as a no-op", () => {
    const adapter = fakeAdapter({
      moduleId: "vendor:idempotent",
      moduleVersion: "1.0",
      extensionField: "x_idempotent",
    });
    registerTraversalAdapter(adapter);
    expect(() => registerTraversalAdapter(adapter)).not.toThrow();
    expect(getTraversalAdapter(adapter.key)).toBe(adapter);
  });

  it("keeps registerBuiltinTraversalAdapters idempotent across repeated calls", () => {
    registerBuiltinTraversalAdapters();
    const afterFirst = listTraversalAdapters().length;
    registerBuiltinTraversalAdapters();
    registerBuiltinTraversalAdapters();
    expect(listTraversalAdapters().length).toBe(afterFirst);
    for (const adapter of BUILTIN_TRAVERSAL_ADAPTERS) {
      expect(getTraversalAdapter(adapter.key)).toBe(adapter);
    }
  });
});

describe("per-call adapter set", () => {
  it("REPLACES the global registry rather than merging with it", () => {
    registerBuiltinTraversalAdapters();
    const lookup = createAdapterLookup({ adapters: [relationsTraversalAdapter as TraversalAdapter] });
    expect(
      lookup({ moduleId: "aadp:relations", moduleVersion: "1.0", extensionField: "x_relations" })
    ).toBe(relationsTraversalAdapter);
    // Registered globally, absent from this call's set: the walk must not see it.
    expect(
      lookup({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBeUndefined();
  });

  it("resolves an adapter that was never registered globally", () => {
    const adapter = fakeAdapter({
      moduleId: "vendor:per-call-only",
      moduleVersion: "3.2",
      extensionField: "x_per_call",
    });
    const lookup = createAdapterLookup({ adapters: [adapter] });
    expect(lookup(adapter.key)).toBe(adapter);
    expect(getTraversalAdapter(adapter.key)).toBeUndefined();
  });

  it("rejects two different adapters for one key inside options.adapters", () => {
    const key: TraversalAdapterKey = {
      moduleId: "vendor:dup",
      moduleVersion: "1.0",
      extensionField: "x_dup",
    };
    expect(() => createAdapterLookup({ adapters: [fakeAdapter(key), fakeAdapter(key)] })).toThrow(
      /two different adapters/
    );
  });

  it("keeps an empty adapter set empty — it is not a synonym for the global registry", () => {
    registerBuiltinTraversalAdapters();
    const lookup = createAdapterLookup({ adapters: [] });
    expect(
      lookup({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBeUndefined();
  });
});

describe("capability allowlist", () => {
  it("hides an adapter outside the allowlist exactly as if it were unregistered", () => {
    registerBuiltinTraversalAdapters();
    const lookup = createAdapterLookup({ capabilities: [{ moduleId: "aadp:relations", version: "1.0" }] });
    expect(
      lookup({ moduleId: "aadp:relations", moduleVersion: "1.0", extensionField: "x_relations" })
    ).toBe(relationsTraversalAdapter);
    expect(
      lookup({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBeUndefined();
  });

  it("matches the allowlist on version too", () => {
    registerBuiltinTraversalAdapters();
    const lookup = createAdapterLookup({ capabilities: [{ moduleId: "aadp:answer", version: "2.0" }] });
    expect(
      lookup({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBeUndefined();
  });

  it("applies to a per-call adapter set as well", () => {
    const lookup = createAdapterLookup({
      adapters: [answerTraversalAdapter as TraversalAdapter],
      capabilities: [{ moduleId: "aadp:relations", version: "1.0" }],
    });
    expect(
      lookup({ moduleId: "aadp:answer", moduleVersion: "1.0", extensionField: "x_answer" })
    ).toBeUndefined();
  });
});

describe("registry boundary", () => {
  it("does not depend on the module registry", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../src/traversal/v1.0/registry.ts", import.meta.url)),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+"[^"]*module-registry/);
  });
});

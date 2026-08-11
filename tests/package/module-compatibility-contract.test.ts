import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { packAndExtractTarball, cleanupTarball, BUILD_TIMEOUT_MS, PACKED_IMPORT_TIMEOUT_MS, type PackedTarball } from "./tarball-helpers.js";

/**
 * Synthetic module-compatibility gate for Answer `1.0`
 * (`docs/vi/plans/implementation-plan-v1.3.0.md` Phase 4 item 4). ADR-0007's
 * compatibility promise has two halves, and both are only meaningful at the
 * boundary a real consumer installs against — so everything here exercises
 * the packed tarball's own published export subpaths, never `src/`:
 *
 * 1. A CORE-ONLY consumer (one that never opts into a module subpath) is
 *    completely unaffected by Answer: an entity carrying `x_answer`
 *    validates exactly as before, and no Answer code is loaded or
 *    registered to make that true.
 * 2. An OPT-IN consumer that meets a module version it does not support
 *    gets the documented, stable `unsupported_module_version` code rather
 *    than a soft fallback to a version it does understand.
 *
 * `tests/modules/answer/v1.0/*` already covers both behaviours against
 * `src/`; the point of this file is that the packaged export surface
 * delivers them too.
 */

let tarball: PackedTarball;

vi.setConfig({ testTimeout: PACKED_IMPORT_TIMEOUT_MS });

beforeAll(() => {
  tarball = packAndExtractTarball();
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (tarball) cleanupTarball(tarball);
});

function importFromTarball(subpath: string): Promise<Record<string, any>> {
  const distFile = path.join(tarball.packageDir, "dist", subpath, "index.js");
  return import(pathToFileURL(distFile).href);
}

/**
 * Runs `source` as an ESM script inside the extracted package, in a FRESH
 * Node process, and returns its parsed stdout JSON.
 *
 * Registration is a global side effect of importing a module subpath, so
 * "a core-only consumer never registers Answer" cannot be asserted from
 * this file's own module graph — any other test importing the Answer
 * subpath would contaminate it, and the result would depend on test order.
 * A separate process is the only honest way to observe a consumer that
 * genuinely never opted in.
 */
function runInPackage(source: string): any {
  const scriptPath = path.join(tarball.packageDir, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(scriptPath, source, "utf8");
  const stdout = execFileSync(process.execPath, [scriptPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(stdout);
}

/**
 * A core AADP v1.0 entity that also carries an `x_answer` wrapper. To a
 * core-only consumer this is just an entity with one unknown `x_*`
 * extension field, which ADR-0007 requires it to carry through untouched.
 */
const ENTITY_WITH_X_ANSWER = {
  aadp_version: "1.0",
  id: "answer:what-is-aadp",
  type: "answer",
  checksum: `sha256:${"0".repeat(64)}`,
  updated_at: "2026-08-06T00:00:00Z",
  canonical_url: "https://example.com/answers/what-is-aadp",
  data: {},
  x_answer: {
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What is AADP?",
    concise_answer: "A discovery protocol for AI agents.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "Example Editorial Team" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-06T00:00:00Z" },
    content_checksum: `sha256:${"0".repeat(64)}`,
  },
};

const ENTITY_JSON = JSON.stringify(ENTITY_WITH_X_ANSWER);

describe("core-only consumer is unaffected by the Answer module (ADR-0007)", () => {
  it("validates an entity carrying x_answer, and the same entity without it, identically", async () => {
    const { validateDocument } = await importFromTarball("validator");
    const { x_answer: _dropped, ...withoutAnswer } = ENTITY_WITH_X_ANSWER;

    expect(validateDocument({ version: "1.0", kind: "entity", data: ENTITY_WITH_X_ANSWER })).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateDocument({ version: "1.0", kind: "entity", data: withoutAnswer })).toEqual({ valid: true, errors: [] });
  });

  it("still validates when x_answer is structurally nonsense — core never dispatches on it", async () => {
    const { validateDocument } = await importFromTarball("validator");
    // A core-only consumer must not start failing on a module payload it
    // was never asked to understand; only an opt-in consumer validates it.
    const result = validateDocument({
      version: "1.0",
      kind: "entity",
      data: { ...ENTITY_WITH_X_ANSWER, x_answer: { not: "an answer document" } },
    });
    expect(result.valid).toBe(true);
  });

  it("does not load or register the Answer module, in a process that only imports core", () => {
    const probe = runInPackage(`
      import { validateDocument } from "./dist/validator/index.js";
      import { isModuleRegistered } from "./dist/module-registry/index.js";
      const valid = validateDocument({ version: "1.0", kind: "entity", data: ${ENTITY_JSON} }).valid;
      console.log(JSON.stringify({ valid, answerRegistered: isModuleRegistered("aadp:answer") }));
    `);
    expect(probe.valid).toBe(true);
    // The decisive assertion: core validation of an x_answer-bearing entity
    // succeeded WITHOUT the Answer module ever being registered.
    expect(probe.answerRegistered).toBe(false);
  });
});

describe("opt-in consumer surfaces unsupported Answer versions (ADR-0007)", () => {
  it("registers aadp:answer at exactly {1.0, answer} when the module subpath is imported", async () => {
    await importFromTarball("modules/answer/v1.0");
    const { isModuleRegistered, getModuleEntry } = await importFromTarball("module-registry");
    expect(isModuleRegistered("aadp:answer")).toBe(true);
    expect(getModuleEntry({ moduleId: "aadp:answer", moduleVersion: "1.0", kind: "answer" })).toBeDefined();
  });

  it("throws unsupported_module_version for a future Answer version, with no fallback to 1.0", async () => {
    await importFromTarball("modules/answer/v1.0");
    const { validateModuleDocument, UnsupportedModuleVersionError } = await importFromTarball("module-registry");
    const future = { moduleId: "aadp:answer", moduleVersion: "2.0", kind: "answer" };

    expect(() => validateModuleDocument(future, ENTITY_WITH_X_ANSWER.x_answer)).toThrow(UnsupportedModuleVersionError);
    try {
      validateModuleDocument(future, ENTITY_WITH_X_ANSWER.x_answer);
      expect.unreachable("validateModuleDocument should have thrown");
    } catch (err) {
      // The stable machine-readable half of the contract — message text may change.
      expect((err as { code: string }).code).toBe("unsupported_module_version");
      expect((err as { moduleVersion: string }).moduleVersion).toBe("2.0");
    }
  });

  it("throws unsupported_module for a module this package does not implement at all", async () => {
    await importFromTarball("modules/answer/v1.0");
    const { validateModuleDocument, UnsupportedModuleError } = await importFromTarball("module-registry");
    expect(() =>
      validateModuleDocument({ moduleId: "aadp:not-a-real-module", moduleVersion: "1.0", kind: "answer" }, {})
    ).toThrow(UnsupportedModuleError);
  });

  it("throws unsupported_module_kind for a kind Answer 1.0 does not define", async () => {
    await importFromTarball("modules/answer/v1.0");
    const { validateModuleDocument, UnsupportedModuleKindError } = await importFromTarball("module-registry");
    expect(() =>
      validateModuleDocument({ moduleId: "aadp:answer", moduleVersion: "1.0", kind: "not-a-kind" }, {})
    ).toThrow(UnsupportedModuleKindError);
  });

  it("dispatches a well-formed Answer document to schema+semantic validation at the supported version", async () => {
    await importFromTarball("modules/answer/v1.0");
    const { validateModuleDocument } = await importFromTarball("module-registry");
    const result = validateModuleDocument(
      { moduleId: "aadp:answer", moduleVersion: "1.0", kind: "answer" },
      ENTITY_WITH_X_ANSWER.x_answer
    );
    // `content_checksum` above is a placeholder, so the document is
    // schema-valid but semantically rejected — which is exactly the layer
    // split this asserts: the schema matched, and the semantic pass is what
    // caught it, not a version/dispatch failure.
    expect(result.errors).toEqual([]);
    expect(result.semanticIssues.some((i: { code: string }) => i.code === "answer.semantic.content_checksum_mismatch")).toBe(true);
  });
});

/**
 * The same two halves for Evidence `1.0`
 * (`spec/modules/evidence/v1.0/conformance.md` §6: an unsupported Evidence
 * version is NOT a remote deployment check — a runner cannot require a
 * conforming server to advertise a fake version — so it is exercised here,
 * with a synthetic entity, against the packaged export surface).
 */
const ENTITY_WITH_X_EVIDENCE = {
  aadp_version: "1.0",
  id: "claim:orbit-uptime-2026",
  type: "claim",
  checksum: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  updated_at: "2026-08-06T09:00:00Z",
  canonical_url: "https://example.com/claims/orbit-uptime-2026",
  data: {},
  x_evidence: {
    module: "aadp:evidence",
    version: "1.0",
    kind: "claim",
    statement: "Orbit reported 99.9% uptime in 2026.",
    locale: "en",
    evidence_refs: [
      {
        target_type: "evidence",
        target: { id: "evidence:orbit-report", url: "https://example.com/ai/v1.0/entities/evidence/orbit-report.json" },
        stance: "support",
      },
    ],
    // Placeholder — see the dispatch test at the end of this block.
    content_checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  },
};

const EVIDENCE_ENTITY_JSON = JSON.stringify(ENTITY_WITH_X_EVIDENCE);

describe("core-only consumer is unaffected by the Evidence module (ADR-0007)", () => {
  it("validates an entity carrying x_evidence, and the same entity without it, identically", async () => {
    const { validateDocument } = await importFromTarball("validator");
    const { x_evidence: _dropped, ...withoutEvidence } = ENTITY_WITH_X_EVIDENCE;

    expect(validateDocument({ version: "1.0", kind: "entity", data: ENTITY_WITH_X_EVIDENCE })).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateDocument({ version: "1.0", kind: "entity", data: withoutEvidence })).toEqual({ valid: true, errors: [] });
  });

  it("still validates when x_evidence is structurally nonsense — core never dispatches on it", async () => {
    const { validateDocument } = await importFromTarball("validator");
    const result = validateDocument({
      version: "1.0",
      kind: "entity",
      data: { ...ENTITY_WITH_X_EVIDENCE, x_evidence: { not: "an evidence document" } },
    });
    expect(result.valid).toBe(true);
  });

  it("does not load or register the Evidence module, in a process that only imports core", () => {
    const probe = runInPackage(`
      import { validateDocument } from "./dist/validator/index.js";
      import { isModuleRegistered } from "./dist/module-registry/index.js";
      const valid = validateDocument({ version: "1.0", kind: "entity", data: ${EVIDENCE_ENTITY_JSON} }).valid;
      console.log(JSON.stringify({ valid, evidenceRegistered: isModuleRegistered("aadp:evidence") }));
    `);
    expect(probe.valid).toBe(true);
    expect(probe.evidenceRegistered).toBe(false);
  });

  it("does not pull the Evidence module in through the Answer subpath", () => {
    // Evidence imports Answer (it resolves an Answer's citations); the
    // reverse MUST NOT hold, or every existing Answer consumer would
    // silently start registering a module it never asked for.
    const probe = runInPackage(`
      import "./dist/modules/answer/v1.0/index.js";
      import { isModuleRegistered } from "./dist/module-registry/index.js";
      console.log(JSON.stringify({
        answerRegistered: isModuleRegistered("aadp:answer"),
        evidenceRegistered: isModuleRegistered("aadp:evidence"),
      }));
    `);
    expect(probe.answerRegistered).toBe(true);
    expect(probe.evidenceRegistered).toBe(false);
  });
});

describe("opt-in consumer surfaces unsupported Evidence versions (ADR-0007)", () => {
  it("registers aadp:evidence at exactly {1.0, claim} and {1.0, evidence} when the subpath is imported", async () => {
    await importFromTarball("modules/evidence/v1.0");
    const { isModuleRegistered, getModuleEntry } = await importFromTarball("module-registry");
    expect(isModuleRegistered("aadp:evidence")).toBe(true);
    expect(getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "claim" })).toBeDefined();
    expect(getModuleEntry({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "evidence" })).toBeDefined();
  });

  it.each(["1.1", "2.0"])("throws unsupported_module_version for Evidence %s, with no fallback to 1.0", async (version) => {
    await importFromTarball("modules/evidence/v1.0");
    const { validateModuleDocument, UnsupportedModuleVersionError } = await importFromTarball("module-registry");
    const other = { moduleId: "aadp:evidence", moduleVersion: version, kind: "claim" };

    expect(() => validateModuleDocument(other, ENTITY_WITH_X_EVIDENCE.x_evidence)).toThrow(UnsupportedModuleVersionError);
    try {
      validateModuleDocument(other, ENTITY_WITH_X_EVIDENCE.x_evidence);
      expect.unreachable("validateModuleDocument should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("unsupported_module_version");
      expect((err as { moduleVersion: string }).moduleVersion).toBe(version);
    }
  });

  it("throws unsupported_module_kind for `source`, which is a nested object rather than a document kind", async () => {
    await importFromTarball("modules/evidence/v1.0");
    const { validateModuleDocument, UnsupportedModuleKindError } = await importFromTarball("module-registry");
    expect(() =>
      validateModuleDocument({ moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "source" }, {})
    ).toThrow(UnsupportedModuleKindError);
  });

  it("dispatches a well-formed claim document to schema+semantic validation at the supported version", async () => {
    await importFromTarball("modules/evidence/v1.0");
    const { validateModuleDocument } = await importFromTarball("module-registry");
    const result = validateModuleDocument(
      { moduleId: "aadp:evidence", moduleVersion: "1.0", kind: "claim" },
      ENTITY_WITH_X_EVIDENCE.x_evidence
    );
    // Same layer split as the Answer case: `content_checksum` is a
    // placeholder, so the schema matched and the semantic pass is what
    // caught it — not a version/dispatch failure.
    expect(result.errors).toEqual([]);
    expect(result.semanticIssues.some((i: { code: string }) => i.code === "evidence.semantic.content_checksum_mismatch")).toBe(true);
  });
});

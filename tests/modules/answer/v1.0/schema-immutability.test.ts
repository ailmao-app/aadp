import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";

/**
 * Released-schema immutability record for Answer `1.0`
 * (`docs/vi/plans/implementation-plan-v1.3.0.md` Phase 1 item 4 and Phase 5
 * item 1; ADR-0004 "released schemas are immutable"). Every one of the six
 * Answer schema artifacts is published verbatim through the package export
 * path `./schemas/modules/answer/v1.0/*`, so a consumer can fetch and pin
 * them — changing one after release silently changes a wire contract
 * already in someone's hands.
 *
 * Digests are over the CANONICAL JSON form (`checksumOf`, the package's own
 * published digest primitive — the same one `x_answer.content_checksum` and
 * the core entity `checksum` use), not raw file bytes: reformatting or key
 * reordering is deliberately NOT a contract change, while any change to the
 * schema's actual content is. A failure here is not a test to update — it
 * means either the change belongs in Answer `1.1`/`2.0` instead, or the
 * schema has not shipped yet and this record needs a deliberate, reviewed
 * re-baseline.
 */
const SCHEMA_DIR = new URL("../../../../schemas/modules/answer/v1.0/", import.meta.url);

/** Canonical-JSON digest of each Answer `1.0` schema as released in package version 1.3.0. */
const RELEASED_DIGESTS: Record<string, string> = {
  "answer-reference.schema.json": "sha256:b3fcd6e9f96becc3b01798f15c7738b134ea15dbe132b82e1c8c184984d532d1",
  "answer.schema.json": "sha256:8d9dd023588723889a04cc0de257aeb4298ee720439164a266fb4527e60644d5",
  "applicability.schema.json": "sha256:9df8da62d9e52d11080fce9c41a020f18f0ed000589ba3f746c2f29172eae0fe",
  "authorship.schema.json": "sha256:f4780ef6b1a82b16ed04c102150f0526f229d83fdf1d881077f4a6a623283897",
  "freshness.schema.json": "sha256:76fc7555a5db1aff5551e48a69a1e8775577530be6fb3be1d75695679d7724b5",
  "module.schema.json": "sha256:57cc71f491cc92c053aceda89db90e04ed749ce60872a9e2550287599de0e839",
};

function readSchema(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), "utf8"));
}

describe("Answer v1.0 released schema artifacts are immutable (ADR-0004)", () => {
  it.each(Object.keys(RELEASED_DIGESTS))("%s still matches its released canonical digest", (file) => {
    expect(checksumOf(readSchema(file))).toBe(RELEASED_DIGESTS[file]);
  });

  // Guards the record itself: a NEW schema file added to the released
  // directory would otherwise ship entirely unpinned, since `it.each` only
  // iterates the digests already recorded above.
  it("records a digest for every schema in the released directory, and no others", () => {
    const onDisk = readdirSync(fileURLToPath(SCHEMA_DIR)).filter((f) => f.endsWith(".json")).sort();
    expect(onDisk).toEqual(Object.keys(RELEASED_DIGESTS).sort());
  });
});

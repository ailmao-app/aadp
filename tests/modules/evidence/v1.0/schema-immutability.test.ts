import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../../../src/canonical-json/checksum.js";

/**
 * Released-schema immutability record for Evidence `1.0` (ADR-0004
 * "released schemas are immutable", ADR-0007). All six Evidence schema
 * artifacts are published verbatim through the package export path
 * `./schemas/modules/evidence/v1.0/*`, so a consumer can fetch and pin them
 * — changing one after release silently changes a wire contract already in
 * someone's hands.
 *
 * Digests are over the CANONICAL JSON form (`checksumOf`, the package's own
 * published digest primitive — the same one `x_evidence.content_checksum`
 * and the core entity `checksum` use), not raw file bytes: reformatting or
 * key reordering is deliberately NOT a contract change, while any change to
 * the schema's actual content is. A failure here is not a test to update —
 * it means either the change belongs in Evidence `1.1`/`2.0` instead, or the
 * schema has not shipped yet and this record needs a deliberate, reviewed
 * re-baseline.
 */
const SCHEMA_DIR = new URL("../../../../schemas/modules/evidence/v1.0/", import.meta.url);

/** Canonical-JSON digest of each Evidence `1.0` schema as released in package version 1.4.0. */
const RELEASED_DIGESTS: Record<string, string> = {
  "claim.schema.json": "sha256:6073b68cc5ab1fd14419b345ad899c6568475ce924be953a3a28a2883fcc7e6b",
  "evidence-reference.schema.json": "sha256:f97969afa8344ba3fcb47a575718bff0de67f0168337ed9312dd6886764be9ca",
  "evidence.schema.json": "sha256:bb9bf9db1d19386b9482afb15f07c79dec640eaebf3cd511a8109e3e57772a07",
  "module.schema.json": "sha256:b660d50a024dc82d235916660278a7b56cff488f6393a6f56c71430f913683e2",
  "provenance.schema.json": "sha256:88251a395c57823db174dd046394a7d15fe5e0dd14808699e0e30034f8ee85ed",
  "source.schema.json": "sha256:7b760649dc076d81554d5cbc43762f458884a6926bd50360b1b7cd20c64d08af",
};

function readSchema(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), "utf8"));
}

describe("Evidence v1.0 released schema artifacts are immutable (ADR-0004)", () => {
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

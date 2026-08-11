/**
 * Loads the Evidence Module v1.0 JSON Schema artifacts from
 * `schemas/modules/evidence/v1.0/` (specification.md §18). Mirrors
 * `../../answer/v1.0/schemas.ts`, kept separate because module schemas are
 * not core schemas.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { targetSchema as relationsTargetSchema } from "../../relations/v1.0/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "evidence", "v1.0");

/** Evidence `1.0` has exactly two top-level document kinds (specification.md §3). */
export type EvidenceDocumentKind = "claim" | "evidence";

export const EVIDENCE_DOCUMENT_KINDS: readonly EvidenceDocumentKind[] = ["claim", "evidence"];

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(schemasRoot, file), "utf8"));
}

/** Top-level document schema for `claim` (an `entity.x_evidence` value). */
export const claimSchema = loadSchema("claim.schema.json");

/** Top-level document schema for `evidence` (an `entity.x_evidence` value). */
export const evidenceSchema = loadSchema("evidence.schema.json");

/** Component schemas — never registered as module-registry document kinds on their own. */
export const evidenceReferenceSchema = loadSchema("evidence-reference.schema.json");
export const sourceSchema = loadSchema("source.schema.json");
export const provenanceSchema = loadSchema("provenance.schema.json");

/** Re-exported so a registration caller does not need to import the Relations module subpath just to satisfy `evidence-reference.schema.json`'s `$ref`. */
export { relationsTargetSchema };

/** The `modules[].schema` dispatch document — resolves to either top-level document schema. */
export const moduleDispatchSchema = loadSchema("module.schema.json");

export const schemasByKind: Record<EvidenceDocumentKind, object> = {
  claim: claimSchema,
  evidence: evidenceSchema,
};

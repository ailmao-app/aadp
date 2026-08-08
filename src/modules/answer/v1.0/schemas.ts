/**
 * Loads the Answer Module v1.0 JSON Schema artifacts from
 * `schemas/modules/answer/v1.0/` (specification.md "Schema and artifact
 * inventory"). Mirrors `../../relations/v1.0/schemas.ts`, kept separate
 * because module schemas are not core schemas.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { targetSchema as relationsTargetSchema } from "../../relations/v1.0/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasRoot = path.resolve(__dirname, "..", "..", "..", "..", "schemas", "modules", "answer", "v1.0");

/** Answer `1.0` has exactly one top-level document kind (specification.md "Wire boundary"). */
export type AnswerDocumentKind = "answer";

export const ANSWER_DOCUMENT_KINDS: readonly AnswerDocumentKind[] = ["answer"];

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(path.join(schemasRoot, file), "utf8"));
}

/** Top-level document schema for `answer` (the `entity.x_answer` value). */
export const answerSchema = loadSchema("answer.schema.json");

/** Component schemas — never registered as module-registry document kinds on their own. */
export const authorshipSchema = loadSchema("authorship.schema.json");
export const freshnessSchema = loadSchema("freshness.schema.json");
export const applicabilitySchema = loadSchema("applicability.schema.json");
export const answerReferenceSchema = loadSchema("answer-reference.schema.json");

/** Re-exported so a registration caller does not need to import the Relations module subpath just to satisfy `answer-reference.schema.json`'s `$ref`. */
export { relationsTargetSchema };

/** The `modules[].schema` dispatch document — resolves to the single `answer` document schema. */
export const moduleDispatchSchema = loadSchema("module.schema.json");

export const schemasByKind: Record<AnswerDocumentKind, object> = {
  answer: answerSchema,
};

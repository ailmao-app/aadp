/**
 * Registers the Answer Module v1.0 `answer` document kind into the
 * generic module registry (`../../../module-registry/index.js`) at exactly
 * the key specification.md defines: `{aadp:answer, 1.0, answer}`. Runs
 * once, as an import side effect of `./index.js` — mirrors
 * `../../relations/v1.0/register.ts`.
 */
import { registerModule } from "../../../module-registry/index.js";
import {
  answerSchema,
  authorshipSchema,
  freshnessSchema,
  applicabilitySchema,
  answerReferenceSchema,
  relationsTargetSchema,
} from "./schemas.js";
import { checkAnswerSemantics } from "./semantic.js";

const MODULE_ID = "aadp:answer" as const;
const MODULE_VERSION = "1.0" as const;

let registered = false;

/** Idempotent: safe to call more than once — only the first call actually registers. */
export function registerAnswerModule(): void {
  if (registered) return;
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "answer" },
    {
      schema: answerSchema,
      validateSemantics: checkAnswerSemantics,
      // answer.schema.json $refs authorship/freshness/applicability, and
      // authorship/answer-reference in turn $ref answer-reference and the
      // released Relations target schema, respectively.
      schemaDependencies: [authorshipSchema, freshnessSchema, applicabilitySchema, answerReferenceSchema, relationsTargetSchema],
    }
  );
  registered = true;
}

registerAnswerModule();

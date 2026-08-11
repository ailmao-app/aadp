/**
 * Registers the Evidence Module v1.0 document kinds into the generic module
 * registry (`../../../module-registry/index.js`) at exactly the keys
 * specification.md §3 defines: `{aadp:evidence, 1.0, claim}` and
 * `{aadp:evidence, 1.0, evidence}`. Runs once, as an import side effect of
 * `./index.js` — mirrors `../../answer/v1.0/register.ts`.
 */
import { registerModule } from "../../../module-registry/index.js";
import {
  claimSchema,
  evidenceSchema,
  evidenceReferenceSchema,
  sourceSchema,
  provenanceSchema,
  relationsTargetSchema,
} from "./schemas.js";
import { checkEvidenceClaimSemantics, checkEvidenceSemantics } from "./semantic.js";

const MODULE_ID = "aadp:evidence" as const;
const MODULE_VERSION = "1.0" as const;

let registered = false;

/** Idempotent: safe to call more than once — only the first call actually registers. */
export function registerEvidenceModule(): void {
  if (registered) return;
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "claim" },
    {
      schema: claimSchema,
      validateSemantics: checkEvidenceClaimSemantics,
      // claim.schema.json $refs evidence-reference, which in turn $refs the
      // released Relations target schema.
      schemaDependencies: [evidenceReferenceSchema, relationsTargetSchema],
    }
  );
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "evidence" },
    {
      schema: evidenceSchema,
      validateSemantics: checkEvidenceSemantics,
      schemaDependencies: [sourceSchema, provenanceSchema],
    }
  );
  registered = true;
}

registerEvidenceModule();

/**
 * Registers the Relations Module v1.0 document kinds into the generic
 * module registry (`../../../module-registry/index.js`, `AADP-MODULE-REGISTRY`)
 * at exactly the three keys ADR-0007 / specification.md §3 define. Runs
 * once, as an import side effect of `./index.js` — importing
 * `ail-aadp/modules/relations/v1.0` is what makes
 * `getModuleEntry`/`validateModuleDocument` on the generic registry aware
 * of `aadp:relations@1.0`, exactly as the generic engine is oblivious to
 * any concrete module until something registers it.
 */
import { registerModule } from "../../../module-registry/index.js";
import {
  relationSetSchema,
  relationCollectionSchema,
  relationRegistrySchema,
  relationItemSchema,
  targetSchema,
  collectionLinkSchema,
} from "./schemas.js";
import {
  checkRelationSetSemantics,
  checkRelationCollectionSemantics,
  checkRelationRegistrySemantics,
} from "./semantic.js";

const MODULE_ID = "aadp:relations" as const;
const MODULE_VERSION = "1.0" as const;

let registered = false;

/**
 * Idempotent: safe to call more than once (e.g. multiple test files
 * importing this module) — only the first call actually registers.
 * Registration itself remains additive-only/immutable at the registry
 * layer; this flag just avoids a spurious "already registered" throw for
 * legitimate repeated imports of the same module version.
 */
export function registerRelationsModule(): void {
  if (registered) return;
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "relation-set" },
    {
      schema: relationSetSchema,
      validateSemantics: checkRelationSetSemantics,
      // relation-set.schema.json $refs relation-item.schema.json, which in
      // turn $refs target.schema.json / collection-link.schema.json.
      schemaDependencies: [relationItemSchema, targetSchema, collectionLinkSchema],
    }
  );
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "relation-collection" },
    {
      schema: relationCollectionSchema,
      validateSemantics: checkRelationCollectionSemantics,
      // relation-collection.schema.json $refs target.schema.json for `items`.
      schemaDependencies: [targetSchema],
    }
  );
  registerModule(
    { moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "relation-registry" },
    { schema: relationRegistrySchema, validateSemantics: checkRelationRegistrySemantics }
  );
  registered = true;
}

registerRelationsModule();

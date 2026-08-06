/**
 * Fetch-and-validate for Relations module documents — the module
 * equivalent of `../../../../client/validated-document.ts`'s
 * `fetchAndValidateDocument`, reusing the exact same `fetchJson`
 * (SSRF/timeout/redirect/size/budget-bounded HTTP) but validating through
 * the module registry (`validateRelationsDocument`) instead of the core
 * schema registry. Checksum verification is NOT re-implemented here: it
 * already happens inside `checkRelationCollectionSemantics`/
 * `checkRelationRegistrySemantics` as part of `validateRelationsDocument`.
 */
import { fetchJson, type FetchJsonOptions } from "../../../../client/http.js";
import { AadpRequestError, type AadpErrorEnvelope } from "../../../../client/errors.js";
import type { DiscoveryBudgetState } from "../../../../client/discovery-budget.js";
import { validateModuleDocument } from "../../../../module-registry/index.js";
// Imported for its registration side effect only (registers aadp:relations@1.0
// into the shared module registry) — NOT for its exports, which would
// create an import cycle with this module's own index.ts. See `./index.ts`.
import "../register.js";
import type { RelationsDocumentKind } from "../schemas.js";
import { RelationsSchemaValidationError } from "./errors.js";

const MODULE_ID = "aadp:relations" as const;
const MODULE_VERSION = "1.0" as const;

/**
 * Schema+semantic-validates `data` as Relations `kind` via the generic
 * module registry, pinned to `aadp:relations@1.0`. Exposed separately from
 * `fetchAndValidateRelationsDocument` for a document this module already
 * has in hand without a fetch of its own — e.g. an entity's inline
 * `x_relations` (a `relation-set`), which core's entity schema accepts as
 * opaque `x_*` content and never validates as a Relations document.
 */
export function validateRelationsKind(
  kind: RelationsDocumentKind,
  data: unknown
): ReturnType<typeof validateModuleDocument> {
  return validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind }, data);
}

/**
 * Fetches `url`, maps a non-2xx status to `AadpRequestError`, then
 * schema+semantic-validates the body as Relations `kind` — in every
 * failure case, no URL the document contains (a target, another
 * collection page) is ever trusted for further resolution.
 */
export async function fetchAndValidateRelationsDocument<T>(
  url: string,
  kind: RelationsDocumentKind,
  options: FetchJsonOptions = {},
  budget?: DiscoveryBudgetState
): Promise<T> {
  const { status, data } = await fetchJson(url, options, budget);
  if (status < 200 || status >= 300) {
    const envelope = data as AadpErrorEnvelope;
    throw new AadpRequestError(
      envelope?.error?.message ?? `Request to ${url} failed with status ${status}`,
      status,
      envelope
    );
  }
  const result = validateRelationsKind(kind, data);
  if (!result.valid) {
    throw new RelationsSchemaValidationError(url, kind, result.errors, result.semanticIssues);
  }
  return data as T;
}

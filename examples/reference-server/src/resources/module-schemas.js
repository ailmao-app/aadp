import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * Serves the module schema artifacts this deployment's manifest points at.
 *
 * A manifest MUST NOT advertise a module whose schema is not actually
 * reachable — an agent that cannot fetch `modules[].schema` has been told
 * about a contract it has no way to read, and a conformance run reports the
 * URL as a dead link. Pointing the declaration at a canonical `aadp.dev` URL
 * only works for a module version already published there; a deployment
 * running ahead of that (or on a private network) has to serve its own copy.
 *
 * The files come from the installed package's `./schemas/modules/...` export
 * path — a public subpath, so this stays an ordinary consumer doing an
 * ordinary thing, and the served bytes are exactly the released artifacts
 * rather than a hand-copied duplicate that could drift.
 */

const require = createRequire(import.meta.url);

const EVIDENCE_SCHEMA_FILES = [
  "module.schema.json",
  "claim.schema.json",
  "evidence.schema.json",
  "evidence-reference.schema.json",
  "source.schema.json",
  "provenance.schema.json",
];

/** URL prefix these schemas are published under, relative to the deployment's own origin. */
export const EVIDENCE_SCHEMA_PREFIX = "/schemas/modules/evidence/v1.0/";

/**
 * Handles a request for one of the served schema files, or returns
 * `undefined` if the path is not one of them (so the caller can fall through
 * to the AADP handler).
 */
export async function handleModuleSchemaRequest(url) {
  if (!url.pathname.startsWith(EVIDENCE_SCHEMA_PREFIX)) return undefined;
  const file = url.pathname.slice(EVIDENCE_SCHEMA_PREFIX.length);
  // Allow-list rather than path arithmetic: a request can only ever name one
  // of the files below, so no traversal or encoding trick can reach anything
  // else on disk.
  if (!EVIDENCE_SCHEMA_FILES.includes(file)) return undefined;
  const source = require.resolve(`ail-aadp/schemas/modules/evidence/v1.0/${file}`);
  return new Response(await readFile(source), {
    status: 200,
    headers: { "content-type": "application/schema+json", "cache-control": "public, max-age=300" },
  });
}

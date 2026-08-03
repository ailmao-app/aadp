/**
 * Fetch-and-validate machinery shared by the v0.1 and v1.0 clients
 * (`./v0.1/index.ts`, `./v1.0/index.ts`). This is deliberately the only
 * thing shared between them — their wire types (`Manifest` vs `ManifestV1`,
 * etc.) and public function signatures stay independent per
 * `docs/records/implementation-record-v1.0.md` Phase 4 / ADR-0004. What's shared here is
 * purely cross-cutting request safety that has nothing to do with either
 * version's wire shape: schema validation before any URL a document
 * contains is trusted, and recomputing each document's own declared
 * `checksum` (spec §6 is identical across versions: sha256 of the
 * canonical `sitemaps`/`items`/`data` payload) rather than trusting it.
 */
import { fetchJson, type FetchJsonOptions } from "./http.js";
import { AadpRequestError, type AadpErrorEnvelope } from "./errors.js";
import { checksumOf } from "../canonical-json/checksum.js";
import { chargeDiscoveryBudgetBytes, type DiscoveryBudgetState } from "./discovery-budget.js";
import {
  validateDocument,
  UnsupportedAadpVersionError,
  type AadpVersion,
  type ResourceKind,
} from "../validator/index.js";

/** A fetched document failed AADP JSON Schema validation for its kind. */
export class AadpSchemaValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly kind: ResourceKind,
    public readonly errors: unknown[]
  ) {
    super(`Document at ${url} ("${kind}") failed AADP schema validation: ${JSON.stringify(errors)}`);
    this.name = "AadpSchemaValidationError";
  }
}

/** A document's own declared `checksum` does not match its recomputed content hash. */
export class AadpChecksumMismatchError extends Error {
  constructor(
    public readonly url: string,
    public readonly kind: ResourceKind,
    public readonly declared: string,
    public readonly actual: string
  ) {
    super(
      `Document at ${url} ("${kind}") declares checksum "${declared}" but its content hashes to "${actual}"`
    );
    this.name = "AadpChecksumMismatchError";
  }
}

/**
 * Two documents linked by the traversal (sitemap-index -> sitemap,
 * sitemap-item -> entity) disagree on an identity field (`id`, `type`, or
 * `checksum`) that spec §6 requires to match.
 */
export class AadpIntegrityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AadpIntegrityMismatchError";
  }
}

/**
 * A document that declares its own `aadp_version` other than `version` is
 * rejected before schema validation runs, so the failure is reported as
 * `UnsupportedAadpVersionError` (the client's contract) rather than an
 * opaque `schema_invalid` result.
 */
function assertDeclaredVersion(data: unknown, version: AadpVersion): void {
  const declared = (data as { aadp_version?: unknown } | null)?.aadp_version;
  if (typeof declared === "string" && declared !== version) {
    throw new UnsupportedAadpVersionError(declared);
  }
}

/**
 * Recomputes and checks each document kind's own declared `checksum`
 * against its content (spec §6): sitemap-index against `sitemaps`,
 * sitemap against `items`, entity against `data`. Manifests have no
 * checksum field and are not checked here.
 */
function assertOwnChecksum(url: string, kind: ResourceKind, data: unknown): void {
  let checkedField: "sitemaps" | "items" | "data" | undefined;
  if (kind === "sitemap-index") checkedField = "sitemaps";
  else if (kind === "sitemap") checkedField = "items";
  else if (kind === "entity") checkedField = "data";
  if (!checkedField) return;

  const doc = data as Record<string, unknown> & { checksum: string };
  const actual = checksumOf(doc[checkedField]);
  if (actual !== doc.checksum) {
    throw new AadpChecksumMismatchError(url, kind, doc.checksum, actual);
  }
}

/**
 * Fetches `url`, maps a non-2xx status to `AadpRequestError`, rejects a
 * document declaring a different `aadp_version`, schema-validates it for
 * `kind` under `version`, and recomputes its own checksum — in every
 * failure case, no URL the document contains is ever trusted for further
 * traversal.
 *
 * `budget`, when given, is charged the response's actual byte count
 * (ADR-0006 total-byte budget) before any other check — even a
 * schema-invalid or non-2xx response still counts against it, since bytes
 * were read from the wire regardless of what they turned out to contain.
 */
export async function fetchAndValidateDocument<T>(
  url: string,
  version: AadpVersion,
  kind: ResourceKind,
  options: FetchJsonOptions,
  budget?: DiscoveryBudgetState
): Promise<T> {
  const { status, data, bodyBytes } = await fetchJson(url, options);
  if (budget) chargeDiscoveryBudgetBytes(budget, bodyBytes, `fetchAndValidateDocument(${kind} ${url})`);
  if (status === 304) {
    throw new AadpRequestError("Not modified", 304);
  }
  if (status < 200 || status >= 300) {
    const envelope = data as AadpErrorEnvelope;
    throw new AadpRequestError(
      envelope?.error?.message ?? `Request to ${url} failed with status ${status}`,
      status,
      envelope
    );
  }
  assertDeclaredVersion(data, version);
  const result = validateDocument({ version, kind, data });
  if (!result.valid) {
    throw new AadpSchemaValidationError(url, kind, result.errors);
  }
  assertOwnChecksum(url, kind, data);
  return data as T;
}

/**
 * Evidence `1.0` wrapper and entity-context validators (specification.md
 * §11). Lives at the Evidence module layer, not in the generic module
 * registry or core validator — the generic registry's public contract
 * (`ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[]`)
 * never gains entity context, and core's validator gains no
 * Evidence-specific branch (specification.md §16).
 *
 * Checksum-vs-`data` verification for a fetched entity is already covered by
 * `fetchEntity` (core `client/v1.0`) when reached via `./client/fetch.ts` —
 * this module does not duplicate that check for an entity already in hand;
 * it only re-validates the entity against the core v1.0 schema.
 */
import { validateDocument } from "../../../validator/index.js";
import { validateModuleDocument, type ModuleSemanticIssue } from "../../../module-registry/index.js";
import type { EntityV1 } from "../../../client/v1.0/types.js";
import { checkUrlPolicy } from "./semantic.js";
import { EVIDENCE_DOCUMENT_KINDS, type EvidenceDocumentKind } from "./schemas.js";
import "./register.js";
import type { EvidenceClaimDocumentV1, EvidenceDocumentV1, EvidenceModuleDocumentV1 } from "./types.js";

const MODULE_ID = "aadp:evidence" as const;
const MODULE_VERSION = "1.0" as const;

export interface EvidenceValidationIssue extends ModuleSemanticIssue {}

/** Result of `validateEvidenceV1` — wrapper-only (`x_evidence`), no entity context. */
export interface EvidenceValidationResult {
  valid: boolean;
  errors: unknown[];
  semanticIssues: EvidenceValidationIssue[];
}

function issue(code: string, path: string, message: string): EvidenceValidationIssue {
  return { level: "error", code, path, message };
}

function isEvidenceKind(value: unknown): value is EvidenceDocumentKind {
  return typeof value === "string" && (EVIDENCE_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Validates `document` as an Evidence `1.0` wrapper (the value of an
 * entity's `x_evidence` field) via the generic module registry, pinned to
 * `aadp:evidence@1.0`.
 *
 * The registry key is exact, so the kind has to be chosen before dispatch:
 * it is read from the document's own `kind` discriminator. A document
 * without a recognizable `kind` is reported as an Evidence issue rather than
 * dispatched to a guessed kind — Evidence `1.0` has two document kinds and
 * picking one for the caller would report a self-inflicted schema failure
 * against the wrong contract.
 */
export function validateEvidenceV1(document: unknown): EvidenceValidationResult {
  const kind = (document as { kind?: unknown } | null | undefined)?.kind;
  if (!isEvidenceKind(kind)) {
    return {
      valid: false,
      errors: [],
      semanticIssues: [
        issue(
          "evidence.semantic.unknown_document_kind",
          "/kind",
          `x_evidence.kind must be one of ${EVIDENCE_DOCUMENT_KINDS.map((k) => `"${k}"`).join(", ")}, got ${JSON.stringify(kind)}.`
        ),
      ],
    };
  }
  const result = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind }, document);
  return { valid: result.valid, errors: result.errors, semanticIssues: result.semanticIssues };
}

/** An entity of `type: "claim"` or `type: "evidence"`, validated end-to-end (core envelope, `x_evidence`, entity-context invariants). */
export interface ValidatedEvidenceEntityV1<T = unknown> {
  entity: EntityV1<T> & { type: EvidenceDocumentKind; canonical_url: string };
  /** Which document kind this entity carries — the discriminator for `document`. */
  kind: EvidenceDocumentKind;
  document: EvidenceModuleDocumentV1;
}

export interface EvidenceEntityValidationResult {
  valid: boolean;
  errors: unknown[];
  semanticIssues: EvidenceValidationIssue[];
  entity?: ValidatedEvidenceEntityV1;
}

/** Thrown by `parseEvidenceEntityV1` — carries the same structured result `validateEvidenceEntityV1` returns. */
export class EvidenceEntityValidationError extends Error {
  constructor(public readonly result: EvidenceEntityValidationResult) {
    super(
      `Entity failed Evidence 1.0 entity-context validation: ${[...result.errors.map((e) => JSON.stringify(e)), ...result.semanticIssues.map((i) => `${i.code} (${i.path})`)].join(", ")}`
    );
    this.name = "EvidenceEntityValidationError";
  }
}

/**
 * `validateEvidenceEntityV1(entity)` — specification.md §11 steps 1-6:
 *
 * 1. Validate the core entity v1.0.
 * 2. Require `entity.type` to be `claim` or `evidence`, an `x_evidence`
 *    object, and `entity.canonical_url`.
 * 3. Validate `entity.canonical_url` with the same URL-policy helper as
 *    `source.url` (absolute HTTPS, no userinfo, no fragment).
 * 4. Dispatch `x_evidence` through the exact registry key for `entity.type`
 *    (includes `content_checksum` verification at the semantic step). The
 *    wrapper's own `kind` constant is what rejects an entity whose `type`
 *    and wrapper disagree.
 * 5. For kind `evidence`: require
 *    `x_evidence.provenance.retrieved_at <= entity.updated_at` — ORDERING,
 *    not equality (ADR-0010 §5). The two timestamps describe two independent
 *    events, so a correction published without re-retrieving the source must
 *    stay valid.
 * 6. Return a typed validated entity/wrapper, or a structured failure.
 *
 * Never throws — see `parseEvidenceEntityV1` for a throwing convenience
 * wrapper.
 */
export function validateEvidenceEntityV1(entity: unknown): EvidenceEntityValidationResult {
  const coreResult = validateDocument({ version: "1.0", kind: "entity", data: entity });
  if (!coreResult.valid) {
    return { valid: false, errors: coreResult.errors, semanticIssues: [] };
  }

  const e = entity as EntityV1;
  const semanticIssues: EvidenceValidationIssue[] = [];

  if (!isEvidenceKind(e.type)) {
    semanticIssues.push(
      issue(
        "evidence.semantic.entity_type_mismatch",
        "/type",
        `entity.type must be one of ${EVIDENCE_DOCUMENT_KINDS.map((k) => `"${k}"`).join(", ")}, got "${e.type}".`
      )
    );
  }
  const xEvidence = (e as unknown as { x_evidence?: unknown }).x_evidence;
  if (xEvidence === undefined) {
    semanticIssues.push(issue("evidence.semantic.missing_x_evidence", "/x_evidence", "entity has no x_evidence object."));
  }
  if (typeof e.canonical_url !== "string" || e.canonical_url.length === 0) {
    semanticIssues.push(
      issue("evidence.semantic.missing_canonical_url", "/canonical_url", `entity.canonical_url is required for type "${e.type}".`)
    );
  } else {
    const reason = checkUrlPolicy(e.canonical_url);
    if (reason) {
      semanticIssues.push(issue("evidence.semantic.canonical_url_policy_violation", "/canonical_url", `entity.canonical_url ${reason}.`));
    }
  }

  // Steps 2/3 failed hard enough that dispatching x_evidence would be
  // meaningless (no wrapper, or no kind to dispatch on) — stop here rather
  // than also reporting registry-dispatch noise for a document we already
  // know is invalid.
  if (
    semanticIssues.some(
      (i) => i.code === "evidence.semantic.entity_type_mismatch" || i.code === "evidence.semantic.missing_x_evidence"
    )
  ) {
    return { valid: false, errors: [], semanticIssues };
  }

  const kind = e.type as EvidenceDocumentKind;
  const wrapperResult = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind }, xEvidence);
  if (!wrapperResult.valid) {
    return {
      valid: false,
      errors: wrapperResult.errors,
      semanticIssues: [...semanticIssues, ...wrapperResult.semanticIssues],
    };
  }

  const document = xEvidence as EvidenceModuleDocumentV1;
  if (kind === "evidence") {
    const retrievedAt = (document as EvidenceDocumentV1).provenance.retrieved_at;
    const retrieved = Date.parse(retrievedAt);
    const updated = Date.parse(e.updated_at);
    if (!Number.isNaN(retrieved) && !Number.isNaN(updated) && retrieved > updated) {
      semanticIssues.push(
        issue(
          "evidence.semantic.retrieved_at_order_violation",
          "/x_evidence/provenance/retrieved_at",
          `x_evidence.provenance.retrieved_at (${retrievedAt}) must be <= entity.updated_at (${e.updated_at}).`
        )
      );
    }
  }

  if (semanticIssues.length > 0) {
    return { valid: false, errors: [], semanticIssues };
  }

  return {
    valid: true,
    errors: [],
    semanticIssues: [],
    entity: { entity: e as EntityV1 & { type: EvidenceDocumentKind; canonical_url: string }, kind, document },
  };
}

/** Throwing convenience wrapper over `validateEvidenceEntityV1` — does not duplicate its validation rules. */
export function parseEvidenceEntityV1(entity: unknown): ValidatedEvidenceEntityV1 {
  const result = validateEvidenceEntityV1(entity);
  if (!result.valid || !result.entity) {
    throw new EvidenceEntityValidationError(result);
  }
  return result.entity;
}

export type { EvidenceClaimDocumentV1, EvidenceDocumentV1 };

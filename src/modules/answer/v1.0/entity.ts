/**
 * Answer `1.0` entity-context validator (specification.md "Entity-context
 * validator"). Lives at the Answer module layer, not in the generic module
 * registry or core validator — the generic registry's public contract
 * (`ModuleSemanticValidator = (data: unknown) => ModuleSemanticIssue[]`)
 * never gains entity context, and core's validator gains no Answer-specific
 * branch (specification.md "Layer boundary").
 *
 * Checksum-vs-`data` verification for a fetched entity is already covered
 * by `fetchEntity` (core `client/v1.0`) when reached via `./client/fetch.ts`
 * — this module does not duplicate that check for an entity already in
 * hand; it only re-validates the entity against the core v1.0 schema.
 */
import { validateDocument } from "../../../validator/index.js";
import { validateModuleDocument, type ModuleSemanticIssue } from "../../../module-registry/index.js";
import type { EntityV1 } from "../../../client/v1.0/types.js";
import { checkUrlPolicy } from "./semantic.js";
import "./register.js";
import type { AnswerDocumentV1 } from "./types.js";

const MODULE_ID = "aadp:answer" as const;
const MODULE_VERSION = "1.0" as const;

export interface AnswerValidationIssue extends ModuleSemanticIssue {}

/** Result of `validateAnswerV1` — wrapper-only (`x_answer`), no entity context. */
export interface AnswerValidationResult {
  valid: boolean;
  errors: unknown[];
  semanticIssues: AnswerValidationIssue[];
}

/**
 * Validates `document` as an Answer `1.0` wrapper (the value of an entity's
 * `x_answer` field) via the generic module registry, pinned to
 * `aadp:answer@1.0`. Does not require or inspect entity context — see
 * `validateAnswerEntityV1` for the full entity-context contract.
 */
export function validateAnswerV1(document: unknown): AnswerValidationResult {
  const result = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "answer" }, document);
  return { valid: result.valid, errors: result.errors, semanticIssues: result.semanticIssues };
}

/** An entity of `type: "answer"`, already validated end-to-end (core envelope, `x_answer`, entity-context invariants). */
export interface ValidatedAnswerEntityV1<T = unknown> {
  entity: EntityV1<T> & { type: "answer"; canonical_url: string };
  answer: AnswerDocumentV1;
}

export interface AnswerEntityValidationResult {
  valid: boolean;
  errors: unknown[];
  semanticIssues: AnswerValidationIssue[];
  entity?: ValidatedAnswerEntityV1;
}

/** Thrown by `parseAnswerEntityV1` — carries the same structured result `validateAnswerEntityV1` returns. */
export class AnswerEntityValidationError extends Error {
  constructor(public readonly result: AnswerEntityValidationResult) {
    super(
      `Entity failed Answer 1.0 entity-context validation: ${[...result.errors.map((e) => JSON.stringify(e)), ...result.semanticIssues.map((i) => `${i.code} (${i.path})`)].join(", ")}`
    );
    this.name = "AnswerEntityValidationError";
  }
}

function issue(code: string, path: string, message: string): AnswerValidationIssue {
  return { level: "error", code, path, message };
}

/**
 * `validateAnswerEntityV1(entity)` — specification.md "Entity-context
 * validator" steps 1-6:
 *
 * 1. Validate core entity v1.0.
 * 2. Require `entity.type === "answer"`, an `x_answer` object, and
 *    `entity.canonical_url`.
 * 3. Validate `entity.canonical_url` with the same URL-policy helper as
 *    `author.url` (absolute HTTPS, no userinfo, no fragment).
 * 4. Dispatch `x_answer` through the exact registry key
 *    `{aadp:answer, 1.0, answer}` (includes `content_checksum`
 *    verification at the semantic step).
 * 5. Require `x_answer.freshness.updated_at === entity.updated_at`.
 * 6. Return a typed validated entity/wrapper, or a structured failure.
 *
 * Never throws — see `parseAnswerEntityV1` for a throwing convenience
 * wrapper.
 */
export function validateAnswerEntityV1(entity: unknown): AnswerEntityValidationResult {
  const coreResult = validateDocument({ version: "1.0", kind: "entity", data: entity });
  if (!coreResult.valid) {
    return { valid: false, errors: coreResult.errors, semanticIssues: [] };
  }

  const e = entity as EntityV1;
  const semanticIssues: AnswerValidationIssue[] = [];

  if (e.type !== "answer") {
    semanticIssues.push(issue("answer.semantic.entity_type_mismatch", "/type", `entity.type must be "answer", got "${e.type}".`));
  }
  const xAnswer = (e as unknown as { x_answer?: unknown }).x_answer;
  if (xAnswer === undefined) {
    semanticIssues.push(issue("answer.semantic.missing_x_answer", "/x_answer", "entity has no x_answer object."));
  }
  if (typeof e.canonical_url !== "string" || e.canonical_url.length === 0) {
    semanticIssues.push(issue("answer.semantic.missing_canonical_url", "/canonical_url", "entity.canonical_url is required for type \"answer\"."));
  } else {
    const reason = checkUrlPolicy(e.canonical_url);
    if (reason) {
      semanticIssues.push(issue("answer.semantic.canonical_url_policy_violation", "/canonical_url", `entity.canonical_url ${reason}.`));
    }
  }

  // Steps 2/3 failed hard enough that dispatching x_answer would be
  // meaningless (no wrapper, or the entity itself is already malformed for
  // this type) — stop here rather than also reporting registry-dispatch
  // noise for a document we already know is invalid.
  if (semanticIssues.some((i) => i.code === "answer.semantic.entity_type_mismatch" || i.code === "answer.semantic.missing_x_answer")) {
    return { valid: false, errors: [], semanticIssues };
  }

  const wrapperResult = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "answer" }, xAnswer);
  if (!wrapperResult.valid) {
    return {
      valid: false,
      errors: wrapperResult.errors,
      semanticIssues: [...semanticIssues, ...wrapperResult.semanticIssues],
    };
  }

  const answer = xAnswer as AnswerDocumentV1;
  if (answer.freshness.updated_at !== e.updated_at) {
    semanticIssues.push(
      issue(
        "answer.semantic.updated_at_mismatch",
        "/x_answer/freshness/updated_at",
        `x_answer.freshness.updated_at (${answer.freshness.updated_at}) must equal entity.updated_at (${e.updated_at}).`
      )
    );
  }

  if (semanticIssues.length > 0) {
    return { valid: false, errors: [], semanticIssues };
  }

  return {
    valid: true,
    errors: [],
    semanticIssues: [],
    entity: { entity: e as EntityV1 & { type: "answer"; canonical_url: string }, answer },
  };
}

/** Throwing convenience wrapper over `validateAnswerEntityV1` — does not duplicate its validation rules. */
export function parseAnswerEntityV1(entity: unknown): ValidatedAnswerEntityV1 {
  const result = validateAnswerEntityV1(entity);
  if (!result.valid || !result.entity) {
    throw new AnswerEntityValidationError(result);
  }
  return result.entity;
}

/**
 * AADP Evidence Module v1.0 pure semantic validators (registered for
 * `{aadp:evidence, 1.0, claim}` and `{aadp:evidence, 1.0, evidence}`;
 * specification.md §11). Pure functions only — no HTTP, no filesystem
 * access, no fetching a source or target URL, no wall clock, no mutation of
 * the input. Input MUST already be schema-valid; these checks cover
 * constraints JSON Schema cannot express: Unicode code-point bounds after
 * trim, the locale profile, provenance timestamp ordering, `confidence`
 * decimal precision, duplicate target identity, the source URL policy, and
 * `content_checksum` verification.
 *
 * There is deliberately NO self-reference rule: `evidence_refs[].target_type`
 * is the constant `evidence`, which already rules out claim → claim at the
 * schema layer, and a pure wrapper validator has no entity context with
 * which to know the document's own id (specification.md §11).
 *
 * All error codes use the `evidence.semantic.*` prefix. Message text is not
 * a stable API.
 */
import { checksumOf } from "../../../canonical-json/checksum.js";
import { canonicalTargetKey } from "../../relations/v1.0/client/budget.js";
import { checkUrlPolicy, isValidAnswerLocale } from "../../answer/v1.0/semantic.js";
import { checkNonPublicIpLiteral } from "../../../client/url-policy.js";
import type { ModuleSemanticIssue } from "../../../module-registry/index.js";
import type { EvidenceClaimDocumentV1, EvidenceDocumentV1, EvidenceReferenceV1 } from "./types.js";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * Evidence `1.0` uses THE SAME deterministic BCP 47 profile as Answer `1.0`
 * (specification.md §6), so this re-exports Answer's released predicate
 * rather than restating the grammar — a second copy could drift, and "the
 * same profile" would then be true only in prose. The `pattern` in
 * `claim.schema.json`/`evidence.schema.json` is required to stay textually
 * identical to `ANSWER_LOCALE_PATTERN`; `tests/modules/evidence/v1.0/semantic.test.ts`
 * asserts that, since there is no schema codegen step to derive one from the
 * other.
 */
export const isValidEvidenceLocale = isValidAnswerLocale;

/**
 * Absolute HTTPS, no userinfo, no fragment — the released Answer helper,
 * shared verbatim. specification.md §11 requires `entity.canonical_url` and
 * `source.url` to be checked by the SAME helper rather than by two
 * independently-drifting implementations, and Answer already owns one that
 * implements exactly this policy.
 */
export { checkUrlPolicy };

/** Unicode code-point length — deliberately not `.length` (UTF-16 code units), per specification.md, which counts code points. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

function checkBounds(
  value: string,
  field: string,
  min: number,
  max: number,
  path: string,
  issues: ModuleSemanticIssue[]
): void {
  const len = codePointLength(value);
  if (len < min || len > max) {
    issues.push({
      level: "error",
      code: "evidence.semantic.code_point_bounds_violation",
      path,
      message: `"${field}" has ${len} Unicode code point(s), outside the required ${min}-${max} range.`,
    });
  }
}

/**
 * Bounds plus a no-leading/trailing-whitespace rule, for the two fields
 * specification.md §5.1/§5.2 call a "trimmed string" (`statement`,
 * `summary`). Deliberately NOT applied to `excerpt` (a verbatim quotation,
 * whose leading whitespace can be part of the quotation), `notes`,
 * `source.title` or `publisher.name`, none of which the specification
 * declares trimmed.
 */
function checkTrimmedBounds(
  value: string,
  field: string,
  min: number,
  max: number,
  path: string,
  issues: ModuleSemanticIssue[]
): void {
  if (value.trim() !== value) {
    issues.push({
      level: "error",
      code: "evidence.semantic.not_trimmed",
      path,
      message: `"${field}" must not have leading/trailing whitespace.`,
    });
    return;
  }
  checkBounds(value, field, min, max, path, issues);
}

function checkLocale(locale: unknown, issues: ModuleSemanticIssue[]): void {
  if (!isString(locale) || isValidEvidenceLocale(locale)) return;
  issues.push({
    level: "error",
    code: "evidence.semantic.locale_profile_violation",
    path: "/locale",
    message: `locale "${locale}" does not match the deterministic BCP 47 profile Evidence 1.0 shares with Answer 1.0.`,
  });
}

/**
 * specification.md §8: `published_at <= retrieved_at`, and when
 * `modified_at` is present, `published_at <= modified_at <= retrieved_at`.
 * The precedence rule ("the date of the evidence") is a presentation rule
 * with no invariant to enforce here — see `classifyEvidenceFreshness`.
 */
function checkProvenanceOrder(doc: EvidenceDocumentV1, issues: ModuleSemanticIssue[]): void {
  const { published_at, retrieved_at, modified_at } = doc.provenance;
  const pub = Date.parse(published_at);
  const ret = Date.parse(retrieved_at);
  if (Number.isNaN(pub) || Number.isNaN(ret)) return; // schema `format: date-time` already rejects unparseable values
  if (pub > ret) {
    issues.push({
      level: "error",
      code: "evidence.semantic.timestamp_order_violation",
      path: "/provenance/published_at",
      message: `published_at (${published_at}) must be <= retrieved_at (${retrieved_at}).`,
    });
  }
  if (!isString(modified_at)) return;
  const mod = Date.parse(modified_at);
  if (Number.isNaN(mod)) return;
  if (pub > mod) {
    issues.push({
      level: "error",
      code: "evidence.semantic.timestamp_order_violation",
      path: "/provenance/modified_at",
      message: `published_at (${published_at}) must be <= modified_at (${modified_at}).`,
    });
  }
  if (mod > ret) {
    issues.push({
      level: "error",
      code: "evidence.semantic.timestamp_order_violation",
      path: "/provenance/modified_at",
      message: `modified_at (${modified_at}) must be <= retrieved_at (${retrieved_at}).`,
    });
  }
}

/**
 * Range and decimal precision for a declared `confidence` (specification.md
 * §7). Precision is checked here rather than with a schema `multipleOf`:
 * `0.07 / 0.01` is `6.999999999999999` in binary floating point, so
 * `multipleOf: 0.01` would reject values the specification allows.
 *
 * An ABSENT `confidence` is not an issue and is never defaulted — "not
 * declared" is a distinct state from `0` and from `1`.
 */
function checkConfidence(ref: EvidenceReferenceV1, path: string, issues: ModuleSemanticIssue[]): void {
  const confidence = ref.confidence;
  if (confidence === undefined) return;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return; // schema `type: number` already rejects this
  if (confidence < 0 || confidence > 1) {
    issues.push({
      level: "error",
      code: "evidence.semantic.confidence_range_violation",
      path: `${path}/confidence`,
      message: `confidence ${confidence} is outside the required [0, 1] range.`,
    });
    return;
  }
  const scaled = confidence * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    issues.push({
      level: "error",
      code: "evidence.semantic.confidence_precision_violation",
      path: `${path}/confidence`,
      message: `confidence ${confidence} has more than 2 decimal places.`,
    });
  }
}

function referenceKey(ref: EvidenceReferenceV1): string | undefined {
  const target = ref.target;
  if (!isObject(target) || !isString((target as { id?: unknown }).id) || !isString((target as { url?: unknown }).url)) {
    return undefined;
  }
  return canonicalTargetKey((target as { id: string }).id, (target as { url: string }).url);
}

/**
 * specification.md §7: within one `evidence_refs`, two elements MUST NOT
 * share a canonical identity — even with different `stance` values. Two
 * stances for one evidence must be split into two claims. Identity is the
 * released Relations `{id, normalizedUrl}` rule, not a new one.
 */
function checkDuplicateReferences(refs: EvidenceReferenceV1[], issues: ModuleSemanticIssue[]): void {
  const seen = new Map<string, number>();
  refs.forEach((ref, i) => {
    const key = referenceKey(ref);
    if (key === undefined) return;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        level: "error",
        code: "evidence.semantic.duplicate_target",
        path: `/evidence_refs/${i}`,
        message: `Reference at index ${i} duplicates the canonical target already listed at index ${first}.`,
      });
    } else {
      seen.set(key, i);
    }
  });
}

function checkSourceUrl(url: unknown, path: string, field: string, issues: ModuleSemanticIssue[]): void {
  if (!isString(url)) return;
  const baseReason = checkUrlPolicy(url);
  let literalAddressReason: string | undefined;
  if (!baseReason) {
    literalAddressReason = checkNonPublicIpLiteral(new URL(url).hostname);
  }
  const reason = baseReason ?? literalAddressReason;
  if (reason) {
    issues.push({
      level: "error",
      code: "evidence.semantic.source_url_policy_violation",
      path,
      message: `${field} ${reason}.`,
    });
  }
}

/**
 * `content_checksum` = `checksumOf(wrapper minus content_checksum)`, reusing
 * the released ADR-0001 digest and RFC 8785 canonicalization unchanged
 * (specification.md §9). The scope covers every normative wrapper field,
 * including any Relations `target.x_*` nested inside `evidence_refs`.
 */
function checkContentChecksum(doc: unknown, issues: ModuleSemanticIssue[]): void {
  const { content_checksum, ...rest } = doc as Record<string, unknown>;
  if (!isString(content_checksum)) return; // schema already requires/shapes this field
  const expected = checksumOf(rest);
  if (expected !== content_checksum) {
    issues.push({
      level: "error",
      code: "evidence.semantic.content_checksum_mismatch",
      path: "/content_checksum",
      message: `Declared content_checksum "${content_checksum}" does not match the canonical checksum of x_evidence minus content_checksum (${expected}).`,
    });
  }
}

function invalidDocument(): ModuleSemanticIssue[] {
  return [{ level: "error", code: "evidence.semantic.invalid_module_document", path: "", message: "evidence document is not an object." }];
}

/**
 * Guards the kind this validator was registered for. Registry dispatch is
 * exact (`{aadp:evidence, 1.0, claim}` vs `{…, evidence}`), and each
 * schema's `kind` is a constant — but these functions are also exported
 * directly, so a caller can hand a claim to the evidence validator, and
 * silently returning "no issues" for a document this validator never
 * examined would be the wrong answer.
 */
function checkKind(doc: Record<string, unknown>, expected: "claim" | "evidence", issues: ModuleSemanticIssue[]): boolean {
  const kind = doc.kind;
  if (kind === expected) return true;
  issues.push({
    level: "error",
    code: "evidence.semantic.kind_mismatch",
    path: "/kind",
    message: `Expected an Evidence 1.0 document of kind "${expected}", got ${JSON.stringify(kind)}.`,
  });
  return false;
}

/**
 * Runs every Evidence `1.0` pure rule for a schema-valid `claim` document
 * (the value of a claim entity's `x_evidence`). Registered as the
 * `ModuleSemanticValidator` for `{aadp:evidence, 1.0, claim}` — see
 * `./register.ts`.
 */
export function checkEvidenceClaimSemantics(doc: unknown): ModuleSemanticIssue[] {
  if (!isObject(doc)) return invalidDocument();
  const issues: ModuleSemanticIssue[] = [];
  if (!checkKind(doc, "claim", issues)) return issues;

  const claim = doc as unknown as EvidenceClaimDocumentV1;

  if (isString(claim.statement)) checkTrimmedBounds(claim.statement, "statement", 1, 1000, "/statement", issues);
  if (isString(claim.notes)) checkBounds(claim.notes, "notes", 1, 1000, "/notes", issues);
  checkLocale(claim.locale, issues);

  if (Array.isArray(claim.evidence_refs)) {
    claim.evidence_refs.forEach((ref, i) => {
      if (isObject(ref)) checkConfidence(ref, `/evidence_refs/${i}`, issues);
    });
    checkDuplicateReferences(claim.evidence_refs, issues);
  }

  checkContentChecksum(claim, issues);
  return issues;
}

/**
 * Runs every Evidence `1.0` pure rule for a schema-valid `evidence`
 * document. Registered as the `ModuleSemanticValidator` for
 * `{aadp:evidence, 1.0, evidence}`.
 *
 * The `provenance.retrieved_at <= entity.updated_at` ordering is NOT checked
 * here: it needs entity context this pure validator never receives, and
 * belongs to `validateEvidenceEntityV1` (specification.md §11).
 */
export function checkEvidenceSemantics(doc: unknown): ModuleSemanticIssue[] {
  if (!isObject(doc)) return invalidDocument();
  const issues: ModuleSemanticIssue[] = [];
  if (!checkKind(doc, "evidence", issues)) return issues;

  const evidence = doc as unknown as EvidenceDocumentV1;

  if (isString(evidence.summary)) checkTrimmedBounds(evidence.summary, "summary", 1, 1000, "/summary", issues);
  if (isString(evidence.excerpt)) checkBounds(evidence.excerpt, "excerpt", 1, 2000, "/excerpt", issues);
  checkLocale(evidence.locale, issues);

  if (isObject(evidence.source)) {
    const source = evidence.source;
    if (isString(source.title)) checkBounds(source.title, "source.title", 1, 500, "/source/title", issues);
    checkSourceUrl(source.url, "/source/url", "source.url", issues);
    if (isObject(source.publisher)) {
      const publisher = source.publisher as { name?: unknown; url?: unknown };
      if (isString(publisher.name)) checkBounds(publisher.name, "source.publisher.name", 1, 200, "/source/publisher/name", issues);
      checkSourceUrl(publisher.url, "/source/publisher/url", "source.publisher.url", issues);
    }
  }

  if (isObject(evidence.provenance)) checkProvenanceOrder(evidence, issues);

  checkContentChecksum(evidence, issues);
  return issues;
}

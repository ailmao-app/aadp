/**
 * AADP Answer Module v1.0 pure semantic validator (registered for
 * `{aadp:answer, 1.0, answer}`; specification.md "Validation boundary" §
 * "Pure wrapper semantic validator"). Pure functions only — no HTTP, no
 * filesystem access, no fetching a target URL, no wall clock. Input MUST
 * already be schema-valid; these checks cover constraints JSON Schema
 * cannot express: Unicode code-point bounds after trim, the Answer `1.0`
 * locale profile, freshness timestamp ordering, duplicate target identity,
 * `author.url` policy, and `content_checksum` verification.
 *
 * All error codes use the `answer.semantic.*` prefix (specification.md
 * "Validation results use stable machine-readable codes with the prefix
 * answer.semantic.*"). Message text is not a stable API.
 */
import { checksumOf } from "../../../canonical-json/checksum.js";
import { canonicalTargetKey } from "../../relations/v1.0/client/budget.js";
import type { ModuleSemanticIssue } from "../../../module-registry/index.js";
import type { AnswerDocumentV1, AnswerEntityReferenceV1 } from "./types.js";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * Answer `1.0` deterministic BCP 47 profile (specification.md "Locale
 * contract"). MUST stay textually identical to the `pattern` in
 * `schemas/modules/answer/v1.0/answer.schema.json`'s `locale` property —
 * schema and this pure helper are required to agree on the same grammar,
 * and there is no schema codegen step in this package to derive one from
 * the other automatically.
 */
export const ANSWER_LOCALE_PATTERN =
  /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-(?:[A-Z]{2}|[0-9]{3}))?(-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*$/;

/** True only for a value matching the Answer `1.0` locale profile exactly — not a general BCP 47 validity check. */
export function isValidAnswerLocale(locale: string): boolean {
  return ANSWER_LOCALE_PATTERN.test(locale);
}

/**
 * Shared pure URL-policy helper: absolute HTTPS, no userinfo, no fragment.
 * Used for both `authorship.author.url` (wrapper semantic validator) and
 * `entity.canonical_url` (entity-context validator) — specification.md
 * "Canonical URL contract" requires the exact same policy for both rather
 * than two independently-drifting checks.
 */
export function checkUrlPolicy(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "is not a well-formed absolute URL";
  }
  if (parsed.protocol !== "https:") return `uses scheme "${parsed.protocol}" instead of "https:"`;
  if (parsed.username || parsed.password) return "contains userinfo, which is not allowed";
  if (parsed.hash) return "contains a fragment, which is not allowed";
  return undefined;
}

/** Unicode code-point length — deliberately not `.length` (UTF-16 code units), per specification.md, which counts code points rather than UTF-16 length. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

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
      code: "answer.semantic.not_trimmed",
      path,
      message: `"${field}" must not have leading/trailing whitespace.`,
    });
    return;
  }
  const len = codePointLength(value);
  if (len < min || len > max) {
    issues.push({
      level: "error",
      code: "answer.semantic.code_point_bounds_violation",
      path,
      message: `"${field}" has ${len} Unicode code point(s), outside the required ${min}-${max} range.`,
    });
  }
}

function checkTimestampOrder(doc: AnswerDocumentV1, issues: ModuleSemanticIssue[]): void {
  const { published_at, updated_at, reviewed_at, expires_at } = doc.freshness;
  const pub = Date.parse(published_at);
  const upd = Date.parse(updated_at);
  if (Number.isNaN(pub) || Number.isNaN(upd)) return; // schema `format: date-time` already rejects unparseable values
  if (pub > upd) {
    issues.push({
      level: "error",
      code: "answer.semantic.timestamp_order_violation",
      path: "/freshness/published_at",
      message: `published_at (${published_at}) must be <= updated_at (${updated_at}).`,
    });
  }
  if (isString(reviewed_at)) {
    const rev = Date.parse(reviewed_at);
    if (!Number.isNaN(rev) && pub > rev) {
      issues.push({
        level: "error",
        code: "answer.semantic.timestamp_order_violation",
        path: "/freshness/reviewed_at",
        message: `published_at (${published_at}) must be <= reviewed_at (${reviewed_at}).`,
      });
    }
  }
  if (isString(expires_at)) {
    const exp = Date.parse(expires_at);
    if (!Number.isNaN(exp)) {
      const others: Array<[string, string | undefined]> = [
        ["published_at", published_at],
        ["updated_at", updated_at],
        ["reviewed_at", reviewed_at],
      ];
      for (const [name, value] of others) {
        if (!isString(value)) continue;
        const t = Date.parse(value);
        if (!Number.isNaN(t) && t > exp) {
          issues.push({
            level: "error",
            code: "answer.semantic.timestamp_order_violation",
            path: `/freshness/${name}`,
            message: `${name} (${value}) must be <= expires_at (${expires_at}).`,
          });
        }
      }
    }
  }
}

function referenceKey(ref: AnswerEntityReferenceV1): string | undefined {
  const target = ref.target;
  if (!isObject(target) || !isString((target as { id?: unknown }).id) || !isString((target as { url?: unknown }).url)) {
    return undefined;
  }
  return canonicalTargetKey((target as { id: string }).id, (target as { url: string }).url);
}

function checkDuplicateReferences(refs: AnswerEntityReferenceV1[], path: string, issues: ModuleSemanticIssue[]): void {
  const seen = new Map<string, number>();
  refs.forEach((ref, i) => {
    const key = referenceKey(ref);
    if (key === undefined) return;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        level: "error",
        code: "answer.semantic.duplicate_target",
        path: `${path}/${i}`,
        message: `Reference at index ${i} duplicates the canonical target already listed at index ${first}.`,
      });
    } else {
      seen.set(key, i);
    }
  });
}

function checkAuthorUrl(url: string | undefined, issues: ModuleSemanticIssue[]): void {
  if (!isString(url)) return;
  const reason = checkUrlPolicy(url);
  if (reason) {
    issues.push({
      level: "error",
      code: "answer.semantic.author_url_policy_violation",
      path: "/authorship/author/url",
      message: `authorship.author.url ${reason}.`,
    });
  }
}

function checkApplicabilityTimeRange(doc: AnswerDocumentV1, issues: ModuleSemanticIssue[]): void {
  const applicability = doc.applicability;
  if (!isObject(applicability)) return;
  const from = applicability.valid_from;
  const until = applicability.valid_until;
  if (!isString(from) || !isString(until)) return;
  const fromMs = Date.parse(from);
  const untilMs = Date.parse(until);
  if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) return; // schema `format: date-time` already rejects unparseable values
  if (!(fromMs < untilMs)) {
    issues.push({
      level: "error",
      code: "answer.semantic.applicability_time_range_violation",
      path: "/applicability/valid_from",
      message: `applicability.valid_from (${from}) must be strictly before applicability.valid_until (${until}).`,
    });
  }
}

function checkContentChecksum(doc: AnswerDocumentV1, issues: ModuleSemanticIssue[]): void {
  const { content_checksum, ...rest } = doc as unknown as Record<string, unknown>;
  if (!isString(content_checksum)) return; // schema already requires/shapes this field
  const expected = checksumOf(rest);
  if (expected !== content_checksum) {
    issues.push({
      level: "error",
      code: "answer.semantic.content_checksum_mismatch",
      path: "/content_checksum",
      message: `Declared content_checksum "${content_checksum}" does not match the canonical checksum of x_answer minus content_checksum (${expected}).`,
    });
  }
}

/**
 * Runs every Answer `1.0` pure rule against a schema-valid `answer`
 * document (the value of `entity.x_answer`). Returns an empty array when
 * no issue was found. Registered as the `ModuleSemanticValidator` for
 * `{aadp:answer, 1.0, answer}` — see `./register.ts`.
 */
export function checkAnswerSemantics(doc: unknown): ModuleSemanticIssue[] {
  const issues: ModuleSemanticIssue[] = [];
  if (!isObject(doc)) {
    return [{ level: "error", code: "answer.semantic.invalid_module_document", path: "", message: "answer document is not an object." }];
  }
  const answer = doc as unknown as AnswerDocumentV1;

  if (isString(answer.question)) checkTrimmedBounds(answer.question, "question", 1, 500, "/question", issues);
  if (isString(answer.concise_answer)) checkTrimmedBounds(answer.concise_answer, "concise_answer", 1, 500, "/concise_answer", issues);
  if (isString(answer.answer)) checkTrimmedBounds(answer.answer, "answer", 1, 20000, "/answer", issues);

  if (isString(answer.locale) && !isValidAnswerLocale(answer.locale)) {
    issues.push({
      level: "error",
      code: "answer.semantic.locale_profile_violation",
      path: "/locale",
      message: `locale "${answer.locale}" does not match the Answer 1.0 deterministic BCP 47 profile.`,
    });
  }

  if (isObject(answer.freshness)) checkTimestampOrder(answer, issues);

  if (isObject(answer.authorship)) {
    if (answer.authorship.kind === "source-authored") {
      checkAuthorUrl(answer.authorship.author?.url, issues);
    } else if (answer.authorship.kind === "generated-summary") {
      const sourceTargets = answer.authorship.source_targets;
      if (Array.isArray(sourceTargets)) checkDuplicateReferences(sourceTargets, "/authorship/source_targets", issues);
    }
  }

  if (Array.isArray(answer.related_entities)) {
    checkDuplicateReferences(answer.related_entities, "/related_entities", issues);
  }

  if (isObject(answer.applicability)) checkApplicabilityTimeRange(answer, issues);

  checkContentChecksum(answer, issues);

  return issues;
}

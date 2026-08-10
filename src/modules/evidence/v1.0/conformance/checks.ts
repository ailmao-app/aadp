/**
 * Evidence Module v1.0 conformance checks (conformance.md §2-§7). Every
 * check is a plain async function over a shared `EvidenceCheckContext` —
 * mirrors `../../../answer/v1.0/conformance/checks.ts` without sharing its
 * code (core `CHECKS` and the Relations/Answer check IDs are never touched).
 *
 * A check that depends on a sample document is `skipped`/`inconclusive` and
 * NEVER `failed` when no sample is available — the same reasoning as core
 * `ConformanceOptions.negativeTargets`.
 *
 * Every request this run makes passes through one shared `ClientOptions`
 * object whose `onBeforeAttempt` records the attempt (`EvidenceRunState.
 * requests`). One object, run-wide, is required rather than per-check: the
 * shared per-budget resolution context is bound to the request options on
 * first use, so a check resolving with a different options object would fail
 * closed with `resolution_context_mismatch`.
 *
 * That attempt log alone cannot carry a verdict, and two checks here depend
 * on more than it can prove, so both read a second, coarser log
 * (`EvidenceRunState.resolutions`) fed by the shared canonical resolution
 * layer's own cache boundary:
 *
 * - `evidence.graph` proves fan-in dedup by counting LOGICAL resolutions of
 *   a canonical target, not HTTP attempts. `client/http.ts` restarts a retry
 *   from the original URL, so one resolution that transiently retried
 *   records that URL twice — counting attempts would report a conforming
 *   deployment's ordinary transient behavior as a dedup defect.
 * - `evidence.security` proves `source.url`/`publisher.url` were never
 *   traversed from request PROVENANCE — which decision point asked for a URL
 *   — instead of from URL equality against a flat run-wide list, where a
 *   metadata URL that legitimately equals an explicitly supplied sample URL
 *   is indistinguishable from one the run followed out of metadata.
 *
 * Every request is attributed to the phase that initiated it
 * (`EvidenceCheckContext.withPurpose`), so a check can exclude requests it
 * itself asked for, and both sides of any URL comparison are canonicalized
 * with `normalizeTargetUrl` — the same canonicalizer the traversal's own
 * dedup key uses.
 */
import { fetchEntity, discover, type ClientOptions, type EntityV1 } from "../../../../client/v1.0/index.js";
import { checksumOf } from "../../../../canonical-json/checksum.js";
import { validateModuleDocument, type ModuleValidationResult } from "../../../../module-registry/index.js";
import { validateAnswerEntityV1 } from "../../../answer/v1.0/entity.js";
import type { AnswerDocumentV1 } from "../../../answer/v1.0/types.js";
import { validateEvidenceEntityV1, type EvidenceEntityValidationResult } from "../entity.js";
import { classifyEvidenceFreshness, evidenceContentDate } from "../client/freshness.js";
import { resolveAnswerEvidenceV1, resolveClaimEvidenceV1 } from "../client/resolve.js";
import type { EvidenceGraph } from "../client/types.js";
import { normalizeTargetUrl, canonicalTargetKey, type RelationsTraversalBudgetState } from "../../../relations/v1.0/client/budget.js";
import type { CanonicalResolutionEvent } from "../../../shared/canonical-resolution.js";
import type { EvidenceClaimDocumentV1, EvidenceDocumentV1, EvidenceAccessV1 } from "../types.js";
import type { EvidenceConformanceOptions, CheckResult, CheckStatus } from "./types.js";

const MODULE_ID = "aadp:evidence" as const;
const MODULE_VERSION = "1.0" as const;

const PROMPT_INJECTION_MARKERS = ["ignore previous instructions", "<script", "system:", "you are now"];

const ACCESS_VALUES: EvidenceAccessV1[] = ["public", "authenticated", "restricted"];

export interface EvidenceCheckOutcome {
  status: Exclude<CheckStatus, "failed">;
  message?: string;
  details?: string[];
  inconclusive?: boolean;
}

export class EvidenceCheckSignal extends Error {
  constructor(
    public readonly outcome: EvidenceCheckOutcome | { status: "failed"; message: string; details?: string[] }
  ) {
    super(outcome.message ?? outcome.status);
    this.name = "EvidenceCheckSignal";
  }
}

/**
 * What this run was doing when it initiated a request — recorded at the call
 * site that starts the work, never inferred afterwards. `unattributed` is a
 * request made outside any phase this runner opened, which is a bug in the
 * runner rather than a verdict about the deployment.
 */
export type EvidenceRequestPurpose =
  | "discovery"
  | "sample-claim"
  | "sample-evidence"
  | "sample-answer"
  | "claim-graph"
  | "answer-graph"
  | "unattributed";

/** One HTTP attempt (original, retry or redirect hop — ADR-0008 granularity). */
export interface EvidenceRequestRecord {
  url: string;
  /** `url` under the traversal's own canonicalizer — the only form ever compared against a document-supplied URL. */
  normalizedUrl: string;
  purpose: EvidenceRequestPurpose;
}

/** One logical canonical-target resolution, with the phase that asked for it. */
export interface EvidenceResolutionRecord extends CanonicalResolutionEvent {
  normalizedUrl: string;
  purpose: EvidenceRequestPurpose;
}

/** Phases in which a request can only have come from walking document references. */
const TRAVERSAL_PURPOSES = new Set<EvidenceRequestPurpose>(["claim-graph", "answer-graph"]);

/**
 * The decision points an Evidence walk is allowed to resolve a target from —
 * the `context` strings `resolve.ts` passes to the shared canonical resolver,
 * i.e. a DECLARED reference. Any other context resolving a `source.url` /
 * `publisher.url` means the walk followed metadata (specification.md §13).
 * A declared reference that happens to name the same URL as some document's
 * metadata is a reference, not a metadata traversal.
 */
const REFERENCE_CONTEXT = /^evidence\.(evidence_refs|related_entities)\[\d+\]$/;

export interface EvidenceRunState {
  moduleDeclaration?: { id: string; version: string; schema: string };
  claimEntity?: EntityV1;
  evidenceEntity?: EntityV1;
  answerEntity?: EntityV1;
  claimValidation?: EvidenceEntityValidationResult;
  evidenceValidation?: EvidenceEntityValidationResult;
  claimWrapperValidation?: ModuleValidationResult;
  evidenceWrapperValidation?: ModuleValidationResult;
  /** Every HTTP attempt this run made, in order, with its purpose — see module docstring. */
  requests: EvidenceRequestRecord[];
  /** Every logical canonical-target resolution this run made, in order — see module docstring. */
  resolutions: EvidenceResolutionRecord[];
  /** The phase currently initiating requests. Maintained by `EvidenceCheckContext.withPurpose`. */
  purpose: EvidenceRequestPurpose;
}

export interface EvidenceCheckContext {
  options: EvidenceConformanceOptions;
  client: ClientOptions;
  budget: RelationsTraversalBudgetState;
  state: EvidenceRunState;
  /** Runs `fn` with every request it initiates attributed to `purpose` — request provenance, recorded at the decision point. */
  withPurpose: <T>(purpose: EvidenceRequestPurpose, fn: () => Promise<T>) => Promise<T>;
  skip: (message: string, details?: string[]) => never;
  inconclusive: (message: string, details?: string[]) => never;
  warn: (message: string, details?: string[]) => never;
  fail: (message: string, details?: string[]) => never;
}

export interface EvidenceCheck {
  id: string;
  group: string;
  title: string;
  requires?: string[];
  run: (ctx: EvidenceCheckContext) => Promise<EvidenceCheckOutcome | void>;
}

function xEvidenceOf(entity: EntityV1): unknown {
  return (entity as unknown as { x_evidence?: unknown }).x_evidence;
}

async function ensureClaimEntity(ctx: EvidenceCheckContext): Promise<EntityV1> {
  if (ctx.state.claimEntity) return ctx.state.claimEntity;
  const url = ctx.options.sampleClaimUrl;
  if (!url) return ctx.inconclusive("options.sampleClaimUrl was not supplied; cannot exercise this check against a live target.");
  const entity = await ctx.withPurpose("sample-claim", () => fetchEntity(url, ctx.client, ctx.budget));
  ctx.state.claimEntity = entity;
  return entity;
}

async function ensureEvidenceEntity(ctx: EvidenceCheckContext): Promise<EntityV1> {
  if (ctx.state.evidenceEntity) return ctx.state.evidenceEntity;
  const url = ctx.options.sampleEvidenceUrl;
  if (!url) return ctx.inconclusive("options.sampleEvidenceUrl was not supplied; cannot exercise this check against a live target.");
  const entity = await ctx.withPurpose("sample-evidence", () => fetchEntity(url, ctx.client, ctx.budget));
  ctx.state.evidenceEntity = entity;
  return entity;
}

async function ensureClaimWrapperValidation(ctx: EvidenceCheckContext): Promise<ModuleValidationResult> {
  if (ctx.state.claimWrapperValidation) return ctx.state.claimWrapperValidation;
  const entity = await ensureClaimEntity(ctx);
  const validation = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "claim" }, xEvidenceOf(entity));
  ctx.state.claimWrapperValidation = validation;
  return validation;
}

async function ensureEvidenceWrapperValidation(ctx: EvidenceCheckContext): Promise<ModuleValidationResult> {
  if (ctx.state.evidenceWrapperValidation) return ctx.state.evidenceWrapperValidation;
  const entity = await ensureEvidenceEntity(ctx);
  const validation = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "evidence" }, xEvidenceOf(entity));
  ctx.state.evidenceWrapperValidation = validation;
  return validation;
}

function scanForInjectionMarkers(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  return PROMPT_INJECTION_MARKERS.find((marker) => lower.includes(marker));
}

/** Entries that mean a broken graph (conformance.md §5) — `forbidden` and `budget-exhausted` deliberately excluded. */
function danglingEntries(graph: EvidenceGraph): string[] {
  const bad: string[] = [];
  for (const reference of graph.references) {
    if (reference.status === "not-found" || reference.status === "invalid") {
      bad.push(`related_entities[${reference.index}] ${reference.reference.target.id}: ${reference.status}${reference.message ? ` (${reference.message})` : ""}`);
    }
  }
  for (const edge of graph.edges) {
    if (edge.status === "not-found" || edge.status === "invalid") {
      bad.push(`evidence_refs[${edge.index}] -> ${edge.to}: ${edge.status}${edge.message ? ` (${edge.message})` : ""}`);
    }
  }
  return bad;
}

/**
 * Canonical targets that one walk resolved from scratch more than once — the
 * observable form of "one fetch per canonical target per walk".
 *
 * Counts `kind: "fetch"` resolutions only: `cache`/`join` are dedup WORKING
 * (a second reference replaying a settled outcome, or joining the one
 * in-flight fetch), and both are expected for a fan-in graph. Retries and
 * redirects are invisible here by construction — they happen inside a single
 * `fetch` resolution — so a transient failure that a configured retry
 * recovered from can never be reported as a dedup defect.
 */
function reresolved(resolutions: EvidenceResolutionRecord[], candidateKeys: Set<string>): string[] {
  const counts = new Map<string, { url: string; count: number }>();
  for (const resolution of resolutions) {
    if (resolution.kind !== "fetch" || !candidateKeys.has(resolution.key)) continue;
    // Counted per canonical key, not per URL: two references declaring
    // DIFFERENT ids for one URL are two different targets, and resolving both
    // is correct, not a dedup defect.
    const seen = counts.get(resolution.key);
    if (seen) seen.count++;
    else counts.set(resolution.key, { url: resolution.url, count: 1 });
  }
  const offenders: string[] = [];
  for (const { url, count } of counts.values()) {
    if (count > 1) offenders.push(`${url} resolved ${count} times`);
  }
  return offenders;
}

export const EVIDENCE_CHECKS: EvidenceCheck[] = [
  {
    id: "evidence.discovery",
    group: "discovery",
    title: "Manifest declares aadp:evidence@1.0 with {id, version, schema}",
    async run(ctx) {
      if (!ctx.options.baseUrl) return ctx.inconclusive("options.baseUrl was not supplied.");
      const manifest = await ctx.withPurpose("discovery", () => discover(ctx.options.baseUrl!, ctx.client, ctx.budget));
      const declared = manifest.modules?.find((m) => m.id === MODULE_ID);
      if (!declared) return ctx.inconclusive(`Manifest at ${ctx.options.baseUrl} does not declare module "${MODULE_ID}".`);
      if (declared.version !== MODULE_VERSION) {
        return ctx.inconclusive(`Manifest declares ${MODULE_ID}@${declared.version}, not the ${MODULE_VERSION} this runner exercises.`);
      }
      if (typeof declared.schema !== "string" || declared.schema.length === 0) {
        return ctx.fail(`Manifest module entry for ${MODULE_ID} is missing "schema".`);
      }
      ctx.state.moduleDeclaration = declared;
    },
  },
  {
    id: "evidence.resource",
    group: "resource",
    title: "Sample claim and evidence entities are reachable through the core discovery/entity flow",
    async run(ctx) {
      if (!ctx.options.sampleClaimUrl && !ctx.options.sampleEvidenceUrl) {
        return ctx.inconclusive("Neither options.sampleClaimUrl nor options.sampleEvidenceUrl was supplied.");
      }
      if (ctx.options.sampleClaimUrl) await ensureClaimEntity(ctx);
      if (ctx.options.sampleEvidenceUrl) await ensureEvidenceEntity(ctx);
    },
  },
  {
    id: "evidence.schema",
    group: "schema",
    title: "Sample x_evidence wrappers pass the Evidence 1.0 schema",
    requires: ["evidence.resource"],
    async run(ctx) {
      const errors: string[] = [];
      if (ctx.options.sampleClaimUrl) {
        const validation = await ensureClaimWrapperValidation(ctx);
        errors.push(...validation.errors.map((e) => `claim: ${JSON.stringify(e)}`));
      }
      if (ctx.options.sampleEvidenceUrl) {
        const validation = await ensureEvidenceWrapperValidation(ctx);
        errors.push(...validation.errors.map((e) => `evidence: ${JSON.stringify(e)}`));
      }
      if (errors.length > 0) return ctx.fail("A sample x_evidence wrapper failed schema validation.", errors);
    },
  },
  {
    id: "evidence.semantic",
    group: "semantic",
    title: "Pure wrapper semantic invariants are green (including content_checksum)",
    requires: ["evidence.schema"],
    async run(ctx) {
      const issues: string[] = [];
      if (ctx.options.sampleClaimUrl) {
        const validation = await ensureClaimWrapperValidation(ctx);
        issues.push(...validation.semanticIssues.map((i) => `claim: ${i.code}: ${i.message}`));
      }
      if (ctx.options.sampleEvidenceUrl) {
        const validation = await ensureEvidenceWrapperValidation(ctx);
        issues.push(...validation.semanticIssues.map((i) => `evidence: ${i.code}: ${i.message}`));
      }
      if (issues.length > 0) return ctx.fail("A sample x_evidence wrapper failed a pure semantic invariant.", issues);
    },
  },
  {
    id: "evidence.context",
    group: "context",
    title: "Entity type, x_evidence presence, canonical_url policy and retrieved_at <= updated_at ORDERING are green",
    requires: ["evidence.resource"],
    async run(ctx) {
      const failures: string[] = [];
      if (ctx.options.sampleClaimUrl) {
        const validation = validateEvidenceEntityV1(await ensureClaimEntity(ctx));
        ctx.state.claimValidation = validation;
        if (!validation.valid) {
          failures.push(
            ...validation.errors.map((e) => `claim: ${JSON.stringify(e)}`),
            ...validation.semanticIssues.map((i) => `claim: ${i.code}: ${i.message}`)
          );
        }
      }
      if (ctx.options.sampleEvidenceUrl) {
        const entity = await ensureEvidenceEntity(ctx);
        const validation = validateEvidenceEntityV1(entity);
        ctx.state.evidenceValidation = validation;
        if (!validation.valid) {
          failures.push(
            ...validation.errors.map((e) => `evidence: ${JSON.stringify(e)}`),
            ...validation.semanticIssues.map((i) => `evidence: ${i.code}: ${i.message}`)
          );
        }
        // The invariant is ORDERING, not equality (ADR-0010 §5). An evidence
        // entity corrected without re-retrieving its source has
        // `retrieved_at` strictly earlier than `updated_at`, and that is
        // conformant — asserted explicitly so a future tightening to
        // equality cannot slip through this suite.
        const document = xEvidenceOf(entity) as EvidenceDocumentV1 | undefined;
        if (document?.provenance?.retrieved_at && Date.parse(document.provenance.retrieved_at) > Date.parse(entity.updated_at)) {
          failures.push(`evidence: provenance.retrieved_at (${document.provenance.retrieved_at}) is later than entity.updated_at (${entity.updated_at}).`);
        }
      }
      if (failures.length > 0) return ctx.fail("A sample entity failed Evidence 1.0 entity-context validation.", failures);
    },
  },
  {
    id: "evidence.graph",
    group: "graph",
    title: "Claim → evidence resolves with no dangling reference, and fan-in is deduplicated",
    requires: ["evidence.schema"],
    async run(ctx) {
      if (!ctx.options.sampleClaimUrl) return ctx.inconclusive("options.sampleClaimUrl was not supplied; there is no claim to expand.");
      const wrapper = await ensureClaimWrapperValidation(ctx);
      if (wrapper.errors.length > 0 || wrapper.semanticIssues.length > 0) {
        return ctx.inconclusive("Sample claim's x_evidence is not itself valid; skipping graph resolution.");
      }
      const claim = xEvidenceOf(ctx.state.claimEntity!) as EvidenceClaimDocumentV1;
      const before = ctx.state.resolutions.length;
      const graph = await ctx.withPurpose("claim-graph", () => resolveClaimEvidenceV1(claim, { ...ctx.client, budget: ctx.budget }));
      const resolved = ctx.state.resolutions.slice(before);

      const bad = danglingEntries(graph);
      if (bad.length > 0) return ctx.fail(`${bad.length} reference(s) in the claim's graph are dangling (not-found/invalid).`, bad);
      if (graph.partial) {
        return ctx.inconclusive("Claim expansion stopped early (budget exhausted or aborted); the graph was not fully walked.");
      }

      // Fan-in: several refs may name one evidence target — it must be
      // resolved exactly once per walk. Compared on the walk's own canonical
      // `{id, normalizedUrl}` keys, and counted per LOGICAL resolution, so
      // neither an equivalent URL spelling nor a retried HTTP attempt can
      // change the verdict (see `reresolved`).
      const targetKeys = new Set(claim.evidence_refs.map((ref) => canonicalTargetKey(ref.target.id, ref.target.url)));
      const offenders = reresolved(resolved, targetKeys);
      if (offenders.length > 0) return ctx.fail("An evidence target was resolved more than once in one walk (fan-in dedup failed).", offenders);
    },
  },
  {
    id: "evidence.stance",
    group: "stance",
    title: "Stance/confidence are producer assertions; a missing confidence is not inferred",
    requires: ["evidence.schema"],
    async run(ctx) {
      if (!ctx.options.sampleClaimUrl) return ctx.inconclusive("options.sampleClaimUrl was not supplied.");
      const validation = await ensureClaimWrapperValidation(ctx);
      const confidenceIssues = validation.semanticIssues.filter((i) => i.code.startsWith("evidence.semantic.confidence_"));
      if (confidenceIssues.length > 0) {
        return ctx.fail("Sample claim declares a confidence outside [0, 1] or with more than 2 decimals.", confidenceIssues.map((i) => i.message));
      }
      // "Not declared" is a third state, distinct from 0 and from 1. This
      // asserts the package never materializes a default: the parsed
      // document keeps the field absent exactly where the wire omitted it.
      const claim = xEvidenceOf(ctx.state.claimEntity!) as EvidenceClaimDocumentV1;
      const wire = (xEvidenceOf(ctx.state.claimEntity!) as { evidence_refs?: Array<Record<string, unknown>> }).evidence_refs ?? [];
      const invented = claim.evidence_refs
        .map((ref, i) => (ref.confidence !== undefined && !("confidence" in (wire[i] ?? {})) ? `evidence_refs[${i}]` : undefined))
        .filter((v): v is string => v !== undefined);
      if (invented.length > 0) {
        return ctx.fail("A confidence value was materialized for a reference whose wire form omitted it.", invented);
      }
    },
  },
  {
    id: "evidence.provenance",
    group: "provenance",
    title: "Timestamp ordering, precedence and freshness classification are correct",
    requires: ["evidence.schema"],
    async run(ctx) {
      if (!ctx.options.sampleEvidenceUrl) return ctx.inconclusive("options.sampleEvidenceUrl was not supplied.");
      const validation = await ensureEvidenceWrapperValidation(ctx);
      if (validation.semanticIssues.some((i) => i.code === "evidence.semantic.timestamp_order_violation")) {
        return ctx.fail("Sample evidence provenance has a timestamp ordering violation.", validation.semanticIssues.map((i) => i.message));
      }
      const evidence = xEvidenceOf(ctx.state.evidenceEntity!) as EvidenceDocumentV1;
      // Precedence: `modified_at` when present, otherwise `published_at` —
      // and `retrieved_at` NEVER (specification.md §8).
      const expected = evidence.provenance.modified_at ?? evidence.provenance.published_at;
      if (evidenceContentDate(evidence) !== expected) {
        return ctx.fail(`Content-date precedence resolved to ${evidenceContentDate(evidence)}, expected ${expected}.`);
      }
      const now = ctx.options.now ?? new Date();
      const maxAgeMs = ctx.options.freshnessMaxAgeMs ?? 365 * 24 * 60 * 60 * 1000;
      classifyEvidenceFreshness(evidence, now, maxAgeMs); // pure and deterministic; exercised for coverage, never a pass/fail criterion
    },
  },
  {
    id: "evidence.answer_link",
    group: "integration",
    title: "Answer related_entities resolve to claim/evidence and expand two hops, with x_answer unchanged",
    requires: ["evidence.schema"],
    async run(ctx) {
      const url = ctx.options.sampleAnswerUrl;
      if (!url) return ctx.inconclusive("options.sampleAnswerUrl was not supplied; there is no Answer to link from.");
      const entity = await ctx.withPurpose("sample-answer", () => fetchEntity(url, ctx.client, ctx.budget));
      ctx.state.answerEntity = entity;

      // Evidence integration must not change what Answer 1.0 accepts: the
      // sample answer is validated by the UNMODIFIED Answer validator.
      const answerValidation = validateAnswerEntityV1(entity);
      if (!answerValidation.valid) {
        return ctx.fail("Sample answer entity does not pass unmodified Answer 1.0 validation.", [
          ...answerValidation.errors.map((e) => JSON.stringify(e)),
          ...answerValidation.semanticIssues.map((i) => `${i.code}: ${i.message}`),
        ]);
      }

      const answer = (entity as unknown as { x_answer: AnswerDocumentV1 }).x_answer;
      const cited = (answer.related_entities ?? []).filter((r) => r.target_type === "claim" || r.target_type === "evidence");
      if (cited.length === 0) {
        return ctx.inconclusive("Sample answer's related_entities cite no claim or evidence target.");
      }

      // A source target that is ALSO a cited claim/evidence reference is
      // legitimately resolved through that reference — excluded, so this
      // check cannot fail an answer that happens to cite one of its own
      // generation sources.
      const citedUrls = new Set(cited.map((r) => normalizeTargetUrl(r.target.url)));
      const sourceTargetUrls = (answer.authorship.kind === "generated-summary" ? answer.authorship.source_targets : [])
        .map((t) => normalizeTargetUrl(t.target.url))
        .filter((target) => !citedUrls.has(target));
      const before = ctx.state.resolutions.length;
      const graph = await ctx.withPurpose("answer-graph", () => resolveAnswerEvidenceV1(answer, { ...ctx.client, budget: ctx.budget }));
      const walkResolutions = ctx.state.resolutions.slice(before);
      const resolvedUrls = new Set(walkResolutions.map((r) => r.normalizedUrl));

      // `authorship.source_targets` is out of scope for Evidence and must
      // never be resolved by this helper (specification.md §15) — a
      // verifiable consequence, not a note. Read from what the walk decided
      // to resolve, canonicalized on both sides.
      const leaked = sourceTargetUrls.filter((target) => resolvedUrls.has(target));
      if (leaked.length > 0) {
        return ctx.fail("resolveAnswerEvidenceV1 fetched authorship.source_targets, which are out of scope for Evidence.", leaked);
      }

      const bad = danglingEntries(graph);
      if (bad.length > 0) return ctx.fail(`${bad.length} reference(s) in the answer's citation graph are dangling.`, bad);
      if (graph.partial) return ctx.inconclusive("Answer expansion stopped early (budget exhausted or aborted).");

      // This is where fan-in actually happens: one claim may not list the
      // same canonical target twice (`evidence.semantic.duplicate_target`),
      // but two claims cited by one answer may both cite one evidence
      // document — and it must still be resolved exactly once per walk.
      const refetchedTargets = reresolved(walkResolutions, new Set(walkResolutions.map((r) => r.key)));
      if (refetchedTargets.length > 0) {
        return ctx.fail("A target was resolved more than once in one answer walk (fan-in dedup failed).", refetchedTargets);
      }

      const resolvedClaims = graph.nodes.filter((n) => n.status === "resolved" && n.kind === "claim");
      if (resolvedClaims.length > 0 && graph.edges.length === 0) {
        return ctx.fail("A claim resolved but its evidence_refs were not expanded — the second hop did not run.");
      }
    },
  },
  {
    id: "evidence.security",
    group: "security",
    title: "Free text is inert, source URLs are never traversed, and access grants nothing",
    requires: ["evidence.resource"],
    async run(ctx) {
      const offending: string[] = [];
      const claim = ctx.state.claimEntity ? (xEvidenceOf(ctx.state.claimEntity) as EvidenceClaimDocumentV1 | undefined) : undefined;
      const evidence = ctx.state.evidenceEntity ? (xEvidenceOf(ctx.state.evidenceEntity) as EvidenceDocumentV1 | undefined) : undefined;
      if (!claim && !evidence) return ctx.inconclusive("No sample x_evidence document to scan.");

      // `source.url`/`publisher.url` are metadata: traversing them is
      // forbidden (specification.md §13). A hard failure, not a warning — it
      // would be an SSRF vector driven by document content.
      //
      // The failing condition is a request the run made BECAUSE of a
      // metadata field, which is why both signals below are provenance-based
      // rather than "this URL appears somewhere in the request log": a
      // metadata URL may legitimately be requested for another role (it can
      // be the very URL supplied as `options.sampleEvidenceUrl`), and that is
      // not a traversal. Every comparison canonicalizes both sides with the
      // traversal's own `normalizeTargetUrl`, so equivalent spellings
      // (`https://example.com` vs `https://example.com/`) cannot evade it.
      if (evidence) {
        const metadataFields: Array<[string, string]> = [
          ["source.url", evidence.source.url],
          ["source.publisher.url", evidence.source.publisher.url],
        ].filter((entry): entry is [string, string] => typeof entry[1] === "string");
        const metadataUrls = new Map(metadataFields.map(([field, url]) => [normalizeTargetUrl(url), field]));

        // 1. The traversal resolved a metadata URL from somewhere that is not
        //    a declared reference — the decision point itself, recorded where
        //    the decision was made rather than inferred afterwards.
        const traversed = ctx.state.resolutions
          .filter((resolution) => metadataUrls.has(resolution.normalizedUrl) && !REFERENCE_CONTEXT.test(resolution.context))
          .map((resolution) => `${metadataUrls.get(resolution.normalizedUrl)} (${resolution.url}) resolved by ${resolution.context}`);

        // 2. A request made DURING a graph walk that no canonical resolution
        //    accounts for — the path a resolver bypassing the shared layer
        //    would take. Requests this runner itself initiated (discovery,
        //    the sample fetches) are excluded by purpose, and a metadata URL
        //    that is also a legitimately resolved graph target is accounted
        //    for by that resolution.
        const resolvedUrls = new Set(ctx.state.resolutions.map((resolution) => resolution.normalizedUrl));
        const unaccounted = ctx.state.requests
          .filter(
            (request) =>
              TRAVERSAL_PURPOSES.has(request.purpose) && metadataUrls.has(request.normalizedUrl) && !resolvedUrls.has(request.normalizedUrl)
          )
          .map((request) => `${metadataUrls.get(request.normalizedUrl)} (${request.url}) requested during ${request.purpose}`);

        if (traversed.length > 0 || unaccounted.length > 0) {
          return ctx.fail("A source/publisher metadata URL was traversed; those are metadata, never edges.", [...traversed, ...unaccounted]);
        }

        // `access` is presentation metadata and must change no outcome
        // (specification.md §12). Re-validating the same document under each
        // enum value — with the digest recomputed, so the only difference IS
        // `access` — proves it does not.
        const { content_checksum: _digest, ...rest } = evidence as unknown as Record<string, unknown>;
        const verdicts = ACCESS_VALUES.map((access) => {
          const variant = { ...rest, source: { ...(rest.source as object), access } };
          const document = { ...variant, content_checksum: checksumOf(variant) };
          return `${access}: ${validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "evidence" }, document).valid}`;
        });
        if (new Set(verdicts.map((v) => v.split(": ")[1])).size > 1) {
          return ctx.fail("source.access changed the validation outcome; it is presentation metadata and must grant nothing.", verdicts);
        }
      }

      for (const [label, text] of [
        ["claim.statement", claim?.statement],
        ["claim.notes", claim?.notes],
        ["evidence.summary", evidence?.summary],
        ["evidence.excerpt", evidence?.excerpt],
        ["evidence.source.title", evidence?.source.title],
        ["evidence.source.publisher.name", evidence?.source.publisher.name],
      ] as const) {
        const marker = scanForInjectionMarkers(text);
        if (marker) offending.push(`${label} contains "${marker}"`);
      }
      // A marker's mere presence is NOT a failure — such free text is still
      // valid, inert data. The real pass condition is the absence of a crash
      // or behavior change, which a static scan cannot prove, so this is
      // reported informationally (conformance.md §7).
      if (offending.length > 0) {
        return ctx.warn("Sample free text contains prompt-injection-shaped substrings (still valid, inert data).", offending);
      }
      if (ctx.options.allowPrivateNetwork || ctx.options.urlPolicy) {
        return ctx.warn("This run used a non-default URL policy (allowPrivateNetwork or a custom urlPolicy) — SSRF protection was intentionally relaxed for this run.");
      }
    },
  },
];

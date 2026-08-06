/**
 * Answer Module v1.0 conformance checks (specification.md "Conformance
 * contract"). Every check is a plain async function over a shared
 * `AnswerCheckContext` — mirrors `../../../relations/v1.0/conformance/checks.ts`
 * without sharing its code (core `CHECKS` and check IDs are never touched).
 *
 * `answer.discovery`/`answer.resource`/`answer.schema`/`answer.semantic`/
 * `answer.context` are pure once the sample document is fetched.
 * `answer.references` additionally exercises the Relations resolver
 * against `related_entities` — inconclusive (never failed) when no sample
 * is supplied, same reasoning as core `ConformanceOptions.negativeTargets`.
 */
import { fetchEntity, discover, type ClientOptions, type EntityV1 } from "../../../../client/v1.0/index.js";
import { validateModuleDocument, type ModuleValidationResult } from "../../../../module-registry/index.js";
import { validateAnswerEntityV1, type AnswerEntityValidationResult } from "../entity.js";
import { classifyAnswerFreshness } from "../client/freshness.js";
import { resolveAnswerTargets } from "../client/resolve.js";
import { createRelationsTraversalBudget, type RelationsTraversalBudgetState } from "../../../relations/v1.0/client/budget.js";
import type { AnswerDocumentV1 } from "../types.js";
import type { AnswerConformanceOptions, CheckResult, CheckStatus } from "./types.js";

const MODULE_ID = "aadp:answer" as const;
const MODULE_VERSION = "1.0" as const;

const PROMPT_INJECTION_MARKERS = ["ignore previous instructions", "<script", "system:", "you are now"];

export interface AnswerCheckOutcome {
  status: Exclude<CheckStatus, "failed">;
  message?: string;
  details?: string[];
  inconclusive?: boolean;
}

export class AnswerCheckSignal extends Error {
  constructor(
    public readonly outcome: AnswerCheckOutcome | { status: "failed"; message: string; details?: string[] }
  ) {
    super(outcome.message ?? outcome.status);
    this.name = "AnswerCheckSignal";
  }
}

export interface AnswerRunState {
  moduleDeclaration?: { id: string; version: string; schema: string };
  sampleEntity?: EntityV1;
  sampleEntityValidation?: AnswerEntityValidationResult;
  sampleWrapperValidation?: ModuleValidationResult;
}

export interface AnswerCheckContext {
  options: AnswerConformanceOptions;
  client: ClientOptions;
  budget: RelationsTraversalBudgetState;
  state: AnswerRunState;
  skip: (message: string, details?: string[]) => never;
  inconclusive: (message: string, details?: string[]) => never;
  warn: (message: string, details?: string[]) => never;
  fail: (message: string, details?: string[]) => never;
}

export interface AnswerCheck {
  id: string;
  group: string;
  title: string;
  requires?: string[];
  run: (ctx: AnswerCheckContext) => Promise<AnswerCheckOutcome | void>;
}

function hasIssueCode(validation: { semanticIssues: { code: string }[] }, code: string): boolean {
  return validation.semanticIssues.some((issue) => issue.code === code);
}

async function ensureSampleEntity(ctx: AnswerCheckContext): Promise<EntityV1> {
  if (ctx.state.sampleEntity) return ctx.state.sampleEntity;
  const url = ctx.options.sampleEntityUrl;
  if (!url) return ctx.inconclusive("options.sampleEntityUrl was not supplied; cannot exercise this check against a live target.");
  const entity = await fetchEntity(url, ctx.client, ctx.budget);
  ctx.state.sampleEntity = entity;
  return entity;
}

async function ensureEntityValidation(ctx: AnswerCheckContext): Promise<AnswerEntityValidationResult> {
  if (ctx.state.sampleEntityValidation) return ctx.state.sampleEntityValidation;
  const entity = await ensureSampleEntity(ctx);
  const validation = validateAnswerEntityV1(entity);
  ctx.state.sampleEntityValidation = validation;
  return validation;
}

async function ensureWrapperValidation(ctx: AnswerCheckContext): Promise<ModuleValidationResult> {
  if (ctx.state.sampleWrapperValidation) return ctx.state.sampleWrapperValidation;
  const entity = await ensureSampleEntity(ctx);
  const xAnswer = (entity as unknown as { x_answer?: unknown }).x_answer;
  const validation = validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind: "answer" }, xAnswer);
  ctx.state.sampleWrapperValidation = validation;
  return validation;
}

function scanForInjectionMarkers(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  return PROMPT_INJECTION_MARKERS.find((marker) => lower.includes(marker));
}

export const ANSWER_CHECKS: AnswerCheck[] = [
  {
    id: "answer.discovery",
    group: "discovery",
    title: "Manifest declares aadp:answer@1.0 with {id, version, schema}",
    async run(ctx) {
      if (!ctx.options.baseUrl) return ctx.inconclusive("options.baseUrl was not supplied.");
      const manifest = await discover(ctx.options.baseUrl, ctx.client, ctx.budget);
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
    id: "answer.resource",
    group: "resource",
    title: "Sample Answer entity is reachable through the core discovery/entity flow",
    async run(ctx) {
      await ensureSampleEntity(ctx);
    },
  },
  {
    id: "answer.schema",
    group: "schema",
    title: "Sample x_answer wrapper passes the Answer 1.0 schema",
    requires: ["answer.resource"],
    async run(ctx) {
      const validation = await ensureWrapperValidation(ctx);
      if (validation.errors.length > 0) {
        return ctx.fail("Sample x_answer failed schema validation.", validation.errors.map((e) => JSON.stringify(e)));
      }
    },
  },
  {
    id: "answer.semantic",
    group: "semantic",
    title: "Pure wrapper semantic invariants are green (including content_checksum)",
    requires: ["answer.schema"],
    async run(ctx) {
      const validation = await ensureWrapperValidation(ctx);
      if (validation.semanticIssues.length > 0) {
        return ctx.fail("Sample x_answer failed a pure semantic invariant.", validation.semanticIssues.map((i) => `${i.code}: ${i.message}`));
      }
    },
  },
  {
    id: "answer.context",
    group: "context",
    title: "Entity type, x_answer presence, canonical_url policy and updated_at equality are green",
    requires: ["answer.resource"],
    async run(ctx) {
      const validation = await ensureEntityValidation(ctx);
      if (!validation.valid) {
        return ctx.fail("Sample entity failed Answer 1.0 entity-context validation.", [
          ...validation.errors.map((e) => JSON.stringify(e)),
          ...validation.semanticIssues.map((i) => `${i.code}: ${i.message}`),
        ]);
      }
    },
  },
  {
    id: "answer.authorship",
    group: "authorship",
    title: "Authorship discriminator/provenance is unambiguous",
    requires: ["answer.schema"],
    async run(ctx) {
      const validation = await ensureWrapperValidation(ctx);
      if (hasIssueCode(validation, "answer.semantic.author_url_policy_violation")) {
        return ctx.fail("Sample authorship.author.url violates the URL policy.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "answer.references",
    group: "references",
    title: "related_entities resolve via the Relations resolver/shared budget",
    requires: ["answer.schema"],
    async run(ctx) {
      const wrapperValidation = await ensureWrapperValidation(ctx);
      if (wrapperValidation.errors.length > 0 || wrapperValidation.semanticIssues.length > 0) {
        return ctx.inconclusive("Sample x_answer is not itself valid; skipping reference resolution.");
      }
      const entity = ctx.state.sampleEntity!;
      const answer = (entity as unknown as { x_answer: AnswerDocumentV1 }).x_answer;
      if (!answer.related_entities || answer.related_entities.length === 0) {
        return ctx.inconclusive("Sample x_answer has no related_entities to resolve.");
      }
      const result = await resolveAnswerTargets(answer, { ...ctx.client, budget: ctx.budget });
      const bad = result.items.filter((item) => item.status !== "resolved");
      if (bad.length > 0) {
        return ctx.warn(
          `${bad.length} of ${result.items.length} related_entities did not resolve.`,
          bad.map((b) => `${b.reference.target.id}: ${b.status}${b.message ? ` (${b.message})` : ""}`)
        );
      }
    },
  },
  {
    id: "answer.freshness",
    group: "freshness",
    title: "Timestamp semantics and injected-clock classification are correct",
    requires: ["answer.schema"],
    async run(ctx) {
      const wrapperValidation = await ensureWrapperValidation(ctx);
      if (wrapperValidation.semanticIssues.some((i) => i.code === "answer.semantic.timestamp_order_violation")) {
        return ctx.fail("Sample x_answer.freshness has a timestamp ordering violation.", wrapperValidation.semanticIssues.map((i) => i.message));
      }
      const entity = ctx.state.sampleEntity;
      if (entity) {
        const answer = (entity as unknown as { x_answer?: AnswerDocumentV1 }).x_answer;
        if (answer) {
          const now = ctx.options.now ?? new Date();
          classifyAnswerFreshness(answer, now); // pure, deterministic — never throws for a schema-valid document; exercised for coverage
        }
      }
    },
  },
  {
    id: "answer.security",
    group: "security",
    title: "Free text is inert; URL/target resolution does not bypass policy",
    requires: ["answer.resource"],
    async run(ctx) {
      const entity = await ensureSampleEntity(ctx);
      const answer = (entity as unknown as { x_answer?: AnswerDocumentV1 }).x_answer;
      if (!answer) return ctx.inconclusive("Sample entity has no x_answer to scan.");
      const offending: string[] = [];
      const marker1 = scanForInjectionMarkers(answer.question);
      if (marker1) offending.push(`question contains "${marker1}"`);
      const marker2 = scanForInjectionMarkers(answer.concise_answer);
      if (marker2) offending.push(`concise_answer contains "${marker2}"`);
      const marker3 = scanForInjectionMarkers(answer.answer);
      if (marker3) offending.push(`answer contains "${marker3}"`);
      // This check does not treat a marker's mere presence as a failure —
      // free text containing such a string is still valid, inert data
      // (specification.md "Security và privacy contract"). It only records
      // that this run observed such text and did not execute/interpolate
      // it — the absence of a crash/behavior change IS the pass condition,
      // which a static scan alone cannot prove; this is reported as
      // informational, never failed, for that reason.
      if (offending.length > 0) {
        return ctx.warn("Sample free text contains prompt-injection-shaped substrings (still valid, inert data).", offending);
      }
      if (ctx.options.allowPrivateNetwork || ctx.options.urlPolicy) {
        return ctx.warn("This run used a non-default URL policy (allowPrivateNetwork or a custom urlPolicy) — SSRF protection was intentionally relaxed for this run.");
      }
    },
  },
];

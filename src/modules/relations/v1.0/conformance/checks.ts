/**
 * Relations Module v1.0 conformance checks (`AADP-REL-006`). Stable check
 * IDs and issue taxonomy per `spec/modules/relations/v1.0/conformance.md`.
 * Every check is a plain async function over a shared `RelationsCheckContext`
 * — no test framework, no fixture baked in — mirroring the shape of the
 * core runner's checks (`../../../../conformance/checks.ts`) without
 * sharing its code: core `CHECKS`/check IDs are never touched here
 * (ADR-0007 "Conformance boundary").
 *
 * Schema/semantic checks (`schema.*`, `semantic.*`, `collection.context`,
 * `collection.checksum`, `registry.*`) are pure — they validate a document
 * this run already fetched via `validateModuleDocument`, exactly the
 * function `AADP-REL-004`'s pure validators are registered under
 * (`../../../../module-registry/index.js`). Resolution/traversal/security
 * checks additionally exercise the `AADP-REL-005` client
 * (`../client/index.js`) against a live sample the caller supplies —
 * AADP has no routing template a runner could derive one from, so those
 * checks are `skipped`/`inconclusive`, never `failed`, when no sample URL
 * is given (same reasoning as core `ConformanceOptions.negativeTargets`).
 */
import { fetchEntity, discover, type ClientOptions, type EntityV1 } from "../../../../client/v1.0/index.js";
import { fetchJson, scopeHeadersToOrigin, AbortedError } from "../../../../client/http.js";
import { AadpRequestError, type AadpErrorEnvelope } from "../../../../client/errors.js";
import { AadpDiscoveryBudgetExceededError } from "../../../../client/discovery-budget.js";
import { validateModuleDocument, type ModuleValidationResult } from "../../../../module-registry/index.js";
import { iterateRelationCollection, traverseRelations } from "../client/index.js";
import { createRelationsTraversalBudget, type RelationsTraversalBudgetState } from "../client/budget.js";
import type { RelationCollectionV1, RelationRegistryV1, RelationSetV1 } from "../types.js";
import type { CheckResult, CheckStatus, RelationsConformanceOptions } from "./types.js";

const MODULE_ID = "aadp:relations" as const;
const MODULE_VERSION = "1.0" as const;

export interface RelationsCheckOutcome {
  status: Exclude<CheckStatus, "failed">;
  message?: string;
  details?: string[];
  inconclusive?: boolean;
}

/** Thrown by a check to record a non-pass without treating it as an unexpected defect. */
export class RelationsCheckSignal extends Error {
  constructor(
    public readonly outcome: RelationsCheckOutcome | { status: "failed"; message: string; details?: string[] }
  ) {
    super(outcome.message ?? outcome.status);
    this.name = "RelationsCheckSignal";
  }
}

/** Documents fetched once per run and reused by later checks that depend on them. */
export interface RelationsRunState {
  moduleDeclaration?: { id: string; version: string; schema: string };
  sampleEntity?: EntityV1;
  sampleRelationSet?: RelationSetV1;
  sampleRelationSetValidation?: ModuleValidationResult;
  sampleCollectionUrl?: string;
  sampleCollectionExpectation?: { sourceId: string; sourceType: string; rel: string; targetType: string };
  sampleCollectionPage?: RelationCollectionV1;
  sampleCollectionValidation?: ModuleValidationResult;
  sampleRegistry?: RelationRegistryV1;
  sampleRegistryValidation?: ModuleValidationResult;
}

export interface RelationsCheckContext {
  options: RelationsConformanceOptions;
  /** Client options for requests to `options.baseUrl`'s own origin. */
  client: ClientOptions;
  /** Client options for `targetUrl`, headers scoped to `options.baseUrl`'s origin unless allow-listed. */
  scoped: (targetUrl: string) => ClientOptions;
  budget: RelationsTraversalBudgetState;
  state: RelationsRunState;
  skip: (message: string, details?: string[]) => never;
  inconclusive: (message: string, details?: string[]) => never;
  warn: (message: string, details?: string[]) => never;
  fail: (message: string, details?: string[]) => never;
}

export interface RelationsCheck {
  id: string;
  group: string;
  title: string;
  requires?: string[];
  run: (ctx: RelationsCheckContext) => Promise<RelationsCheckOutcome | void>;
}

function validateRelations<T>(kind: "relation-set" | "relation-collection" | "relation-registry", data: unknown) {
  return validateModuleDocument({ moduleId: MODULE_ID, moduleVersion: MODULE_VERSION, kind }, data) as ModuleValidationResult & {
    _brand?: T;
  };
}

function hasIssueCode(validation: ModuleValidationResult, code: string): boolean {
  return validation.semanticIssues.some((issue) => issue.code === code);
}

/** True when the document is schema-valid (regardless of pure-semantic outcome) — see module docstring. */
function schemaPassed(validation: ModuleValidationResult): boolean {
  return validation.errors.length === 0;
}

async function ensureSampleEntity(ctx: RelationsCheckContext): Promise<EntityV1> {
  if (ctx.state.sampleEntity) return ctx.state.sampleEntity;
  const url = ctx.options.sampleEntityUrl;
  if (!url) return ctx.inconclusive("options.sampleEntityUrl was not supplied; cannot exercise this check against a live target.");
  const entity = await fetchEntity(url, ctx.scoped(url), ctx.budget);
  ctx.state.sampleEntity = entity;
  return entity;
}

async function ensureSampleRelationSet(ctx: RelationsCheckContext): Promise<{ raw: unknown; validation: ModuleValidationResult }> {
  if (ctx.state.sampleRelationSetValidation) {
    return { raw: ctx.state.sampleRelationSet, validation: ctx.state.sampleRelationSetValidation };
  }
  const entity = await ensureSampleEntity(ctx);
  const xRelations = (entity as unknown as { x_relations?: unknown }).x_relations;
  if (xRelations === undefined) {
    return ctx.inconclusive(`Entity ${entity.id} at options.sampleEntityUrl has no x_relations to validate.`);
  }
  const validation = validateRelations("relation-set", xRelations);
  ctx.state.sampleRelationSet = xRelations as RelationSetV1;
  ctx.state.sampleRelationSetValidation = validation;
  return { raw: xRelations, validation };
}

/** Finds the first `cardinality: many` item backed by a `collection` link in the sample relation-set, if any. */
function findSampleCollectionItem(relationSet: RelationSetV1 | undefined) {
  return relationSet?.items.find((item) => item.cardinality === "many" && item.collection);
}

async function ensureSampleCollectionPage(
  ctx: RelationsCheckContext
): Promise<{ validation: ModuleValidationResult; page?: RelationCollectionV1 }> {
  if (ctx.state.sampleCollectionValidation) return { validation: ctx.state.sampleCollectionValidation, page: ctx.state.sampleCollectionPage };
  const { validation: relationSetValidation } = await ensureSampleRelationSet(ctx);
  if (!schemaPassed(relationSetValidation)) {
    return ctx.inconclusive("Sample relation-set failed schema validation; cannot locate a collection link to test.");
  }
  const item = findSampleCollectionItem(ctx.state.sampleRelationSet);
  if (!item?.collection) {
    return ctx.inconclusive("No cardinality: many relation with a collection link was found in the sample relation-set.");
  }
  const entity = ctx.state.sampleEntity!;
  const url = item.collection.url;
  // Fetches the raw document and validates it separately, rather than
  // `fetchAndValidateRelationsDocument` (which throws on ANY validation
  // failure, schema or semantic) — a document that is schema-valid but
  // semantically wrong (e.g. a checksum mismatch) must still reach the
  // `relations.collection.*` checks below with its real semantic issues,
  // not be collapsed into an opaque "fetch/validate failed".
  const { status, data } = await fetchJson(url, ctx.scoped(url), ctx.budget);
  if (status < 200 || status >= 300) return ctx.fail(`Sample collection at ${url} answered with status ${status}.`);
  const page = data as RelationCollectionV1;
  const validation = validateRelations("relation-collection", page);
  ctx.state.sampleCollectionUrl = url;
  ctx.state.sampleCollectionExpectation = { sourceId: entity.id, sourceType: entity.type, rel: item.rel, targetType: item.target_type };
  ctx.state.sampleCollectionPage = page;
  ctx.state.sampleCollectionValidation = validation;
  return { validation, page };
}

async function ensureSampleRegistry(ctx: RelationsCheckContext): Promise<{ validation: ModuleValidationResult; registry?: RelationRegistryV1 }> {
  if (ctx.state.sampleRegistryValidation) return { validation: ctx.state.sampleRegistryValidation, registry: ctx.state.sampleRegistry };
  const url = ctx.options.sampleRegistryUrl;
  if (!url) return ctx.inconclusive("options.sampleRegistryUrl was not supplied; cannot exercise registry checks against a live document.");
  // See the comment in `ensureSampleCollectionPage` above: fetch + validate
  // separately so a schema-valid-but-semantically-wrong registry still
  // reaches `relations.registry.*` with its real semantic issues.
  const { status, data } = await fetchJson(url, ctx.scoped(url), ctx.budget);
  if (status < 200 || status >= 300) return ctx.fail(`Sample registry at ${url} answered with status ${status}.`);
  const registry = data as RelationRegistryV1;
  const validation = validateRelations("relation-registry", registry);
  ctx.state.sampleRegistry = registry;
  ctx.state.sampleRegistryValidation = validation;
  return { validation, registry };
}

const FORBIDDEN_SOCIAL_TOKENS = new Set(["follows", "followers"]);

export const RELATIONS_CHECKS: RelationsCheck[] = [
  {
    id: "relations.discovery.declared",
    group: "discovery",
    title: "Manifest declares aadp:relations@1.0 exactly",
    async run(ctx) {
      if (!ctx.options.baseUrl) return ctx.inconclusive("options.baseUrl was not supplied.");
      const manifest = await discover(ctx.options.baseUrl, ctx.client, ctx.budget);
      const declared = manifest.modules?.find((m) => m.id === MODULE_ID);
      if (!declared) return ctx.inconclusive(`Manifest at ${ctx.options.baseUrl} does not declare module "${MODULE_ID}".`);
      if (declared.version !== MODULE_VERSION) {
        return ctx.inconclusive(`Manifest declares ${MODULE_ID}@${declared.version}, not the ${MODULE_VERSION} this runner exercises.`);
      }
      ctx.state.moduleDeclaration = declared;
    },
  },
  {
    id: "relations.schema.reachable",
    group: "discovery",
    title: "Module schema dispatch URL is reachable and JSON",
    requires: ["relations.discovery.declared"],
    async run(ctx) {
      const declared = ctx.state.moduleDeclaration!;
      const { status, data, contentType } = await fetchJson(declared.schema, ctx.scoped(declared.schema), ctx.budget);
      if (status < 200 || status >= 300) return ctx.fail(`Schema URL ${declared.schema} answered with status ${status}.`);
      if (!contentType || !/^application\/json\b/i.test(contentType)) {
        return ctx.fail(`Schema URL ${declared.schema} did not answer application/json (got "${contentType}").`);
      }
      if (typeof data !== "object" || data === null || !("oneOf" in (data as object))) {
        return ctx.warn(`Schema at ${declared.schema} does not look like a "oneOf" module dispatch document.`);
      }
    },
  },
  {
    id: "relations.schema.relation_set",
    group: "schema",
    title: "Sample x_relations passes the relation-set schema",
    async run(ctx) {
      const { validation } = await ensureSampleRelationSet(ctx);
      if (!schemaPassed(validation)) {
        return ctx.fail("Sample relation-set failed schema validation.", validation.errors.map((e) => JSON.stringify(e)));
      }
    },
  },
  {
    id: "relations.schema.collection",
    group: "schema",
    title: "Sample relation-collection page passes its schema",
    requires: ["relations.schema.relation_set"],
    async run(ctx) {
      const { validation } = await ensureSampleCollectionPage(ctx);
      if (!schemaPassed(validation)) {
        return ctx.fail("Sample relation-collection page failed schema validation.", validation.errors.map((e) => JSON.stringify(e)));
      }
    },
  },
  {
    id: "relations.schema.registry",
    group: "schema",
    title: "Sample relation-registry passes its schema",
    async run(ctx) {
      const { validation } = await ensureSampleRegistry(ctx);
      if (!schemaPassed(validation)) {
        return ctx.fail("Sample relation-registry failed schema validation.", validation.errors.map((e) => JSON.stringify(e)));
      }
    },
  },
  {
    id: "relations.semantic.cardinality",
    group: "semantic",
    title: "Cardinality/container consistency (invalid_cardinality_container)",
    requires: ["relations.schema.relation_set"],
    async run(ctx) {
      const { validation } = await ensureSampleRelationSet(ctx);
      if (hasIssueCode(validation, "invalid_cardinality_container")) {
        return ctx.fail("Sample relation-set has a cardinality/container inconsistency.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.semantic.tokens",
    group: "semantic",
    title: "Standard/vendor relation tokens (invalid_relation_token)",
    requires: ["relations.schema.relation_set"],
    async run(ctx) {
      const { validation } = await ensureSampleRelationSet(ctx);
      if (hasIssueCode(validation, "invalid_relation_token")) {
        return ctx.fail("Sample relation-set uses an invalid relation token.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.semantic.target_identity",
    group: "semantic",
    title: "Target ID prefix matches target_type (target_identity_mismatch)",
    requires: ["relations.schema.relation_set"],
    async run(ctx) {
      const { validation } = await ensureSampleRelationSet(ctx);
      if (hasIssueCode(validation, "target_identity_mismatch")) {
        return ctx.fail("Sample relation-set has a target id/type_prefix mismatch.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.semantic.duplicate_target",
    group: "semantic",
    title: "No duplicate target IDs within a relation item (duplicate_target)",
    requires: ["relations.schema.relation_set"],
    async run(ctx) {
      const { validation } = await ensureSampleRelationSet(ctx);
      if (hasIssueCode(validation, "duplicate_target")) {
        return ctx.fail("Sample relation-set has a duplicate target.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.collection.context",
    group: "collection",
    title: "Collection page source/rel/target_type matches its relation item (collection_context_mismatch)",
    requires: ["relations.schema.collection"],
    async run(ctx) {
      const { validation } = await ensureSampleCollectionPage(ctx);
      if (hasIssueCode(validation, "collection_context_mismatch")) {
        return ctx.fail("Sample collection page context is inconsistent.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.collection.pagination",
    group: "collection",
    title: "Collection pagination terminates without a cursor cycle",
    requires: ["relations.schema.collection"],
    async run(ctx) {
      await ensureSampleCollectionPage(ctx);
      const url = ctx.state.sampleCollectionUrl;
      const expected = ctx.state.sampleCollectionExpectation;
      if (!url || !expected) return ctx.inconclusive("No sample collection was available to paginate.");
      let pages = 0;
      // A fresh budget sharing only the run's page/deadline limits — not
      // `ctx.budget` itself, so this walk's page count doesn't consume the
      // same counter other checks (e.g. `relations.traversal.*`) charge
      // against.
      const pageBudget = createRelationsTraversalBudget({ maxPages: ctx.budget.maxPages, deadlineMs: ctx.budget.deadlineMs });
      try {
        for await (const _item of iterateRelationCollection(url, expected, ctx.scoped(url), pageBudget)) {
          pages++;
        }
      } catch (err) {
        if (err instanceof AadpDiscoveryBudgetExceededError) {
          // Not evidence of a cycle (cycle detection would have thrown
          // RelationsCursorCycleError instead) — but also not evidence
          // pagination terminates: bounded-but-unproven MUST NOT be
          // reported as a pass (specification.md §12), so this is
          // inconclusive rather than a warning that a default report
          // treats as a clean pass.
          return ctx.inconclusive(`Collection did not terminate within ${pageBudget.maxPages} pages; cannot confirm pagination terminates.`);
        }
        return ctx.fail(`Collection pagination failed: ${(err as Error).message}`);
      }
    },
  },
  {
    id: "relations.collection.checksum",
    group: "collection",
    title: "Collection page checksum matches canonical items (collection_checksum_mismatch)",
    requires: ["relations.schema.collection"],
    async run(ctx) {
      const { validation } = await ensureSampleCollectionPage(ctx);
      if (hasIssueCode(validation, "collection_checksum_mismatch")) {
        return ctx.fail("Sample collection page checksum does not match its items.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.registry.unique_token",
    group: "registry",
    title: "Registry token uniqueness (duplicate_registry_token)",
    requires: ["relations.schema.registry"],
    async run(ctx) {
      const { validation } = await ensureSampleRegistry(ctx);
      if (hasIssueCode(validation, "duplicate_registry_token")) {
        return ctx.fail("Sample registry has a duplicate token.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.registry.checksum",
    group: "registry",
    title: "Registry checksum matches canonical relations (registry_checksum_mismatch)",
    requires: ["relations.schema.registry"],
    async run(ctx) {
      const { validation } = await ensureSampleRegistry(ctx);
      if (hasIssueCode(validation, "registry_checksum_mismatch")) {
        return ctx.fail("Sample registry checksum does not match its relations.", validation.semanticIssues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.http.errors",
    group: "http",
    title: "Negative target answers an AADP error envelope",
    async run(ctx) {
      const url = ctx.options.negativeTargetUrl;
      if (!url) return ctx.inconclusive("options.negativeTargetUrl was not supplied.");
      const { status, data } = await fetchJson(url, ctx.scoped(url), ctx.budget);
      if (status >= 200 && status < 300) return ctx.fail(`Negative target ${url} answered ${status}, expected an error status.`);
      const envelope = data as AadpErrorEnvelope | undefined;
      if (!envelope?.error?.code || typeof envelope.error.code !== "string") {
        return ctx.fail(`Negative target ${url} did not answer a well-formed AADP error envelope.`);
      }
    },
  },
  {
    id: "relations.http.cache",
    group: "http",
    title: "Collection/registry supports conditional GET (SHOULD, not MUST)",
    async run(ctx) {
      const url = ctx.options.sampleRegistryUrl ?? ctx.state.sampleCollectionUrl;
      if (!url) return ctx.inconclusive("No sample collection/registry URL was available to probe caching on.");
      const first = await fetchJson(url, ctx.scoped(url), ctx.budget);
      const etag = first.headers.get("etag");
      const lastModified = first.headers.get("last-modified");
      if (!etag && !lastModified) {
        return ctx.warn(`${url} sent neither ETag nor Last-Modified — conditional GET is SHOULD, not MUST (spec v1.0 §9).`);
        return;
      }
      const condHeaders: Record<string, string> = {};
      if (etag) condHeaders["If-None-Match"] = etag;
      if (lastModified) condHeaders["If-Modified-Since"] = lastModified;
      const second = await fetchJson(url, { ...ctx.scoped(url), headers: { ...ctx.scoped(url).headers, ...condHeaders } }, ctx.budget);
      if (second.status !== 304) {
        return ctx.warn(`${url} sent a validator but did not answer 304 to a matching conditional GET.`);
      }
    },
  },
  {
    id: "relations.traversal.budget",
    group: "traversal",
    title: "Traversal respects the run's effective budget limits",
    async run(ctx) {
      if (!ctx.options.sampleEntityUrl) return ctx.inconclusive("options.sampleEntityUrl was not supplied.");
      const result = await traverseRelations(ctx.options.sampleEntityUrl, {
        ...ctx.client,
        rootOrigin: new URL(ctx.options.sampleEntityUrl).origin,
        maxPages: ctx.budget.maxPages,
        maxDepth: ctx.options.maxDepth,
        maxNodes: ctx.options.maxNodes,
        maxRequests: ctx.options.maxRequests,
        maxTotalBytes: ctx.options.maxTotalBytes,
        maxCrossOriginRequests: ctx.options.maxCrossOriginRequests,
        deadlineMs: ctx.options.deadlineMs,
      });
      if (result.partial) {
        return ctx.warn(`Traversal from ${ctx.options.sampleEntityUrl} was cut short by a configured limit.`, result.issues.map((i) => i.message));
      }
    },
  },
  {
    id: "relations.traversal.cycle",
    group: "traversal",
    title: "Graph/cursor cycles are contained, not an infinite walk",
    requires: ["relations.traversal.budget"],
    async run(ctx) {
      if (!ctx.options.sampleEntityUrl) return ctx.inconclusive("options.sampleEntityUrl was not supplied.");
      // followEdges + a generous but finite depth: if the deployment has a
      // cycle, this only proves it (completing normally) if cycle
      // containment actually works — an unbounded walk would instead hit
      // the deadline/node budget below, which is still a safe (not hung)
      // outcome, just reported as a warning rather than a clean pass.
      const result = await traverseRelations(ctx.options.sampleEntityUrl, {
        ...ctx.client,
        rootOrigin: new URL(ctx.options.sampleEntityUrl).origin,
        followEdges: true,
        maxPages: ctx.budget.maxPages,
        maxDepth: ctx.options.maxDepth ?? 5,
        maxNodes: ctx.options.maxNodes ?? 200,
        deadlineMs: ctx.options.deadlineMs ?? 30_000,
      });
      if (result.partial && result.issues.some((i) => i.code === "traversal_budget_exceeded")) {
        // Same reasoning as `relations.collection.pagination`: cut short
        // by budget is not evidence the walk terminates on its own, so
        // this MUST NOT be reportable as a default-passing warning —
        // inconclusive, not warn (specification.md §12).
        return ctx.inconclusive(
          "Traversal was cut short by a budget rather than terminating on its own — cannot confirm cycle containment alone proved termination."
        );
      }
    },
  },
  {
    id: "relations.traversal.partial",
    group: "traversal",
    title: "A partial result always carries issue provenance",
    requires: ["relations.traversal.budget"],
    async run(ctx) {
      if (!ctx.options.sampleEntityUrl) return ctx.inconclusive("options.sampleEntityUrl was not supplied.");
      const result = await traverseRelations(ctx.options.sampleEntityUrl, {
        ...ctx.client,
        rootOrigin: new URL(ctx.options.sampleEntityUrl).origin,
        maxPages: ctx.budget.maxPages,
        maxNodes: 1, // deliberately tiny — forces a partial result to inspect provenance
      });
      if (result.partial && result.issues.length === 0) {
        return ctx.fail("Traversal reported partial: true without any issue explaining why.");
      }
    },
  },
  {
    id: "relations.security.url_policy",
    group: "security",
    title: "This run enforced URL/DNS policy (no unacknowledged private-network access)",
    async run(ctx) {
      if (ctx.options.allowPrivateNetwork || ctx.options.urlPolicy) {
        return ctx.warn("This run used a non-default URL policy (allowPrivateNetwork or a custom urlPolicy) — SSRF protection was intentionally relaxed for this run.");
      }
    },
  },
  {
    id: "relations.security.credentials",
    group: "security",
    title: "Credential headers are stripped cross-origin unless explicitly allow-listed",
    async run(ctx) {
      if (!ctx.options.headers) return ctx.skip("No options.headers were configured for this run — nothing to scope.");
      const probeUrl = ctx.options.crossOriginProbeUrl;
      if (!probeUrl) {
        return ctx.inconclusive(
          "options.crossOriginProbeUrl was not supplied; cannot observe whether a cross-origin request actually received (or was stripped of) options.headers."
        );
      }
      const homeUrl = ctx.options.baseUrl ?? ctx.options.sampleEntityUrl;
      if (!homeUrl) {
        return ctx.inconclusive("Neither options.baseUrl nor options.sampleEntityUrl is set; there is no root origin to scope headers against.");
      }
      const homeOrigin = new URL(homeUrl).origin;
      if (new URL(probeUrl).origin === homeOrigin) {
        return ctx.fail("options.crossOriginProbeUrl must be on a different origin than baseUrl/sampleEntityUrl to prove cross-origin scoping.");
      }

      const { status, data } = await fetchJson(probeUrl, scopeHeadersToOrigin(ctx.client, probeUrl, homeOrigin), ctx.budget);
      if (status < 200 || status >= 300) return ctx.fail(`Cross-origin probe at ${probeUrl} answered with status ${status}.`);
      const received = (data as { received_headers?: Record<string, string> } | undefined)?.received_headers;
      if (!received || typeof received !== "object") {
        return ctx.fail(`Cross-origin probe at ${probeUrl} did not answer { received_headers: {...} } as documented.`);
      }
      const receivedLower = new Set(Object.keys(received).map((h) => h.toLowerCase()));
      const safeList = new Set((ctx.options.crossOriginSafeHeaders ?? []).map((h) => h.toLowerCase()));

      const leaked: string[] = [];
      const wrongfullyStripped: string[] = [];
      for (const name of Object.keys(ctx.options.headers)) {
        const lower = name.toLowerCase();
        const wasReceived = receivedLower.has(lower);
        if (safeList.has(lower)) {
          if (!wasReceived) wrongfullyStripped.push(name);
        } else if (wasReceived) {
          leaked.push(name);
        }
      }

      if (leaked.length > 0) {
        return ctx.fail(
          `Cross-origin request at ${probeUrl} received header(s) not in crossOriginSafeHeaders: ${leaked.join(", ")}.`
        );
      }
      if (wrongfullyStripped.length > 0) {
        return ctx.fail(
          `Cross-origin request at ${probeUrl} did not receive allow-listed header(s): ${wrongfullyStripped.join(", ")}.`
        );
      }
    },
  },
  {
    id: "relations.privacy.social_graph",
    group: "privacy",
    title: "No public follows/followers relation token (specification.md §8)",
    async run(ctx) {
      if (!ctx.options.sampleEntityUrl && !ctx.options.sampleRegistryUrl) {
        return ctx.inconclusive("No sample entity/registry was supplied to scan.");
      }
      const offending: string[] = [];
      if (ctx.options.sampleEntityUrl) {
        const { raw } = await ensureSampleRelationSet(ctx).catch(() => ({ raw: undefined }));
        const items = (raw as RelationSetV1 | undefined)?.items ?? [];
        for (const item of items) {
          if (FORBIDDEN_SOCIAL_TOKENS.has(item.rel)) offending.push(`x_relations item rel="${item.rel}"`);
        }
      }
      if (ctx.options.sampleRegistryUrl) {
        const { registry } = await ensureSampleRegistry(ctx).catch(() => ({ registry: undefined }));
        for (const entry of registry?.relations ?? []) {
          if (FORBIDDEN_SOCIAL_TOKENS.has(entry.token)) offending.push(`registry token="${entry.token}"`);
        }
      }
      if (offending.length > 0) {
        return ctx.fail("Public follows/followers relation token found (privacy risk — spec v1.0 §8).", offending);
      }
    },
  },
];

export { AadpRequestError, AbortedError, scopeHeadersToOrigin };

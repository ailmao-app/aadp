/**
 * The `aadp:graph-traversal@1.0` check registry.
 *
 * Check IDs are package API — stable under this package's SemVer — while the
 * message text is not. The profile has no wire artifact of its own: it certifies
 * that a traversal IMPLEMENTATION upholds ADR-0011, so every check runs against
 * the in-package fixture matrix and needs no deployment.
 *
 * This file owns its own check-ID namespace and never touches the core,
 * Relations, Answer or Evidence registries.
 */
import type { EntityV1 } from "../../../client/v1.0/index.js";
import { createAdapterLookup, type TraversalAdapterLookup } from "../registry.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../adapters/builtins.js";
import { planNodeExpansions } from "../edge-planner.js";
import { InvalidGraphTraversalOptionsError, resolveTraversalOptions } from "../options.js";
import { streamTraversal } from "../scheduler.js";
import {
  createTraversalProgress,
  runTraversalWalk,
  walkTraversal,
  type TraversalNodeResolver,
  type TraversalWalkOutcome,
} from "../state-machine.js";
import type { GraphEdgeV1, GraphTraversalEventV1, GraphTraversalSummaryV1 } from "../types.js";
import {
  answerRoot,
  answerWrapper,
  claimEntity,
  cycleEntities,
  diamondEntities,
  documentEntity,
  evidenceEntity,
  fanInEntities,
  fixtureEntity,
  fixtureResolver,
  FIXTURE_URLS,
  generatedSummaryEntities,
  multiOutcomeEntities,
  relationSet,
} from "./fixtures.js";
import type { CheckStatus, GraphCheckLevel } from "./types.js";

export interface GraphCheckOutcome {
  status: CheckStatus;
  message?: string;
  details?: string[];
  inconclusive?: boolean;
}

export interface GraphCheckContext {
  lookup: TraversalAdapterLookup;
  signal?: AbortSignal;
}

export interface GraphTraversalCheck {
  id: string;
  group: string;
  title: string;
  level: GraphCheckLevel;
  run(context: GraphCheckContext): Promise<GraphCheckOutcome>;
}

/* ------------------------------------------------------------------------- *
 * Helpers.
 * ------------------------------------------------------------------------- */

const PASS: GraphCheckOutcome = { status: "passed" };

function fail(message: string, details?: string[]): GraphCheckOutcome {
  return { status: "failed", message, ...(details ? { details } : {}) };
}

interface WalkResult extends TraversalWalkOutcome {
  requested: string[];
}

async function walk(
  entities: Record<string, EntityV1>,
  context: GraphCheckContext,
  over: {
    root?: string | EntityV1;
    maxDepth?: number;
    includeGeneratedSummarySources?: boolean;
    resolve?: TraversalNodeResolver;
    requested?: string[];
  } = {}
): Promise<WalkResult> {
  const fixture = fixtureResolver(entities);
  const resolve = over.resolve ?? fixture.resolve;
  const requested = over.requested ?? fixture.requested;
  const outcome = await runTraversalWalk(over.root ?? entities[FIXTURE_URLS.answer]!, {
    rootUrl: FIXTURE_URLS.answer,
    lookup: context.lookup,
    resolve,
    maxDepth: over.maxDepth ?? 3,
    followCollections: false,
    includeGeneratedSummarySources: over.includeGeneratedSummarySources ?? false,
  });
  return { ...outcome, requested };
}

const edgesOf = (outcome: TraversalWalkOutcome): GraphEdgeV1[] =>
  outcome.events.filter((e): e is Extract<GraphTraversalEventV1, { type: "edge" }> => e.type === "edge").map((e) => e.edge);

const expansionsOf = (outcome: TraversalWalkOutcome) =>
  outcome.events
    .filter((e): e is Extract<GraphTraversalEventV1, { type: "expansion" }> => e.type === "expansion")
    .map((e) => e.expansion);

/** A comparable projection of an event sequence — order included. */
const shapeOf = (events: GraphTraversalEventV1[]): string[] =>
  events.map((event) => {
    switch (event.type) {
      case "node":
        return `node:${event.node.key}:${event.node.status}`;
      case "reference":
        return `reference:${event.reference.edgeGroup}#${event.reference.index}`;
      case "edge":
        return `edge:${event.edge.edgeGroup}#${event.edge.index}:${event.edge.outcome}`;
      case "expansion":
        return `expansion:${event.expansion.extensionField}:${event.expansion.outcome}`;
      case "complete":
        return `complete:${event.summary.stopReason}`;
    }
  });

/** A malformed `x_answer`: the wrapper no longer matches its own content checksum. */
function malformedAnswerRoot(): EntityV1 {
  const root = answerRoot();
  const broken = { ...(root.x_answer as Record<string, unknown>), question: "tampered after sealing" };
  return { ...root, x_answer: broken } as EntityV1;
}

/* ------------------------------------------------------------------------- *
 * Capability negotiation.
 * ------------------------------------------------------------------------- */

const capabilityChecks: GraphTraversalCheck[] = [
  {
    id: "graph.capability.no_manifest_request",
    group: "graph.capability",
    title: "Traversal never requests a manifest of its own",
    level: "error",
    async run(context) {
      const result = await walk(diamondEntities(), context);
      const manifests = result.requested.filter((url) => url.includes("/.well-known/ai-manifest.json"));
      return manifests.length === 0
        ? PASS
        : fail("Traversal requested a manifest; adapters are chosen from the entity payload alone.", manifests);
    },
  },
  {
    id: "graph.capability.unsupported_is_not_error",
    group: "graph.capability",
    title: "An unknown module is an outcome, not a failure",
    level: "error",
    async run(context) {
      const root = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_vendor: { module: "vendor:unknown", version: "9.9" },
      });
      const result = await walk({ [FIXTURE_URLS.answer]: root }, context, { root });
      const expansions = expansionsOf(result);
      if (expansions.length !== 1 || expansions[0]!.outcome !== "unsupported-module") {
        return fail(`Expected one unsupported-module expansion, got ${JSON.stringify(expansions.map((e) => e.outcome))}`);
      }
      return result.summary.stopReason === "exhausted"
        ? PASS
        : fail(`An unsupported module stopped the walk (${result.summary.stopReason}).`);
    },
  },
  {
    id: "graph.capability.exact_match",
    group: "graph.capability",
    title: "Adapter lookup is exact — no fallback to another version",
    level: "error",
    async run(context) {
      const root = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_answer: { ...(answerWrapper() as Record<string, unknown>), version: "2.0" },
      });
      const result = await walk({ [FIXTURE_URLS.answer]: root }, context, { root });
      const [expansion] = expansionsOf(result);
      return expansion?.outcome === "unsupported-module"
        ? PASS
        : fail(`x_answer@2.0 resolved to outcome "${expansion?.outcome}" — a 1.0 adapter must not answer for 2.0.`);
    },
  },
];

/* ------------------------------------------------------------------------- *
 * Validation and the edge matrix.
 * ------------------------------------------------------------------------- */

const traversalChecks: GraphTraversalCheck[] = [
  {
    id: "graph.traversal.extension_validated",
    group: "graph.traversal",
    title: "A malformed extension yields invalid-extension with both issue channels and no child request",
    level: "error",
    async run(context) {
      const root = malformedAnswerRoot();
      const result = await walk({ [FIXTURE_URLS.answer]: root }, context, { root });
      const [expansion] = expansionsOf(result);
      if (expansion?.outcome !== "invalid-extension") {
        return fail(`Expected invalid-extension, got "${expansion?.outcome}".`);
      }
      if (expansion.errors === undefined || expansion.semanticIssues === undefined) {
        return fail("invalid-extension must carry both `errors` and `semanticIssues`.");
      }
      const childRequests = result.requested.filter((url) => url !== FIXTURE_URLS.answer);
      return childRequests.length === 0
        ? PASS
        : fail("A malformed extension still produced child requests.", childRequests);
    },
  },
  {
    id: "graph.traversal.extension_scoped",
    group: "graph.traversal",
    title: "One broken extension does not stop the other adapters on the same entity",
    level: "error",
    async run(context) {
      const broken = { ...(answerRoot().x_answer as Record<string, unknown>), question: "tampered" };
      const root = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_answer: broken,
        x_relations: relationSet([
          {
            rel: "related",
            target_type: "document",
            cardinality: "one",
            target: { id: "document:d", url: FIXTURE_URLS.document },
          },
        ]),
      });
      const result = await walk(
        { [FIXTURE_URLS.answer]: root, [FIXTURE_URLS.document]: documentEntity() },
        context,
        { root }
      );
      const outcomes = expansionsOf(result).map((e) => `${e.extensionField}:${e.outcome}`);
      const relationEdges = edgesOf(result).filter((e) => e.edgeGroup === "relations.item");
      return outcomes.includes("x_answer:invalid-extension") && relationEdges.length === 1
        ? PASS
        : fail("A broken x_answer suppressed the Relations edges on the same entity.", outcomes);
    },
  },
  {
    id: "graph.traversal.edge_matrix",
    group: "graph.traversal",
    title: "Every observed edge belongs to exactly one row of the edge matrix",
    level: "error",
    async run(context) {
      const known = new Set([
        "relations.item",
        "relations.collection",
        "answer.related_entity",
        "answer.source_target",
        "evidence.evidence_ref",
      ]);
      const results = await Promise.all([
        walk(diamondEntities(), context),
        walk(fanInEntities(), context),
        walk(generatedSummaryEntities(), context, { includeGeneratedSummarySources: true }),
      ]);
      const unknown = results
        .flatMap(edgesOf)
        .map((edge) => edge.edgeGroup)
        .filter((group) => !known.has(group));
      return unknown.length === 0 ? PASS : fail("Edges appeared outside the edge matrix.", [...new Set(unknown)]);
    },
  },
  {
    id: "graph.traversal.source_targets_opt_in",
    group: "graph.traversal",
    title: "authorship.source_targets is never requested without the opt-in",
    level: "error",
    async run(context) {
      const off = await walk(generatedSummaryEntities(), context);
      if (off.requested.includes(FIXTURE_URLS.document)) {
        return fail("A generated summary's source targets were fetched without includeGeneratedSummarySources.");
      }
      const on = await walk(generatedSummaryEntities(), context, { includeGeneratedSummarySources: true });
      return on.requested.includes(FIXTURE_URLS.document)
        ? PASS
        : fail("The opt-in did not make source targets reachable.");
    },
  },
  {
    id: "graph.traversal.metadata_not_fetched",
    group: "graph.traversal",
    title: "An evidence entity's source and publisher URLs are never fetched",
    level: "error",
    async run(context) {
      const result = await walk(diamondEntities(), context);
      const metadata = result.requested.filter(
        (url) => url === FIXTURE_URLS.evidenceSource || url === FIXTURE_URLS.evidencePublisher
      );
      return metadata.length === 0 ? PASS : fail("Evidence source metadata was dereferenced.", metadata);
    },
  },
  {
    id: "graph.traversal.cycle_contained",
    group: "graph.traversal",
    title: "A true ancestor re-entry is reported as a cycle and terminates",
    level: "error",
    async run(context) {
      const result = await walk(cycleEntities(), context);
      const back = edgesOf(result).find((edge) => edge.edgeGroup === "relations.item");
      if (back?.outcome !== "cycle") return fail(`Expected outcome "cycle", got "${back?.outcome}".`);
      return result.summary.stopReason === "exhausted" ? PASS : fail("A cycle did not terminate cleanly.");
    },
  },
  {
    id: "graph.traversal.fanin_not_cycle",
    group: "graph.traversal",
    title: "A diamond re-entry is already-expanded, never a cycle",
    level: "error",
    async run(context) {
      const result = await walk(fanInEntities(), context);
      const outcomes = edgesOf(result)
        .filter((edge) => edge.edgeGroup === "relations.item")
        .map((edge) => edge.outcome);
      if (outcomes.includes("cycle")) return fail("A fan-in was misreported as a cycle.", outcomes);
      return outcomes.includes("already-expanded")
        ? PASS
        : fail("A fan-in did not produce already-expanded.", outcomes);
    },
  },
  {
    id: "graph.traversal.depth_boundary",
    group: "graph.traversal",
    title: "A node landing exactly on maxDepth is resolved; only deeper edges are blocked",
    level: "error",
    async run(context) {
      const result = await walk(diamondEntities(), context, { maxDepth: 1 });
      if (!result.requested.includes(FIXTURE_URLS.claimOne)) {
        return fail("A node landing exactly on maxDepth was not resolved.");
      }
      const deeper = edgesOf(result).filter((edge) => edge.edgeGroup === "evidence.evidence_ref");
      return deeper.length > 0 && deeper.every((edge) => edge.outcome === "depth-limit")
        ? PASS
        : fail("Edges landing past maxDepth were not blocked.", deeper.map((e) => e.outcome));
    },
  },
  {
    id: "graph.traversal.edge_outcome_per_occurrence",
    group: "graph.traversal",
    title: "One extension may plan edges with different fates, each reported on its own edge",
    level: "error",
    async run(context) {
      // maxDepth 2 lets the claim's two edges take DIFFERENT fates: one
      // re-enters the root (cycle), the other lands inside the limit and
      // expands. At maxDepth 1 both would simply be depth-limited, which would
      // prove nothing about per-occurrence outcomes.
      const result = await walk(multiOutcomeEntities(), context, { maxDepth: 2 });
      const fromClaim = edgesOf(result).filter((edge) => edge.from.includes("claim:c1"));
      const outcomes = new Set(fromClaim.map((edge) => edge.outcome));
      if (outcomes.size < 2) {
        return fail("Edges of one extension were collapsed into a single outcome.", [...outcomes]);
      }
      const record = expansionsOf(result).find(
        (expansion) => expansion.key.includes("claim:c1") && expansion.extensionField === "x_relations"
      );
      return record?.outcome === "planned"
        ? PASS
        : fail(`The extension record took an edge-level outcome ("${record?.outcome}").`);
    },
  },
  {
    id: "graph.traversal.blocked_edge_emitted",
    group: "graph.traversal",
    title: "An edge blocked before any fetch is still emitted, has no status, and counts",
    level: "error",
    async run(context) {
      const result = await walk(diamondEntities(), context, { maxDepth: 0 });
      const blocked = edgesOf(result);
      if (blocked.length === 0) return fail("Blocked edges were dropped instead of emitted.");
      const withStatus = blocked.filter((edge) => edge.status !== undefined);
      if (withStatus.length > 0) {
        return fail("A blocked edge carried a resolution status it never obtained.", withStatus.map((e) => e.edgeGroup));
      }
      return result.summary.edges === blocked.length
        ? PASS
        : fail(`summary.edges (${result.summary.edges}) omits blocked edges (${blocked.length}).`);
    },
  },
  {
    id: "graph.traversal.root_identity",
    group: "graph.traversal",
    title: "A root with no URL is invalid options, thrown before the first request",
    level: "error",
    async run() {
      const rootless = fixtureEntity({ id: "answer:a", type: "answer", x_answer: answerWrapper() });
      try {
        resolveTraversalOptions(rootless, {
          budget: { maxDepth: 3 } as never,
        });
      } catch (err) {
        return err instanceof InvalidGraphTraversalOptionsError
          ? PASS
          : fail(`Expected invalid-options, got ${(err as Error).name}.`);
      }
      return fail("A root with no canonical_url and no rootUrl was accepted.");
    },
  },
  {
    id: "graph.traversal.type_mismatch_scoped",
    group: "graph.traversal",
    title: "A wrong target_type is a verdict for that occurrence alone",
    level: "error",
    async run(context) {
      const root = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_answer: answerWrapper({
          related_entities: [
            { target_type: "claim", target: { id: "claim:c1", url: FIXTURE_URLS.claimOne } },
            { target_type: "claim", target: { id: "claim:mislabelled", url: FIXTURE_URLS.document } },
          ],
        }),
      });
      const result = await walk(
        {
          [FIXTURE_URLS.answer]: root,
          [FIXTURE_URLS.claimOne]: claimEntity("claim:c1", FIXTURE_URLS.claimOne),
          [FIXTURE_URLS.evidence]: evidenceEntity(),
          [FIXTURE_URLS.document]: documentEntity("claim:mislabelled", FIXTURE_URLS.document),
        },
        context,
        { root }
      );

      const mismatch = edgesOf(result).find((edge) => edge.index === 1 && edge.edgeGroup === "answer.related_entity");
      if (mismatch?.status !== "invalid") {
        return fail(`A type mismatch was not reported as invalid (got "${mismatch?.status}").`);
      }
      const node = result.events.find((e) => e.type === "node" && e.node.key.includes("claim:mislabelled"));
      const status = node && node.type === "node" ? node.node.status : undefined;
      return status === "resolved"
        ? PASS
        : fail(`The canonical node was poisoned by one occurrence's verdict (status "${status}").`);
    },
  },
];

/* ------------------------------------------------------------------------- *
 * Ordering.
 * ------------------------------------------------------------------------- */

const orderingChecks: GraphTraversalCheck[] = [
  {
    id: "graph.ordering.property_order_independent",
    group: "graph.ordering",
    title: "Reversing the order of x_* properties does not change the event sequence",
    level: "error",
    async run(context) {
      const relations = relationSet([
        {
          rel: "related",
          target_type: "document",
          cardinality: "one",
          target: { id: "document:d", url: FIXTURE_URLS.document },
        },
      ]);
      const forward = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_answer: answerWrapper(),
        x_relations: relations,
        x_vendor_a: 1,
      });
      const reversed = fixtureEntity({
        id: "answer:a",
        type: "answer",
        canonical_url: FIXTURE_URLS.answer,
        x_vendor_a: 1,
        x_relations: relations,
        x_answer: answerWrapper(),
      });
      const entities = { [FIXTURE_URLS.document]: documentEntity() };
      const a = await walk({ ...entities, [FIXTURE_URLS.answer]: forward }, context, { root: forward });
      const b = await walk({ ...entities, [FIXTURE_URLS.answer]: reversed }, context, { root: reversed });
      return JSON.stringify(shapeOf(a.events)) === JSON.stringify(shapeOf(b.events))
        ? PASS
        : fail("Property order changed the event sequence.", [
            shapeOf(a.events).join(" | "),
            shapeOf(b.events).join(" | "),
          ]);
    },
  },
  {
    id: "graph.ordering.deterministic",
    group: "graph.ordering",
    title: "Two runs whose fetches complete in opposite orders emit the same sequence",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const slowFirst = fixtureResolver(entities, { delayByUrl: { [FIXTURE_URLS.claimOne]: 20 } });
      const slowSecond = fixtureResolver(entities, { delayByUrl: { [FIXTURE_URLS.claimTwo]: 20 } });
      const a = await walk(entities, context, { resolve: slowFirst.resolve, requested: slowFirst.requested });
      const b = await walk(entities, context, { resolve: slowSecond.resolve, requested: slowSecond.requested });
      return JSON.stringify(shapeOf(a.events)) === JSON.stringify(shapeOf(b.events))
        ? PASS
        : fail("Completion timing reordered the event stream.", [
            shapeOf(a.events).join(" | "),
            shapeOf(b.events).join(" | "),
          ]);
    },
  },
  {
    id: "graph.ordering.mixed_order_equivalence",
    group: "graph.ordering",
    title: "Reversing the order of references yields the same graph and request count",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const reversedRoot = answerRoot({
        related_entities: [
          { target_type: "claim", target: { id: "claim:c2", url: FIXTURE_URLS.claimTwo } },
          { target_type: "claim", target: { id: "claim:c1", url: FIXTURE_URLS.claimOne } },
        ],
      });
      const forward = await walk(entities, context);
      const reversed = await walk({ ...entities, [FIXTURE_URLS.answer]: reversedRoot }, context, {
        root: reversedRoot,
      });

      const keys = (result: WalkResult) =>
        [...result.events.filter((e) => e.type === "node").map((e) => (e.type === "node" ? e.node.key : ""))].sort();
      if (JSON.stringify(keys(forward)) !== JSON.stringify(keys(reversed))) {
        return fail("Reversing references changed the set of nodes.");
      }
      return forward.summary.requests === reversed.summary.requests
        ? PASS
        : fail(`Request count differed (${forward.summary.requests} vs ${reversed.summary.requests}).`);
    },
  },
];

/* ------------------------------------------------------------------------- *
 * Budget and streaming.
 * ------------------------------------------------------------------------- */

const budgetChecks: GraphTraversalCheck[] = [
  {
    id: "graph.budget.walk_local_expansion",
    group: "graph.budget",
    title: "A second walk on one budget expands fully without new requests",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const fixture = fixtureResolver(entities);
      // Stands in for the budget-scoped canonical cache: an outcome settled by
      // the first walk is replayed, never re-requested.
      const settled = new Map<string, Awaited<ReturnType<TraversalNodeResolver>>>();
      const resolve: TraversalNodeResolver = async (request) => {
        const cached = settled.get(request.url);
        if (cached) return cached;
        const resolution = await fixture.resolve(request);
        settled.set(request.url, resolution);
        return resolution;
      };

      const first = await walk(entities, context, { resolve, requested: fixture.requested });
      const requestsAfterFirst = fixture.requested.length;
      const second = await walk(entities, context, { resolve, requested: fixture.requested });

      if (fixture.requested.length !== requestsAfterFirst) {
        return fail("The second walk re-requested targets the budget had already settled.");
      }
      return JSON.stringify(shapeOf(second.events)) === JSON.stringify(shapeOf(first.events))
        ? PASS
        : fail("The second walk did not expand the same graph — expansion state is not walk-local.");
    },
  },
  {
    id: "graph.budget.no_double_charge",
    group: "graph.budget",
    title: "Fan-in resolves its shared target exactly once",
    level: "error",
    async run(context) {
      const result = await walk(fanInEntities(), context);
      const documentRequests = result.requested.filter((url) => url === FIXTURE_URLS.document);
      return documentRequests.length === 1
        ? PASS
        : fail(`A fan-in target was resolved ${documentRequests.length} times; it must be resolved once.`);
    },
  },
  {
    id: "graph.budget.partial_not_complete",
    group: "graph.budget",
    title: "A budget stop is reported as partial, never as a complete graph",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const fixture = fixtureResolver(entities);
      const resolve: TraversalNodeResolver = async (request) =>
        request.url === FIXTURE_URLS.answer
          ? fixture.resolve(request)
          : { status: "budget-exhausted", message: "budget exhausted" };
      const result = await walk(entities, context, { resolve, requested: fixture.requested });
      return result.summary.stopReason === "budget" && result.summary.partial
        ? PASS
        : fail(
            `A budget stop produced stopReason "${result.summary.stopReason}", partial=${result.summary.partial}.`
          );
    },
  },
  {
    id: "graph.budget.no_request_after_abort",
    group: "graph.budget",
    title: "No request is made after the aborted terminal event",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const fixture = fixtureResolver(entities, { delayByUrl: { [FIXTURE_URLS.claimOne]: 10 } });
      const controller = new AbortController();
      const progress = createTraversalProgress();
      const iterator = streamTraversal(
        walkTraversal(entities[FIXTURE_URLS.answer]!, {
          rootUrl: FIXTURE_URLS.answer,
          lookup: context.lookup,
          resolve: fixture.resolve,
          maxDepth: 3,
          followCollections: false,
          includeGeneratedSummarySources: false,
          progress,
        }),
        { maxBufferedEvents: 256, progress, signal: controller.signal }
      );

      let terminal: GraphTraversalSummaryV1 | undefined;
      for await (const event of iterator) {
        if (event.type === "node") controller.abort();
        if (event.type === "complete") terminal = event.summary;
      }
      if (terminal?.stopReason !== "aborted") return fail("An abort did not produce stopReason \"aborted\".");

      const atTermination = fixture.requested.length;
      await new Promise<void>((done) => setTimeout(done, 30));
      return fixture.requested.length === atTermination
        ? PASS
        : fail(
            `Requests continued after the terminal event (${atTermination} → ${fixture.requested.length}).`,
            fixture.requested.slice(atTermination)
          );
    },
  },
];

const streamingChecks: GraphTraversalCheck[] = [
  {
    id: "graph.streaming.terminal_event",
    group: "graph.streaming",
    title: "Exactly one complete event ends the stream",
    level: "error",
    async run(context) {
      const entities = diamondEntities();
      const fixture = fixtureResolver(entities);
      const progress = createTraversalProgress();
      const iterator = streamTraversal(
        walkTraversal(entities[FIXTURE_URLS.answer]!, {
          rootUrl: FIXTURE_URLS.answer,
          lookup: context.lookup,
          resolve: fixture.resolve,
          maxDepth: 3,
          followCollections: false,
          includeGeneratedSummarySources: false,
          progress,
        }),
        { maxBufferedEvents: 256, progress }
      );

      const events: GraphTraversalEventV1[] = [];
      for await (const event of iterator) events.push(event);
      const completes = events.filter((event) => event.type === "complete");
      if (completes.length !== 1) return fail(`Expected exactly one complete event, saw ${completes.length}.`);
      return events.at(-1) === completes[0]
        ? PASS
        : fail("Events were emitted after the terminal event.");
    },
  },
  {
    id: "graph.streaming.bounded_memory",
    group: "graph.streaming",
    title: "The event buffer stays within maxBufferedEvents",
    level: "warning",
    async run(context) {
      const entities = diamondEntities();
      const fixture = fixtureResolver(entities);
      const progress = createTraversalProgress();
      const capacity = 2;

      let produced = 0;
      const source = walkTraversal(entities[FIXTURE_URLS.answer]!, {
        rootUrl: FIXTURE_URLS.answer,
        lookup: context.lookup,
        resolve: fixture.resolve,
        maxDepth: 3,
        followCollections: false,
        includeGeneratedSummarySources: false,
        progress,
      });
      const counted = (async function* () {
        for (;;) {
          const step = await source.next();
          if (step.done) return step.value;
          produced += 1;
          yield step.value;
        }
      })();

      const iterator = streamTraversal(counted, { maxBufferedEvents: capacity, progress });
      let consumed = 0;
      let overrun = 0;
      for await (const _event of iterator) {
        consumed += 1;
        await new Promise<void>((done) => setTimeout(done, 1));
        // The producer may hold a full buffer plus the event it is offering.
        overrun = Math.max(overrun, produced - consumed);
      }
      return overrun <= capacity + 1
        ? PASS
        : { status: "warning", message: `The producer ran ${overrun} events ahead of a buffer of ${capacity}.` };
    },
  },
];

const compatChecks: GraphTraversalCheck[] = [
  {
    id: "graph.compat.core_only_unchanged",
    group: "graph.compat",
    title: "A consumer with no adapters keeps core-only behavior",
    level: "error",
    async run() {
      const empty = createAdapterLookup({ adapters: [] });
      const plan = planNodeExpansions(
        answerRoot(),
        { depth: 0, nodeKey: "answer:a", followCollections: false, includeGeneratedSummarySources: false },
        empty
      );
      if (plan.edges.length > 0) return fail("A consumer with no registered adapters still produced edges.");
      return plan.expansions.every((expansion) => expansion.outcome === "unsupported-module")
        ? PASS
        : fail("A consumer with no adapters saw an outcome other than unsupported-module.");
    },
  },
];

/**
 * Every check of the profile, in report order. Ordered by group so a reader
 * follows the same path the ADR does: negotiation, traversal, ordering, budget,
 * streaming, compatibility.
 */
export const GRAPH_TRAVERSAL_CHECKS: readonly GraphTraversalCheck[] = [
  ...capabilityChecks,
  ...traversalChecks,
  ...orderingChecks,
  ...budgetChecks,
  ...streamingChecks,
  ...compatChecks,
];

/** The built-in adapter set the profile exercises. */
export function defaultCheckLookup(): TraversalAdapterLookup {
  return createAdapterLookup({ adapters: BUILTIN_TRAVERSAL_ADAPTERS });
}

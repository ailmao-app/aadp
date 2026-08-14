/**
 * The streaming contract: deterministic order independent of completion
 * timing, a bounded buffer, exactly one terminal event, and cancellation
 * (ADR-0011 §9, plan 1.5.0 §"Streaming contract").
 */
import { describe, expect, it } from "vitest";
import { streamTraversal } from "../../../src/traversal/v1.0/scheduler.js";
import {
  createTraversalProgress,
  walkTraversal,
  type TraversalNodeResolver,
} from "../../../src/traversal/v1.0/state-machine.js";
import { createAdapterLookup } from "../../../src/traversal/v1.0/registry.js";
import { BUILTIN_TRAVERSAL_ADAPTERS } from "../../../src/traversal/v1.0/adapters/builtins.js";
import type { EntityV1 } from "../../../src/client/v1.0/index.js";
import type {
  GraphReferenceV1,
  GraphTraversalEventV1,
  GraphTraversalSummaryV1,
} from "../../../src/traversal/v1.0/index.js";
import { answerWrapper, claimWrapper, entityOf, evidenceWrapper } from "./entity-helpers.js";

const lookup = createAdapterLookup({ adapters: BUILTIN_TRAVERSAL_ADAPTERS });

const url = {
  answer: "https://example.com/entities/answer/a.json",
  claim: "https://example.com/entities/claim/c1.json",
  evidence: "https://example.com/entities/evidence/e.json",
};

const root = entityOf({
  id: "answer:a",
  type: "answer",
  canonical_url: url.answer,
  x_answer: answerWrapper({
    related_entities: [
      { target_type: "claim", target: { id: "claim:c1", url: url.claim } },
      { target_type: "evidence", target: { id: "evidence:e", url: url.evidence } },
    ],
  }),
});

const claimC1 = entityOf({
  id: "claim:c1",
  type: "claim",
  canonical_url: url.claim,
  x_evidence: claimWrapper({
    evidence_refs: [{ target_type: "evidence", target: { id: "evidence:e", url: url.evidence }, stance: "support" }],
  }),
});

const evidenceE = entityOf({
  id: "evidence:e",
  type: "evidence",
  canonical_url: url.evidence,
  x_evidence: evidenceWrapper(),
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves from a URL map, taking `delayByUrl[url]` milliseconds to do it. */
function timedResolver(
  entities: Record<string, EntityV1>,
  delayByUrl: Record<string, number> = {}
): TraversalNodeResolver {
  return async (request) => {
    await delay(delayByUrl[request.url] ?? 0);
    const entity = entities[request.url];
    return entity ? { status: "resolved", entity } : { status: "not-found" };
  };
}

function stream(resolve: TraversalNodeResolver, maxBufferedEvents = 256, signal?: AbortSignal) {
  const progress = createTraversalProgress();
  const walk = walkTraversal(root, {
    rootUrl: url.answer,
    lookup,
    resolve,
    maxDepth: 3,
    followCollections: false,
    includeGeneratedSummarySources: false,
    progress,
  });
  return streamTraversal(walk, { maxBufferedEvents, progress, signal });
}

async function drain(iterator: AsyncIterableIterator<GraphTraversalEventV1>): Promise<GraphTraversalEventV1[]> {
  const events: GraphTraversalEventV1[] = [];
  for await (const event of iterator) events.push(event);
  return events;
}

/** A compact, comparable shape of the event sequence. */
const shape = (events: GraphTraversalEventV1[]): string[] =>
  events.map((event) => {
    switch (event.type) {
      case "node":
        return `node:${event.node.key}`;
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

const entities = { [url.claim]: claimC1, [url.evidence]: evidenceE };

describe("deterministic ordering", () => {
  it("produces the same sequence no matter which fetch finishes first", async () => {
    const forward = shape(await drain(stream(timedResolver(entities, { [url.claim]: 0, [url.evidence]: 30 }))));
    const reversed = shape(await drain(stream(timedResolver(entities, { [url.claim]: 30, [url.evidence]: 0 }))));
    expect(reversed).toEqual(forward);
  });

  it("resolves several targets concurrently without reordering the stream", async () => {
    const started: string[] = [];
    const resolve: TraversalNodeResolver = async (request) => {
      started.push(request.url);
      await delay(request.url === url.claim ? 40 : 5);
      const entity = entities[request.url];
      return entity ? { status: "resolved", entity } : { status: "not-found" };
    };

    const events = await drain(stream(resolve));
    // Both root references were started before either settled.
    expect(started.slice(0, 2).sort()).toEqual([url.claim, url.evidence].sort());
    expect(shape(events).filter((s) => s.startsWith("edge:"))).toEqual([
      "edge:answer.related_entity#0:expanded",
      "edge:answer.related_entity#1:expanded",
      "edge:evidence.evidence_ref#0:already-expanded",
    ]);
  });

  it("emits a node before its edges and its expansions after them", async () => {
    const events = shape(await drain(stream(timedResolver(entities))));
    expect(events.slice(0, 6)).toEqual([
      "node:answer:a\0https://example.com/entities/answer/a.json",
      "edge:answer.related_entity#0:expanded",
      "reference:answer.related_entity#0",
      "edge:answer.related_entity#1:expanded",
      "reference:answer.related_entity#1",
      "expansion:x_answer:planned",
    ]);
  });
});

describe("terminal event", () => {
  it("ends with exactly one complete event and nothing after it", async () => {
    const events = await drain(stream(timedResolver(entities)));
    const completes = events.filter((e) => e.type === "complete");
    expect(completes).toHaveLength(1);
    expect(events.at(-1)).toBe(completes[0]);
  });

  it("reports the walk as exhausted and not partial", async () => {
    const events = await drain(stream(timedResolver(entities)));
    const summary = (events.at(-1) as { summary: GraphTraversalSummaryV1 }).summary;
    expect(summary).toMatchObject({ stopReason: "exhausted", partial: false, nodes: 3, edges: 3 });
  });

  it("stays done once completed", async () => {
    const iterator = stream(timedResolver(entities));
    await drain(iterator);
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});

describe("bounded buffer", () => {
  /** A walk stand-in that reports how far ahead of the consumer it ran. */
  function countingWalk(total: number) {
    const state = { produced: 0 };
    async function* generate(): AsyncGenerator<
      GraphTraversalEventV1,
      { summary: GraphTraversalSummaryV1; references: GraphReferenceV1[] }
    > {
      for (let index = 0; index < total; index += 1) {
        state.produced += 1;
        yield { type: "expansion", expansion: { key: `k${index}`, extensionField: "x_test", outcome: "no-edges", plannedEdges: 0 } };
      }
      return {
        references: [],
        summary: { stopReason: "exhausted", partial: false, nodes: 0, edges: total, requests: 0, unsupportedModules: {} },
      };
    }
    return { generate, state };
  }

  it("never runs more than the buffer ahead of a slow consumer", async () => {
    const { generate, state } = countingWalk(20);
    const progress = createTraversalProgress();
    const iterator = streamTraversal(generate(), { maxBufferedEvents: 3, progress });

    let consumed = 0;
    for await (const _event of iterator) {
      consumed += 1;
      await delay(1);
      // Producer may hold a full buffer plus the one event it is offering.
      expect(state.produced - consumed).toBeLessThanOrEqual(4);
      if (consumed === 10) break;
    }
    expect(consumed).toBe(10);
  });

  it("delivers every event despite a capacity of one", async () => {
    const { generate } = countingWalk(7);
    const progress = createTraversalProgress();
    const events = await drain(streamTraversal(generate(), { maxBufferedEvents: 1, progress }));
    expect(events.filter((e) => e.type === "expansion")).toHaveLength(7);
    expect(events.at(-1)!.type).toBe("complete");
  });
});

describe("early return", () => {
  it("emits no complete when the consumer breaks out", async () => {
    const iterator = stream(timedResolver(entities));
    const seen: GraphTraversalEventV1[] = [];
    for await (const event of iterator) {
      seen.push(event);
      if (seen.length === 2) break;
    }
    expect(seen.some((e) => e.type === "complete")).toBe(false);
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("settles return() without waiting for a fetch that is still pending", async () => {
    // The failure this guards: an async generator queues `return()` behind an
    // in-flight `next()`, so a consumer that breaks out would be held for as
    // long as the request takes — potentially forever.
    let releaseFetch: (() => void) | undefined;
    const hanging: TraversalNodeResolver = (request) =>
      request.url === url.claim
        ? new Promise((resolve) => {
            releaseFetch = () => resolve({ status: "resolved", entity: claimC1 });
          })
        : Promise.resolve({ status: "resolved", entity: evidenceE });

    let cancelled = false;
    const progress = createTraversalProgress();
    const walk = walkTraversal(root, {
      rootUrl: url.answer,
      lookup,
      resolve: hanging,
      maxDepth: 3,
      followCollections: false,
      includeGeneratedSummarySources: false,
      progress,
    });
    const iterator = streamTraversal(walk, {
      maxBufferedEvents: 256,
      progress,
      // Stands in for the walk-local abort `traverseGraphV1` wires up: it ends
      // this walk's own waiting without cancelling a shared fetch.
      onCancel: () => {
        cancelled = true;
        releaseFetch?.();
      },
    });

    await iterator.next(); // the root node; the claim fetch is now pending
    const settled = await Promise.race([
      iterator.return!().then(() => "returned" as const),
      delay(200).then(() => "timed out" as const),
    ]);

    expect(settled).toBe("returned");
    expect(cancelled).toBe(true);
  });

  it("runs the walk's cleanup on early return", async () => {
    let cleanedUp = false;
    async function* generate(): AsyncGenerator<
      GraphTraversalEventV1,
      { summary: GraphTraversalSummaryV1; references: GraphReferenceV1[] }
    > {
      try {
        for (let index = 0; index < 50; index += 1) {
          yield { type: "expansion", expansion: { key: `k${index}`, extensionField: "x_test", outcome: "no-edges", plannedEdges: 0 } };
        }
      } finally {
        cleanedUp = true;
      }
      return {
        references: [],
        summary: { stopReason: "exhausted", partial: false, nodes: 0, edges: 0, requests: 0, unsupportedModules: {} },
      };
    }

    const iterator = streamTraversal(generate(), { maxBufferedEvents: 4, progress: createTraversalProgress() });
    await iterator.next();
    await iterator.return!();
    expect(cleanedUp).toBe(true);
  });
});

describe("abort", () => {
  it("completes as aborted when the signal fired before the first pull", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await drain(stream(timedResolver(entities), 256, controller.signal));
    expect(shape(events)).toEqual(["complete:aborted"]);
    expect((events[0] as { summary: GraphTraversalSummaryV1 }).summary.partial).toBe(true);
  });

  it("completes as aborted, exactly once, when the signal fires mid-walk", async () => {
    const controller = new AbortController();
    const iterator = stream(timedResolver(entities, { [url.claim]: 20 }), 256, controller.signal);

    const events: GraphTraversalEventV1[] = [];
    for await (const event of iterator) {
      events.push(event);
      if (events.length === 1) controller.abort();
    }

    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "complete", summary: { stopReason: "aborted", partial: true } });
  });

  it("reports the work already done in an aborted summary", async () => {
    const controller = new AbortController();
    const iterator = stream(timedResolver(entities), 256, controller.signal);
    const events: GraphTraversalEventV1[] = [];
    for await (const event of iterator) {
      events.push(event);
      if (events.length === 3) controller.abort();
    }
    const summary = (events.at(-1) as { summary: GraphTraversalSummaryV1 }).summary;
    expect(summary.stopReason).toBe("aborted");
    expect(summary.nodes).toBeGreaterThan(0);
  });

  it("treats an abort raised by the resolver as a stop reason, not a failure", async () => {
    const resolve: TraversalNodeResolver = async () => {
      const err = new Error("aborted");
      err.name = "AbortedError";
      throw err;
    };
    const events = await drain(stream(resolve));
    expect(events.at(-1)).toMatchObject({ type: "complete", summary: { stopReason: "aborted", partial: true } });
  });
});

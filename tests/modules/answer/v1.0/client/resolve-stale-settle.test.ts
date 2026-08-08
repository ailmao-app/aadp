import { describe, expect, it, vi } from "vitest";
import { createRelationsTraversalBudget } from "../../../../../src/modules/relations/v1.0/client/budget.js";
import { AadpDiscoveryBudgetExceededError, createPermissiveUrlPolicy } from "../../../../../src/client/v1.0/index.js";
import type { AnswerDocumentV1 } from "../../../../../src/modules/answer/v1.0/types.js";
import { checksumOf } from "../../../../../src/canonical-json/checksum.js";
import { buildXAnswer } from "./server-helpers.js";

/**
 * Focused regression for the stale-settlement bug (code review
 * `.claude/review/review-20260808-140858.md` [P1], 2026-08-08): an
 * ABANDONED canonical-target attempt — one whose last waiter left, so it
 * was synchronously evicted from `pending`, released and aborted — could
 * still commit `outcomes`/`globalStops` when it settled afterwards,
 * because the creation-time settle handler guarded only its
 * `pending.delete` and not the two permanent mutations. A later call then
 * read that stale attempt's response (or its budget stop) instead of the
 * replacement attempt's.
 *
 * Reproducing this end-to-end is not possible against real sockets:
 * abandonment aborts the underlying request, so in every orderings a real
 * fetch can reach, the abandoned promise REJECTS with `AbortedError`
 * rather than settling with the outcome that would be wrongly committed.
 * The window that does exist is a microtask-level one inside the transport
 * (an abort landing after its own last cancellation check leaves a purely
 * synchronous tail, so the promise still resolves successfully) and cannot
 * be forced from the outside. Mocking `resolveRelationTarget` with an
 * explicitly controlled deferred exercises `resolveAnswerTargets`' own
 * settle bookkeeping directly and deterministically — this is a unit test
 * of that bookkeeping, not of the transport.
 */
vi.mock("../../../../../src/modules/relations/v1.0/client/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../../../src/modules/relations/v1.0/client/index.js")>();
  return { ...actual, resolveRelationTarget: vi.fn() };
});

const { resolveRelationTarget } = await import("../../../../../src/modules/relations/v1.0/client/index.js");
const { resolveAnswerTargets } = await import("../../../../../src/modules/answer/v1.0/client/resolve.js");

const PERMISSIVE = { urlPolicy: createPermissiveUrlPolicy() };

const TARGET = { target_type: "x", target: { id: "x:stale", url: "https://example.test/entities/x/stale.json" } };

function answerWithTarget(): AnswerDocumentV1 {
  return buildXAnswer({ related_entities: [TARGET] }) as unknown as AnswerDocumentV1;
}

/** Distinguishable only by `updated_at`, so a test can tell which attempt's response was committed. */
function entityUpdatedAt(updatedAt: string) {
  return { aadp_version: "1.0", id: "x:stale", type: "x", checksum: checksumOf({}), updated_at: updatedAt, data: {} };
}

const ABANDONED_AT = "2020-01-01T00:00:00Z";
const REPLACEMENT_AT = "2026-08-08T00:00:00Z";

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * Replaces `resolveRelationTarget` with a deferred whose settlement this
 * test drives by hand, and returns them in call order.
 */
function armDeferredResolver(): Deferred[] {
  const deferreds: Deferred[] = [];
  vi.mocked(resolveRelationTarget).mockReset();
  vi.mocked(resolveRelationTarget).mockImplementation((() => {
    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    deferreds.push({ promise, resolve, reject });
    return promise;
  }) as unknown as typeof resolveRelationTarget);
  return deferreds;
}

/**
 * Starts a call, abandons it (sole waiter aborts while its attempt is
 * still in flight), then starts and settles a replacement attempt — the
 * shared setup both cases below build on. Returns the still-unsettled
 * abandoned deferred.
 */
async function abandonThenReplace(budget: ReturnType<typeof createRelationsTraversalBudget>, deferreds: Deferred[]) {
  const controller = new AbortController();
  // `resolveAnswerTargets` runs synchronously up to its first `await`, so
  // by the time this returns the attempt is registered and being waited on.
  const abandonedCall = resolveAnswerTargets(answerWithTarget(), { ...PERMISSIVE, budget, signal: controller.signal });
  controller.abort();
  const abandonedResult = await abandonedCall;
  expect(abandonedResult.partial).toBe(true);
  expect(abandonedResult.items[0].status).toBe("budget-exhausted");
  expect(deferreds).toHaveLength(1);

  // Replacement attempt for the same canonical target, settling normally.
  const replacementCall = resolveAnswerTargets(answerWithTarget(), { ...PERMISSIVE, budget });
  expect(deferreds).toHaveLength(2);
  deferreds[1].resolve({ status: "resolved", target: { hint: TARGET.target, entity: entityUpdatedAt(REPLACEMENT_AT) } });
  const replacementResult = await replacementCall;
  expect(replacementResult.items[0].status).toBe("resolved");
  expect(replacementResult.items[0].entity?.updated_at).toBe(REPLACEMENT_AT);

  return deferreds[0];
}

describe("resolveAnswerTargets — an abandoned attempt never commits shared state", () => {
  it("discards an abandoned attempt's late SUCCESS instead of caching it over the replacement attempt's result", async () => {
    const deferreds = armDeferredResolver();
    const budget = createRelationsTraversalBudget();
    const abandoned = await abandonThenReplace(budget, deferreds);

    // The abandoned attempt settles successfully only now — after its
    // replacement already committed the real result. Committing this would
    // cache a response whose caller gave up on it long ago.
    abandoned.resolve({ status: "resolved", target: { hint: TARGET.target, entity: entityUpdatedAt(ABANDONED_AT) } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const laterResult = await resolveAnswerTargets(answerWithTarget(), { ...PERMISSIVE, budget });
    expect(laterResult.partial).toBe(false);
    expect(laterResult.items[0].status).toBe("resolved");
    expect(laterResult.items[0].entity?.updated_at).toBe(REPLACEMENT_AT);
  });

  it("discards an abandoned attempt's late BUDGET-EXCEEDED rejection instead of recording it as a budget-wide stop", async () => {
    const deferreds = armDeferredResolver();
    const budget = createRelationsTraversalBudget();
    const abandoned = await abandonThenReplace(budget, deferreds);

    // Same shape, but the abandoned attempt fails a budget dimension as it
    // unwinds. Recording that would strand this target on `budget-exhausted`
    // for every later call, even though the replacement attempt already
    // resolved it and every budget dimension is monotonic (a genuinely
    // exhausted budget re-trips on the next attempt by itself).
    abandoned.reject(new AadpDiscoveryBudgetExceededError("stale attempt exceeded maxNodes"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const laterResult = await resolveAnswerTargets(answerWithTarget(), { ...PERMISSIVE, budget });
    expect(laterResult.partial).toBe(false);
    expect(laterResult.items[0].status).toBe("resolved");
    expect(laterResult.items[0].entity?.updated_at).toBe(REPLACEMENT_AT);
  });
});

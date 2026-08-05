import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../../src/client/scheduler.js";

/**
 * `mapConcurrent` in isolation (ADR-0006 work package 3) — no HTTP, no
 * budget, just the scheduling contract: bounded in-flight count, output in
 * source order regardless of completion order, and a bounded blast radius
 * on error. `tests/client/v1.0.test.ts` covers it wired into
 * `discoverAllEntities`.
 */

async function* source<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("mapConcurrent — invalid options", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws RangeError for concurrency %s",
    async (concurrency) => {
      const gen = mapConcurrent(source([1]), async (x) => x, { concurrency: concurrency as number });
      await expect(gen.next()).rejects.toThrow(RangeError);
    }
  );
});

describe("mapConcurrent — concurrency 1 (default)", () => {
  it("processes strictly one at a time: no task starts before the previous result is yielded", async () => {
    const inFlight: number[] = [];
    const maxInFlight: number[] = [];
    const order: number[] = [];

    const results: number[] = [];
    for await (const value of mapConcurrent(source([1, 2, 3]), async (item) => {
      inFlight.push(item);
      maxInFlight.push(inFlight.length);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(item);
      inFlight.splice(inFlight.indexOf(item), 1);
      return item * 10;
    })) {
      results.push(value);
    }

    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]);
    expect(Math.max(...maxInFlight)).toBe(1);
  });

  it("defaults to concurrency 1 when options is omitted entirely", async () => {
    const results: number[] = [];
    for await (const value of mapConcurrent(source([1, 2]), async (item) => item)) {
      results.push(value);
    }
    expect(results).toEqual([1, 2]);
  });
});

describe("mapConcurrent — concurrency > 1", () => {
  it("never runs more than `concurrency` mappers at once", async () => {
    let current = 0;
    let max = 0;
    const items = [1, 2, 3, 4, 5, 6];

    const results: number[] = [];
    for await (const value of mapConcurrent(
      source(items),
      async (item) => {
        current++;
        max = Math.max(max, current);
        await new Promise((resolve) => setTimeout(resolve, 5));
        current--;
        return item;
      },
      { concurrency: 3 }
    )) {
      results.push(value);
    }

    expect(results).toEqual(items);
    expect(max).toBeLessThanOrEqual(3);
  });

  it("yields in source order even when a later item resolves before an earlier one", async () => {
    // item 1 is slow, item 2 and 3 are fast — output must still be 1, 2, 3.
    const delays: Record<number, number> = { 1: 30, 2: 5, 3: 5 };
    const results: number[] = [];
    for await (const value of mapConcurrent(
      source([1, 2, 3]),
      async (item) => {
        await new Promise((resolve) => setTimeout(resolve, delays[item]));
        return item;
      },
      { concurrency: 3 }
    )) {
      results.push(value);
    }
    expect(results).toEqual([1, 2, 3]);
  });

  it("keeps the window full: item 4 starts as soon as item 1 (not item 2 or 3) finishes", async () => {
    const started: number[] = [];
    const items = [1, 2, 3, 4];

    const results: number[] = [];
    for await (const value of mapConcurrent(
      source(items),
      async (item) => {
        started.push(item);
        // 1 resolves fast; 2 and 3 are slow, so 4 can only have started
        // because 1 freed a window slot, not because 2/3 did.
        await new Promise((resolve) => setTimeout(resolve, item === 1 ? 5 : 40));
        return item;
      },
      { concurrency: 3 }
    )) {
      results.push(value);
    }

    expect(started).toEqual([1, 2, 3, 4]);
    expect(results).toEqual(items);
  });
});

describe("mapConcurrent — error propagation", () => {
  it("throws the rejection once the generator reaches that item's position", async () => {
    const failure = new Error("item 2 failed");
    const seen: number[] = [];

    await expect(async () => {
      for await (const value of mapConcurrent(
        source([1, 2, 3]),
        async (item) => {
          if (item === 2) throw failure;
          return item;
        },
        { concurrency: 3 }
      )) {
        seen.push(value);
      }
    }).rejects.toThrow(failure);

    // Item 1 (before the failure) was still yielded; item 3 (after) never was.
    expect(seen).toEqual([1]);
  });

  it("stops pulling new items from the source once any in-flight call rejects", async () => {
    const pulled: number[] = [];
    async function* countingSource(items: number[]): AsyncGenerator<number> {
      for (const item of items) {
        pulled.push(item);
        yield item;
      }
    }

    const failure = new Error("item 1 failed fast");
    await expect(async () => {
      for await (const _ of mapConcurrent(
        countingSource([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        async (item) => {
          if (item === 1) throw failure; // fails immediately
          await new Promise((resolve) => setTimeout(resolve, 20)); // everything else is slow
          return item;
        },
        { concurrency: 2 }
      )) {
        // no-op
      }
    }).rejects.toThrow(failure);

    // Window size 2: item 1 (fails) and item 2 (started alongside it) at
    // most — nothing past the initial window should ever have been pulled.
    expect(pulled.length).toBeLessThanOrEqual(2);
  });
});

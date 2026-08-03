/**
 * Bounded-concurrency traversal scheduler (ADR-0006). Pure module: no HTTP,
 * no budget, no retry — those compose around `mapConcurrent`, which only
 * knows how to run an async mapper over an async source with at most
 * `concurrency` calls in flight, yielding results in the *same order as the
 * source*, regardless of which call actually finishes first.
 */

export interface SchedulerOptions {
  /**
   * Maximum mapper calls in flight at once. Default `1` — no task starts
   * before the previous one's result has been yielded, i.e. exactly the
   * serial ordering/timing every release before 1.1.0 always produced.
   * `concurrency: 1` takes a dedicated fast path with no scheduling
   * bookkeeping at all, so it is not just numerically equivalent to the
   * old behavior but the same code path in spirit.
   */
  concurrency?: number;
}

/**
 * Runs `mapper` over `source` with at most `options.concurrency` calls in
 * flight, yielding each result in `source`'s own order once it's that
 * result's turn — a slow item never lets a faster later item overtake it
 * in the output.
 *
 * Error handling: once any in-flight call rejects, no further item is
 * pulled from `source` (the in-flight window stops growing), bounding how
 * many more requests a failure can trigger. Items already in flight before
 * that point are still awaited and, if they succeed, still yielded in
 * order — the rejection itself surfaces only once the generator reaches
 * that item's position, at which point it throws. This keeps the "yield in
 * source order" guarantee simple (no attempt to reorder around a failure)
 * while still capping the blast radius of a failing traversal to at most
 * one window's worth of extra in-flight requests.
 *
 * `mapper`'s own promise is never left to reject "in the open": every
 * settlement (success or failure) is captured into an internal result slot
 * before this function's control flow ever awaits it a second time, so no
 * `mapper` call can produce an unhandled rejection warning regardless of
 * how many other items are ahead of it in the yield order.
 */
export async function* mapConcurrent<T, R>(
  source: AsyncIterable<T>,
  mapper: (item: T, index: number) => Promise<R>,
  options: SchedulerOptions = {}
): AsyncGenerator<R> {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }

  if (concurrency === 1) {
    let index = 0;
    for await (const item of source) {
      yield await mapper(item, index++);
    }
    return;
  }

  const iterator = source[Symbol.asyncIterator]();
  let nextIndex = 0;
  let inputDone = false;
  let sawError = false;

  type Settled<R> = { ok: true; value: R } | { ok: false; err: unknown };
  const results = new Map<number, Settled<R>>();
  // index -> a promise that itself never rejects; the real outcome lands in
  // `results` instead, so a slot nobody has awaited yet can never become an
  // unhandled rejection.
  const inFlight = new Map<number, Promise<void>>();

  async function startNext(): Promise<boolean> {
    if (inputDone || sawError) return false;
    const { value, done } = await iterator.next();
    if (done) {
      inputDone = true;
      return false;
    }
    const index = nextIndex++;
    const settled = mapper(value, index).then(
      (value) => {
        results.set(index, { ok: true, value });
      },
      (err: unknown) => {
        results.set(index, { ok: false, err });
        sawError = true;
      }
    );
    inFlight.set(index, settled);
    return true;
  }

  async function fillWindow(): Promise<void> {
    while (inFlight.size < concurrency) {
      if (!(await startNext())) break;
    }
  }

  await fillWindow();

  let yieldIndex = 0;
  while (inFlight.size > 0) {
    const pending = inFlight.get(yieldIndex);
    if (pending === undefined) {
      // Every index from 0 up to `nextIndex - 1` is started contiguously
      // (`startNext` only ever assigns the next sequential index), so the
      // next index this generator wants to yield is always either still in
      // `inFlight` or already consumed — never skipped.
      throw new Error(`mapConcurrent: internal scheduler error, index ${yieldIndex} was not in flight`);
    }
    await pending;
    inFlight.delete(yieldIndex);
    const settled = results.get(yieldIndex)!;
    results.delete(yieldIndex);
    yieldIndex++;
    if (!settled.ok) throw settled.err;
    await fillWindow();
    yield settled.value;
  }
}

/**
 * Streaming boundary: turns the ordered walk into an `AsyncIterableIterator`
 * with a bounded buffer, one terminal event and correct cancellation
 * (ADR-0011 §9, plan 1.5.0 §"Streaming contract").
 *
 * The walk decides ORDER; this file decides FLOW. It never reorders an event,
 * so what a consumer sees is a function of the input alone, not of which fetch
 * happened to finish first.
 */
import {
  summaryFrom,
  type TraversalProgress,
} from "./state-machine.js";
import type { GraphReferenceV1, GraphTraversalEventV1, GraphTraversalSummaryV1 } from "./types.js";

export interface StreamTraversalOptions {
  /** Buffer capacity, NOT a total event limit. Default applied by the caller. */
  maxBufferedEvents: number;
  progress: TraversalProgress;
  signal?: AbortSignal;
  /**
   * Cancels THIS walk's own waiting, called before the generator's cleanup is
   * awaited on an early consumer return.
   *
   * Without it, `return()` would queue behind a `next()` already awaiting a
   * fetch and could not settle until the network did — a consumer that `break`s
   * out of a `for await` would be held for however long that request takes. The
   * caller wires this to a walk-local abort that reaches only this walk's
   * waiters: a fetch shared with another walk is never cancelled by it.
   */
  onCancel?: () => void;
}

/** An abort raised by the caller's signal, as opposed to a failure of the walk. */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "AbortedError";
}

/**
 * Wraps `walk` in the streaming contract:
 *
 * - **Bounded buffer.** At most `maxBufferedEvents` events are held at once; a
 *   slow consumer slows the walk instead of letting the whole graph pile up.
 *   There is deliberately no total-event limit, so `stopReason` has no
 *   `max-events` value: memory is bounded by this buffer and total work by the
 *   budget, and a third limit would only add another partial-stop path to
 *   account for.
 * - **Exactly one `complete`.** Emitted always — exhausted, aborted or
 *   budget-stopped alike — because a consumer tells "walked everything" from
 *   "stopped early" by `summary.stopReason`/`partial`, not by the iterator
 *   ending.
 * - **Early return emits nothing.** A consumer that `break`s has abandoned the
 *   walk, so there is no result to declare; cleanup still runs.
 */
export function streamTraversal(
  walk: AsyncGenerator<GraphTraversalEventV1, { summary: GraphTraversalSummaryV1; references: GraphReferenceV1[] }>,
  options: StreamTraversalOptions
): AsyncIterableIterator<GraphTraversalEventV1> {
  const capacity = Math.max(1, options.maxBufferedEvents);
  const buffer: GraphTraversalEventV1[] = [];

  let finished = false;
  let completed = false;
  let cancelled = false;
  let failure: unknown;
  let terminal: GraphTraversalSummaryV1 | undefined;

  let notifyConsumer: (() => void) | undefined;
  let notifyProducer: (() => void) | undefined;

  const wakeConsumer = (): void => {
    notifyConsumer?.();
    notifyConsumer = undefined;
  };
  const wakeProducer = (): void => {
    notifyProducer?.();
    notifyProducer = undefined;
  };

  const abort = (): void => {
    if (finished) return;
    terminal = summaryFrom(options.progress, "aborted");
    finished = true;
    wakeProducer();
    wakeConsumer();
  };
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });

  const produce = async (): Promise<void> => {
    try {
      let step = await walk.next();
      while (!step.done) {
        if (finished || cancelled) return;
        buffer.push(step.value);
        wakeConsumer();
        // Backpressure: stop taking completions while the consumer is behind.
        while (buffer.length >= capacity && !finished && !cancelled) {
          await new Promise<void>((resolve) => {
            notifyProducer = resolve;
          });
        }
        if (finished || cancelled) return;
        step = await walk.next();
      }
      terminal = step.value.summary;
    } catch (err) {
      // A caller's abort is a stop reason, not a failure of the walk.
      if (isAbortError(err)) terminal = summaryFrom(options.progress, "aborted");
      else failure = err;
    } finally {
      finished = true;
      wakeConsumer();
    }
  };

  const producing = produce();
  producing.catch(() => undefined);

  const iterator: AsyncIterableIterator<GraphTraversalEventV1> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },

    async next(): Promise<IteratorResult<GraphTraversalEventV1>> {
      for (;;) {
        if (buffer.length > 0) {
          const value = buffer.shift()!;
          wakeProducer();
          return { value, done: false };
        }
        if (failure) {
          const err = failure;
          failure = undefined;
          throw err;
        }
        if (finished) {
          if (completed) return { value: undefined, done: true };
          completed = true;
          return {
            value: { type: "complete", summary: terminal ?? summaryFrom(options.progress, "aborted") },
            done: false,
          };
        }
        await new Promise<void>((resolve) => {
          notifyConsumer = resolve;
        });
      }
    },

    /**
     * The consumer gave up. Cancel this walk's own waiting and let the
     * generator run its cleanup — but emit no `complete`: there is no outcome
     * to declare for a walk nobody is reading.
     */
    async return(): Promise<IteratorResult<GraphTraversalEventV1>> {
      cancelled = true;
      completed = true;
      // Cancel this walk's own waiting FIRST. An async generator queues a
      // `return()` behind a `next()` that is already in flight, so without this
      // the await below would last as long as the pending fetch does.
      options.onCancel?.();
      wakeProducer();
      wakeConsumer();
      await walk.return(undefined as never).catch(() => undefined);
      await producing.catch(() => undefined);
      buffer.length = 0;
      return { value: undefined, done: true };
    },

    async throw(err: unknown): Promise<IteratorResult<GraphTraversalEventV1>> {
      await iterator.return!();
      throw err;
    },
  };

  return iterator;
}

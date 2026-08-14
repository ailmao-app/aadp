/**
 * Opt-in registration of the three in-package adapters.
 *
 * Importing the traversal module registers NOTHING: a core-only or
 * single-module consumer must be able to depend on this package without the
 * cross-module adapters appearing in any registry. The consumer either calls
 * `registerBuiltinTraversalAdapters()` or passes `options.adapters` explicitly.
 */
import { registerTraversalAdapter } from "../registry.js";
import type { TraversalAdapter } from "../types.js";
import { relationsTraversalAdapter } from "./relations.js";
import { answerTraversalAdapter } from "./answer.js";
import { evidenceTraversalAdapter } from "./evidence.js";

/** The three adapters this package ships, in edge-group rank order. */
export const BUILTIN_TRAVERSAL_ADAPTERS: readonly TraversalAdapter[] = [
  relationsTraversalAdapter as TraversalAdapter,
  answerTraversalAdapter as TraversalAdapter,
  evidenceTraversalAdapter as TraversalAdapter,
];

/**
 * Registers the built-in adapters into the global traversal registry.
 *
 * Idempotent: every call registers the same adapter references, and
 * re-registering an identical reference is a no-op, so calling it from several
 * independent consumers in one process is safe.
 */
export function registerBuiltinTraversalAdapters(): void {
  for (const adapter of BUILTIN_TRAVERSAL_ADAPTERS) {
    registerTraversalAdapter(adapter);
  }
}

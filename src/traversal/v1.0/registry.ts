/**
 * Traversal adapter registry (ADR-0011 §5, plan 1.5.0 §"Registry boundary").
 *
 * This is a SECOND, independent registry — `src/module-registry` stays exactly
 * as released. That one answers "is this document valid"; this one answers
 * "which adapter, if any, may plan edges out of this extension field". This
 * file therefore MUST NOT import `../../module-registry/**`: the dependency
 * direction is traversal → module clients → module registry, never back.
 *
 * Lookup is exact-match on `{moduleId, moduleVersion, extensionField}` — no
 * ranges and no fallback to another version, mirroring the rule already
 * released for the module registry (ADR-0007) and the Evidence client.
 */
import type { TraversalAdapter, TraversalAdapterKey } from "./types.js";

/** Resolves one adapter key to an adapter, or to `undefined` for "not supported here". */
export type TraversalAdapterLookup = (key: TraversalAdapterKey) => TraversalAdapter | undefined;

/** One allowlist entry of `GraphTraversalOptions.capabilities`. */
export interface TraversalCapability {
  moduleId: string;
  version: string;
}

// moduleId -> moduleVersion -> extensionField -> adapter. Nested maps rather
// than one flat joined key so no separator can ever be smuggled in through a
// module id or an extension field and collide two distinct keys.
const registry = new Map<string, Map<string, Map<string, TraversalAdapter>>>();

function findIn(
  source: Map<string, Map<string, Map<string, TraversalAdapter>>>,
  key: TraversalAdapterKey
): TraversalAdapter | undefined {
  return source.get(key.moduleId)?.get(key.moduleVersion)?.get(key.extensionField);
}

/**
 * Registers one adapter under its own exact key.
 *
 * Registering a DIFFERENT adapter under a key already taken throws; registering
 * the identical adapter reference again is a no-op. Silent overwrite is
 * forbidden because it would make a walk's result depend on module import
 * order — the same graph would expand differently depending on which adapter
 * happened to be imported last.
 */
export function registerTraversalAdapter(adapter: TraversalAdapter): void {
  const { key } = adapter;
  const existing = findIn(registry, key);
  if (existing) {
    if (existing === adapter) return;
    throw new Error(
      `Traversal adapter for "${key.moduleId}@${key.moduleVersion}" field "${key.extensionField}" is already registered with a different adapter; registered traversal adapters are immutable.`
    );
  }
  const byVersion = registry.get(key.moduleId) ?? new Map<string, Map<string, TraversalAdapter>>();
  const byField = byVersion.get(key.moduleVersion) ?? new Map<string, TraversalAdapter>();
  byField.set(key.extensionField, adapter);
  byVersion.set(key.moduleVersion, byField);
  registry.set(key.moduleId, byVersion);
}

/** Exact-match lookup in the global registry. A miss is `undefined`, never a throw. */
export function getTraversalAdapter(key: TraversalAdapterKey): TraversalAdapter | undefined {
  return findIn(registry, key);
}

/** Every globally registered adapter, in registration order. Introspection only. */
export function listTraversalAdapters(): readonly TraversalAdapter[] {
  const adapters: TraversalAdapter[] = [];
  for (const byVersion of registry.values()) {
    for (const byField of byVersion.values()) {
      for (const adapter of byField.values()) adapters.push(adapter);
    }
  }
  return adapters;
}

function isAllowed(key: TraversalAdapterKey, capabilities: readonly TraversalCapability[]): boolean {
  return capabilities.some((c) => c.moduleId === key.moduleId && c.version === key.moduleVersion);
}

/**
 * Builds the adapter lookup for ONE walk.
 *
 * `adapters` REPLACES the global registry for that call — it is never merged
 * with it — so a caller can run a walk against exactly the adapter set it names,
 * independent of whatever global state other imports have produced. `undefined`
 * (the common case) uses the global registry.
 *
 * `capabilities`, when present, is an allowlist of `{moduleId, version}` matched
 * exactly: an adapter outside it is treated as if it were never registered, so
 * the caller gets the same `unsupported-module` expansion outcome as for a
 * module nobody implements. That is the whole point — narrowing the surface must
 * not be a different failure mode from not supporting it.
 */
export function createAdapterLookup(options?: {
  adapters?: readonly TraversalAdapter[];
  capabilities?: readonly TraversalCapability[];
}): TraversalAdapterLookup {
  const { adapters, capabilities } = options ?? {};
  let find: TraversalAdapterLookup;
  if (adapters) {
    const perCall = new Map<string, Map<string, Map<string, TraversalAdapter>>>();
    for (const adapter of adapters) {
      const { key } = adapter;
      const byVersion = perCall.get(key.moduleId) ?? new Map<string, Map<string, TraversalAdapter>>();
      const byField = byVersion.get(key.moduleVersion) ?? new Map<string, TraversalAdapter>();
      const existing = byField.get(key.extensionField);
      if (existing && existing !== adapter) {
        throw new Error(
          `options.adapters contains two different adapters for "${key.moduleId}@${key.moduleVersion}" field "${key.extensionField}"; the winner would depend on array order.`
        );
      }
      byField.set(key.extensionField, adapter);
      byVersion.set(key.moduleVersion, byField);
      perCall.set(key.moduleId, byVersion);
    }
    find = (key) => findIn(perCall, key);
  } else {
    find = (key) => findIn(registry, key);
  }
  if (!capabilities) return find;
  return (key) => (isAllowed(key, capabilities) ? find(key) : undefined);
}

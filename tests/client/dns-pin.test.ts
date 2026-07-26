import { describe, expect, it } from "vitest";
import { dispatcherFor } from "../../src/client/dns-pin.js";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../../src/client/url-policy.js";

/**
 * Regression coverage for the 2026-07-26 re-review finding: the default
 * strict policy used to be recreated on every `fetchJson()` call that
 * didn't supply `urlPolicy`, so `dispatcherFor`'s WeakMap cache (keyed on
 * policy identity) never actually got a cache hit on that path — every
 * request minted a fresh, never-closed `undici.Agent`/connection pool.
 * `../../src/client/http.ts` now reuses one module-level policy singleton
 * for the default path specifically so this cache works.
 */

describe("dispatcherFor — reuse across calls for the same policy instance", () => {
  it("returns the same dispatcher for repeated calls with one strict policy instance", () => {
    const policy = createStrictUrlPolicy();
    const first = dispatcherFor(policy);
    const second = dispatcherFor(policy);
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it("returns distinct dispatchers for two different strict policy instances", () => {
    const first = dispatcherFor(createStrictUrlPolicy());
    const second = dispatcherFor(createStrictUrlPolicy());
    expect(first).not.toBe(second);
  });

  it("returns undefined for a policy without checkResolvedAddress (e.g. permissive)", () => {
    expect(dispatcherFor(createPermissiveUrlPolicy())).toBeUndefined();
  });
});

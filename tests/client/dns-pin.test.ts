import { describe, expect, it, vi } from "vitest";
import { dispatcherFor } from "../../src/client/dns-pin.js";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../../src/client/url-policy.js";
import { BlockedUrlError } from "../../src/client/url-policy.js";
import { fetchJson } from "../../src/client/http.js";

/**
 * `node:dns`'s real `lookup` is mocked module-wide for this one describe
 * block, so it must resolve every hostname a *different* test in this file
 * needs — vitest resets mocks between tests but the module mock itself
 * stays installed for the whole file.
 */
vi.mock("node:dns", () => ({
  lookup: (
    hostname: string,
    _options: unknown,
    callback: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void
  ) => {
    // Simulates DNS rebinding: a hostname that looks public in the URL
    // string (so `UrlPolicy.check()`'s string-level check passes) actually
    // resolves to loopback by the time the connection is opened.
    if (hostname === "rebinds-to-loopback.example.com") {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
      return;
    }
    callback(new Error(`no mock DNS entry for "${hostname}"`), "");
  },
}));

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

describe("dispatcherFor — end-to-end DNS-rebinding regression", () => {
  it("blocks a request whose hostname resolves to loopback at connect time, even though the URL string itself looks public", async () => {
    // `UrlPolicy.check()` only inspects "rebinds-to-loopback.example.com" as
    // written — nothing about that string is private. The block must come
    // from `pinnedLookup`'s own DNS resolution, not the string-level check.
    await expect(
      fetchJson("https://rebinds-to-loopback.example.com/manifest.json", {
        urlPolicy: createStrictUrlPolicy(),
      })
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

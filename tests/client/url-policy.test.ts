import { describe, expect, it } from "vitest";
import { createStrictUrlPolicy } from "../../src/client/url-policy.js";

/**
 * Regression coverage for the strict `UrlPolicy`'s IPv6 handling
 * (2026-07-26 security review finding: Node's WHATWG URL parser keeps the
 * brackets in `.hostname` for an IPv6 literal, so a bracket-naive
 * comparison against unbracketed range prefixes silently let loopback/
 * ULA/link-local literals through) and its `checkResolvedAddress` gate
 * (the resolve-and-pin hook `../../src/client/dns-pin.ts` uses).
 */

describe("createStrictUrlPolicy — IPv6 literals", () => {
  const policy = createStrictUrlPolicy();

  it.each([
    ["http://[::1]/", "loopback"],
    ["http://[fc00::1]/", "ULA"],
    ["http://[fd00::1]/", "ULA"],
    ["http://[fe80::1]/", "link-local"],
  ])("blocks %s (%s)", (url) => {
    expect(policy.check(new URL(url))).toBeDefined();
  });

  it("allows a public IPv6 literal", () => {
    // 2001:4860:4860::8888 — a real public (Google DNS) IPv6 address, used
    // only as a fixed, well-known public-range example.
    expect(policy.check(new URL("http://[2001:4860:4860::8888]/"))).toBeUndefined();
  });
});

describe("createStrictUrlPolicy — IPv4-mapped IPv6, hex or dotted-decimal", () => {
  const policy = createStrictUrlPolicy();

  it.each([
    ["http://[::ffff:7f00:1]/", "127.0.0.1 loopback, hex form"],
    ["http://[::ffff:127.0.0.1]/", "127.0.0.1 loopback, dotted-decimal form"],
    ["http://[::ffff:a00:1]/", "10.0.0.1 private, hex form"],
    ["http://[::ffff:c0a8:101]/", "192.168.1.1 private, hex form"],
    ["http://[0:0:0:0:0:ffff:7f00:1]/", "127.0.0.1 loopback, fully-expanded form"],
  ])("blocks %s (%s)", (url) => {
    expect(policy.check(new URL(url))).toBeDefined();
  });

  it("allows an IPv4-mapped public address", () => {
    // ::ffff:8.8.8.8 — Google DNS, a fixed well-known public IPv4 address.
    expect(policy.check(new URL("http://[::ffff:808:808]/"))).toBeUndefined();
  });
});

describe("createStrictUrlPolicy — allow-only-global-unicast IPv6 (not a prefix blocklist)", () => {
  const policy = createStrictUrlPolicy();

  it.each([
    ["http://[fec0::1]/", "deprecated site-local fec0::/10"],
    ["http://[ff02::1]/", "multicast ff00::/8"],
    ["http://[100::1]/", "discard-only 100::/64"],
    ["http://[64:ff9b::808:808]/", "well-known NAT64 prefix 64:ff9b::/96"],
    ["http://[2001:db8::1]/", "documentation 2001:db8::/32 (carved out of 2000::/3)"],
    ["http://[2001:2::1]/", "benchmarking 2001:2::/48 (carved out of 2000::/3)"],
    ["http://[2001:10::1]/", "ORCHID 2001:10::/28 (carved out of 2000::/3)"],
    ["http://[3fff::1]/", "documentation 3fff::/20 (RFC 9637)"],
  ])("blocks %s (%s)", (url) => {
    expect(policy.check(new URL(url))).toBeDefined();
  });

  it("still allows a real global-unicast address outside any carve-out", () => {
    expect(policy.check(new URL("http://[2001:4860:4860::8888]/"))).toBeUndefined();
  });

  it("fails closed (blocks) an unparseable IPv6-looking resolved address", () => {
    // checkResolvedAddress receives raw strings straight from DNS, not
    // WHATWG-URL-validated hostnames — it must not assume they're
    // well-formed.
    expect(policy.checkResolvedAddress?.("garbage", 6)).toBeDefined();
  });
});

describe("createStrictUrlPolicy — special-purpose ranges INSIDE 2000::/3", () => {
  const policy = createStrictUrlPolicy();

  it.each([
    ["2001:100::1", "IETF Protocol Assignments 2001::/23, unallocated"],
    ["2001::1", "Teredo 2001::/32 (inside 2001::/23)"],
    ["2002:7f00:1::", "6to4 embedding 127.0.0.1"],
    ["2002:a00:1::", "6to4 embedding 10.0.0.1"],
    ["2002:c0a8:101::", "6to4 embedding 192.168.1.1"],
  ])("blocks %s (%s) in both check() and checkResolvedAddress()", (addr) => {
    // Parity: the URL-literal gate and the DNS-resolved gate must agree —
    // an address a document can't name directly must not slip through via
    // a hostname that resolves to it.
    expect(policy.check(new URL(`http://[${addr}]/`))).toBeDefined();
    expect(policy.checkResolvedAddress?.(addr, 6)).toBeDefined();
  });

  it("allows a 6to4 form of a public IPv4 address", () => {
    // 2002:808:808:: embeds 8.8.8.8 — public, so 6to4 routing of it is
    // no more reachable than the public address itself.
    expect(policy.check(new URL("http://[2002:808:808::]/"))).toBeUndefined();
    expect(policy.checkResolvedAddress?.("2002:808:808::", 6)).toBeUndefined();
  });
});

describe("createStrictUrlPolicy — allocation-aware: unallocated/bogon space inside 2000::/3", () => {
  const policy = createStrictUrlPolicy();

  it.each([
    ["3000::1", "3000::/4 — never allocated by IANA"],
    ["2010::1", "gap after 2003::/18, before 2400::/12"],
    ["2001:1000::1", "gap between 2001:e00::/23 and 2001:1200::/23"],
    ["2003:4000::1", "first address block past the 2003::/18 allocation boundary"],
    ["2420::1", "first /16 past the 2410::/12 (APNIC, 2024-11-01) boundary"],
  ])("blocks %s (%s) in both check() and checkResolvedAddress()", (addr) => {
    expect(policy.check(new URL(`http://[${addr}]/`))).toBeDefined();
    expect(policy.checkResolvedAddress?.(addr, 6)).toBeDefined();
  });

  it.each([
    ["2003:3fff::1", "last /32 inside 2003::/18 (RIPE NCC)"],
    ["240f::1", "last /16 inside 2400::/12 (APNIC)"],
    ["2410::1", "2410::/12 (APNIC, allocated 2024-11-01 — a stale snapshot blocked this)"],
    ["241f::1", "last /16 inside 2410::/12 (APNIC)"],
    ["2600::1", "2600::/12 (ARIN)"],
    ["2620:fe::fe", "2620::/23 ARIN micro-allocation (Quad9 DNS)"],
    ["2a01:4f8::1", "2a00::/12 (RIPE NCC)"],
    ["2c0f:f930::1", "2c00::/12 (AFRINIC)"],
  ])("allows %s (%s) in both check() and checkResolvedAddress()", (addr) => {
    expect(policy.check(new URL(`http://[${addr}]/`))).toBeUndefined();
    expect(policy.checkResolvedAddress?.(addr, 6)).toBeUndefined();
  });
});

describe("createStrictUrlPolicy — checkResolvedAddress", () => {
  const policy = createStrictUrlPolicy();

  it("rejects a resolved private IPv4 address", () => {
    expect(policy.checkResolvedAddress?.("127.0.0.1", 4)).toBeDefined();
    expect(policy.checkResolvedAddress?.("10.0.0.5", 4)).toBeDefined();
    expect(policy.checkResolvedAddress?.("192.168.1.1", 4)).toBeDefined();
  });

  it("allows a resolved public IPv4 address", () => {
    expect(policy.checkResolvedAddress?.("8.8.8.8", 4)).toBeUndefined();
  });

  it("rejects a resolved private/loopback IPv6 address, brackets or not", () => {
    expect(policy.checkResolvedAddress?.("::1", 6)).toBeDefined();
    expect(policy.checkResolvedAddress?.("[::1]", 6)).toBeDefined();
    expect(policy.checkResolvedAddress?.("fc00::1", 6)).toBeDefined();
  });
});

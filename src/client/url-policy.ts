/**
 * URL safety policy for the AADP v1.0 reference client (spec v1.0 §"SSRF"
 * in MANIFEST_V1.0_DESIGN.md §7, ADR-0005). Every URL the client follows
 * — manifest well-known URL, `discovery.sitemap_index`, sitemap item
 * `url`, redirect `Location` hops — MUST pass through a policy before the
 * client dereferences it.
 *
 * The `check()` method is a syntactic policy: it inspects the URL's scheme
 * and hostname as written, and for IP-literal hosts checks known private/
 * loopback/link-local ranges. On its own that does NOT defend against DNS
 * rebinding (a name that initially resolves to a public IP and later
 * repoints to a private one). `createStrictUrlPolicy()` also implements
 * `checkResolvedAddress()`, which `../http.js` uses to resolve every A/AAAA
 * record for a hostname, reject the connection if any is non-public, and
 * pin the socket to a verified address — see `createPinnedDispatcher` in
 * `../dns-pin.js`.
 */

export interface UrlPolicy {
  /** Returns `undefined` if the URL is allowed, or a reason string if not. */
  check(url: URL): string | undefined;
  /**
   * Optional second gate applied to every DNS-resolved address for a
   * hostname this policy already allowed syntactically. Defends against
   * DNS rebinding: a hostname that resolves to a public IP at policy-check
   * time but repoints to a private one by connect time. Returns a reason
   * string to reject the resolved address, or `undefined` to allow it.
   *
   * A policy that omits this method opts out of resolve-and-pin
   * enforcement entirely (e.g. `createPermissiveUrlPolicy`, which is only
   * ever used against trusted local/offline fixtures).
   */
  checkResolvedAddress?(address: string, family: 4 | 6): string | undefined;
}

export interface StrictUrlPolicyOptions {
  /** Additional scheme names to allow beyond http/https. Rarely needed. */
  allowedSchemes?: string[];
}

const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:"];

const LOCAL_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(h)) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "local" || h.endsWith(".local")) return true;
  return false;
}

function parseIPv4(hostname: string): number[] | null {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets;
}

/** RFC 1918, loopback, link-local, CGNAT, and other non-public IPv4 ranges. */
function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
  return false;
}

/**
 * Node's WHATWG URL parser keeps the brackets in `.hostname` for an IPv6
 * literal (`new URL("https://[::1]/").hostname === "[::1]"`); strip them
 * before comparing against unbracketed range prefixes.
 */
function stripBrackets(hostname: string): string {
  if (hostname.length >= 2 && hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/**
 * Expands a textual IPv6 address (bracket-stripped, lowercased) to its 8
 * canonical 16-bit groups, resolving a `::` run-of-zeros collapse and a
 * dotted-decimal IPv4 tail (`::ffff:127.0.0.1`) alike. Returns `null` for
 * anything that doesn't parse as a well-formed IPv6 address — callers
 * should treat that conservatively (as they already must, since `fetch()`
 * itself will then fail to connect to a malformed literal).
 */
function expandIPv6Groups(hostname: string): string[] | null {
  const sides = hostname.split("::");
  if (sides.length > 2) return null; // more than one "::" is never valid

  const convertDottedTail = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1];
    if (!last.includes(".")) return groups;
    const octets = parseIPv4(last);
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    return [...groups.slice(0, -1), hi, lo];
  };

  const splitSide = (side: string): string[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const converted = convertDottedTail(groups);
    if (!converted) return null;
    return converted.every((g) => HEX_GROUP.test(g)) ? converted : null;
  };

  if (sides.length === 1) {
    const groups = splitSide(sides[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = splitSide(sides[0]);
  const tail = splitSide(sides[1]);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...new Array(missing).fill("0"), ...tail];
}

/**
 * Non-global-unicast classification per the IANA IPv6 Special-Purpose
 * Address Registry. Anything outside `2000::/3` is treated as non-public —
 * loopback (`::1`), ULA (`fc00::/7`), link-local (`fe80::/10`),
 * deprecated site-local (`fec0::/10`), multicast (`ff00::/8`), the
 * discard-only block (`100::/64`), the well-known NAT64 prefix
 * (`64:ff9b::/96`), and any future or unrecognized special-purpose range
 * alike — and within `2000::/3` the registry's special-purpose blocks are
 * excluded too (2026-07-26 re-reviews: a hand-maintained prefix blocklist
 * let `fec0::/10` and multicast through, then "inside 2000::/3 == public"
 * let `2001::/23` IETF Protocol Assignments and 6to4 through):
 *
 * - `2001::/23` (IETF Protocol Assignments) is rejected wholesale. Its
 *   allocations are not globally reachable by default; the handful of
 *   exceptions (PCP/TURN anycast at 2001:1::1-3, AMT `2001:3::/32`,
 *   AS112 `2001:4:112::/48`, Drone Remote ID `2001:30::/28`) are anycast
 *   infrastructure endpoints an AADP crawler has no legitimate reason to
 *   dereference as a document origin, so conservatively blocking them is
 *   the right trade-off for an SSRF boundary. This also covers Teredo
 *   (`2001::/32`), benchmarking (`2001:2::/48`), and both ORCHID ranges.
 * - `2002::/16` (6to4) embeds an IPv4 address in bits 16-47; it is
 *   classified by that embedded IPv4 address (`2002:7f00:1::` embeds
 *   127.0.0.1 and is rejected; a 6to4 form of a public address passes).
 * - `2001:db8::/32` and `3fff::/20` (documentation) are rejected.
 *
 * IPv4-mapped (`::ffff:a.b.c.d` / `::ffff:HHHH:HHHH`) and IPv4-compatible
 * (`::a.b.c.d`, deprecated) addresses are likewise classified by their
 * embedded IPv4 address, regardless of whether it's written as
 * dotted-decimal or hex groups.
 */
function isPrivateIPv6(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase();
  const groups = expandIPv6Groups(h);
  if (!groups) return true; // fail closed: an unparseable IPv6 literal is never allowed

  const asInt = (g: string) => parseInt(g, 16);
  const embeddedIPv4 = (hi: number, lo: number): number[] => [
    (hi >> 8) & 0xff,
    hi & 0xff,
    (lo >> 8) & 0xff,
    lo & 0xff,
  ];

  const first5Zero = groups.slice(0, 5).every((g) => asInt(g) === 0);
  const sixth = asInt(groups[5]);
  if (first5Zero && (sixth === 0xffff || sixth === 0)) {
    return isPrivateIPv4(embeddedIPv4(asInt(groups[6]), asInt(groups[7])));
  }

  const g0 = asInt(groups[0]);
  if ((g0 & 0xe000) !== 0x2000) return true; // not in 2000::/3 global unicast

  const g1 = asInt(groups[1]);
  if (g0 === 0x2001 && g1 <= 0x01ff) return true; // 2001::/23 IETF Protocol Assignments
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x2002) {
    // 2002::/16 6to4: classify by the IPv4 address embedded in bits 16-47.
    return isPrivateIPv4(embeddedIPv4(g1, asInt(groups[2])));
  }
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return true; // 3fff::/20 documentation (RFC 9637)

  return false;
}

function isIPv6Literal(hostname: string): boolean {
  // Bracketed ("[::1]") or bare ("::1", as seen post-DNS-resolution) — both
  // contain a colon, which no valid IPv4 literal or DNS hostname does.
  return hostname.includes(":");
}

/**
 * Default client policy: HTTP(S) only, blocks private/loopback/
 * link-local/CGNAT/multicast destinations. This is what `discover()` and
 * friends use unless a caller supplies a different `UrlPolicy`.
 */
export function createStrictUrlPolicy(options: StrictUrlPolicyOptions = {}): UrlPolicy {
  const allowedSchemes = new Set(options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES);
  return {
    check(url: URL): string | undefined {
      if (!allowedSchemes.has(url.protocol)) {
        return `scheme "${url.protocol}" is not allowed (expected ${[...allowedSchemes].join(" or ")})`;
      }
      const hostname = url.hostname;
      if (isLocalHostname(hostname)) {
        return `hostname "${hostname}" resolves to a local/loopback name`;
      }
      if (isIPv6Literal(hostname)) {
        if (isPrivateIPv6(hostname)) {
          return `IPv6 address "${hostname}" is not a global-unicast address`;
        }
        return undefined;
      }
      const ipv4 = parseIPv4(hostname);
      if (ipv4 && isPrivateIPv4(ipv4)) {
        return `IPv4 address "${hostname}" is private, loopback, link-local, or reserved`;
      }
      return undefined;
    },
    checkResolvedAddress(address: string, family: 4 | 6): string | undefined {
      if (family === 6) {
        if (isPrivateIPv6(address)) {
          return `resolved IPv6 address "${address}" is not a global-unicast address`;
        }
        return undefined;
      }
      const octets = parseIPv4(address);
      if (!octets || isPrivateIPv4(octets)) {
        return `resolved IPv4 address "${address}" is private, loopback, link-local, or reserved`;
      }
      return undefined;
    },
  };
}

/**
 * Allows any http(s) URL, including private/loopback destinations. Only
 * for tests and offline/trusted deployments that intentionally point at
 * a local server — MUST NOT be the default for a crawler handling
 * server-supplied URLs from an untrusted origin.
 */
export function createPermissiveUrlPolicy(): UrlPolicy {
  return {
    check(url: URL): string | undefined {
      if (!DEFAULT_ALLOWED_SCHEMES.includes(url.protocol)) {
        return `scheme "${url.protocol}" is not allowed`;
      }
      return undefined;
    },
  };
}

export class BlockedUrlError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string
  ) {
    super(`Blocked by URL policy: ${url} (${reason})`);
    this.name = "BlockedUrlError";
  }
}

export function assertAllowed(url: URL, policy: UrlPolicy): void {
  const reason = policy.check(url);
  if (reason) {
    throw new BlockedUrlError(url.toString(), reason);
  }
}

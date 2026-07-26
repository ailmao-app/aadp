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
 * ::1 loopback, fc00::/7 ULA, fe80::/10 link-local, and any IPv4-mapped
 * (`::ffff:a.b.c.d` / `::ffff:HHHH:HHHH`) or IPv4-compatible (`::a.b.c.d`,
 * deprecated) representation of a private IPv4 address, regardless of
 * whether the last 32 bits are written as dotted-decimal or hex groups.
 */
function isPrivateIPv6(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 ULA
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }

  const groups = expandIPv6Groups(h);
  if (!groups) return false;
  const asInt = (g: string) => parseInt(g, 16);
  const first5Zero = groups.slice(0, 5).every((g) => asInt(g) === 0);
  const sixth = asInt(groups[5]);
  if (first5Zero && (sixth === 0xffff || sixth === 0)) {
    const hi = asInt(groups[6]);
    const lo = asInt(groups[7]);
    const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    return isPrivateIPv4(octets);
  }
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
          return `IPv6 address "${hostname}" is loopback, link-local, or ULA`;
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
          return `resolved IPv6 address "${address}" is loopback, link-local, or ULA`;
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

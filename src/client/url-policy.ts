/**
 * URL safety policy for the AADP v1.0 reference client (spec v1.0 §"SSRF"
 * in MANIFEST_V1.0_DESIGN.md §7, ADR-0005). Every URL the client follows
 * — manifest well-known URL, `discovery.sitemap_index`, sitemap item
 * `url`, redirect `Location` hops — MUST pass through a policy before the
 * client dereferences it.
 *
 * This is a syntactic policy: it inspects the URL's scheme and hostname
 * as written, and for IP-literal hosts checks known private/loopback/
 * link-local ranges. It does NOT resolve DNS and re-check the resolved
 * address, so it does not defend against DNS rebinding (a name that
 * initially resolves to a public IP and later repoints to a private
 * one). A production crawler embedding this client SHOULD pair it with
 * resolve-then-pin request handling at the network layer if that threat
 * matters for its deployment; that is out of scope for this reference
 * implementation.
 */

export interface UrlPolicy {
  /** Returns `undefined` if the URL is allowed, or a reason string if not. */
  check(url: URL): string | undefined;
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

/** ::1 loopback, fc00::/7 ULA, fe80::/10 link-local, and IPv4-mapped equivalents. */
function isPrivateIPv6(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 ULA
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const octets = parseIPv4(mapped[1]);
    if (octets) return isPrivateIPv4(octets);
  }
  return false;
}

function isIPv6Literal(hostname: string): boolean {
  // URL hostname for IPv6 literals is bracket-stripped by the WHATWG URL
  // parser (new URL("https://[::1]/").hostname === "::1"), so this checks
  // for a colon rather than brackets.
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

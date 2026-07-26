/**
 * Resolve-then-pin request dispatching for the SSRF-aware fetch layer in
 * `./http.ts`. `UrlPolicy.check()` (`./url-policy.ts`) only inspects the
 * URL's hostname as written; a hostname that is public at check time can
 * still resolve to a private/loopback/link-local address by the time the
 * TCP connection is actually opened (DNS rebinding). This module closes
 * that gap by resolving every A/AAAA record for the hostname ourselves,
 * rejecting the connection if any resolved address fails
 * `policy.checkResolvedAddress`, and pinning the socket to a single
 * verified address so the OS resolver is never consulted again for that
 * connection.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, type Dispatcher } from "undici";
import { BlockedUrlError, type UrlPolicy } from "./url-policy.js";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

function pinnedLookup(
  checkResolvedAddress: (address: string, family: 4 | 6) => string | undefined
): (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, "");
        return;
      }
      const list = addresses as LookupAddress[];
      if (list.length === 0) {
        callback(new Error(`DNS lookup for "${hostname}" returned no addresses`), "");
        return;
      }
      for (const { address, family } of list) {
        const reason = checkResolvedAddress(address, family === 6 ? 6 : 4);
        if (reason) {
          callback(new BlockedUrlError(hostname, reason), "");
          return;
        }
      }
      if (options?.all) {
        callback(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

const dispatcherCache = new WeakMap<UrlPolicy, Dispatcher | null>();

/**
 * Returns an undici `Dispatcher` pinned to DNS-resolved, policy-verified
 * addresses for `policy`, or `undefined` if `policy` does not implement
 * `checkResolvedAddress` (e.g. `createPermissiveUrlPolicy()`, which is
 * only ever used against trusted local/offline fixtures and should not
 * pay for or be blocked by resolve-and-pin). Cached per policy instance
 * so repeated calls against the same policy reuse one connection pool.
 */
export function dispatcherFor(policy: UrlPolicy): Dispatcher | undefined {
  if (dispatcherCache.has(policy)) {
    return dispatcherCache.get(policy) ?? undefined;
  }
  const dispatcher = policy.checkResolvedAddress
    ? new Agent({
        connect: { lookup: pinnedLookup(policy.checkResolvedAddress.bind(policy)) },
        // Bound per-origin socket growth and let idle keep-alive sockets
        // close themselves — this Agent is cached and reused indefinitely
        // (see `dispatcherCache`), so it must not accumulate connections
        // without limit across a long crawl over many distinct origins.
        connections: 32,
        keepAliveTimeout: 10_000,
        keepAliveMaxTimeout: 30_000,
      })
    : null;
  dispatcherCache.set(policy, dispatcher);
  return dispatcher ?? undefined;
}

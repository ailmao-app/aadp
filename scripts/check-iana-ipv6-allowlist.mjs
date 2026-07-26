/**
 * Diffs the GLOBAL_UNICAST_ALLOCATIONS snapshot in
 * `src/client/url-policy.ts` against the live IANA IPv6 Global Unicast
 * Address Assignments registry. A security allowlist must not go stale
 * silently in either direction: a missing allocation blocks a valid
 * IPv6 range as bogon (2026-07-26 review: 2410::/12), while an extra
 * entry would allow unallocated space through the SSRF boundary.
 *
 * Usage (network access required; not part of `npm test`):
 *   npm run build && npm run check:iana-ipv6
 *
 * Exit codes: 0 = snapshot matches registry, 1 = drift found, 2 = fetch failed.
 */
import { GLOBAL_UNICAST_ALLOCATIONS } from "../dist/client/url-policy.js";

const CSV_URL =
  "https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.csv";

// Registry rows that ARE allocated but get dedicated special-purpose
// handling in url-policy.ts instead of an allowlist entry.
const SPECIAL_PURPOSE = new Set(["2001::/23", "2002::/16"]);

/** Minimal CSV parser handling quoted fields that contain commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** "2001:c00::/23" -> [0x20010c00, 23] (first two 16-bit groups + prefix length). */
function parsePrefix(prefix) {
  const [addr, bitsStr] = prefix.split("/");
  const groups = addr.replace(/::$/, "").split(":").filter((g) => g !== "");
  const g0 = parseInt(groups[0] ?? "0", 16);
  const g1 = parseInt(groups[1] ?? "0", 16);
  return [((g0 << 16) | g1) >>> 0, Number(bitsStr)];
}

const res = await fetch(CSV_URL);
if (!res.ok) {
  console.error(`IANA registry fetch failed: HTTP ${res.status}`);
  process.exit(2);
}
const rows = parseCsv(await res.text());
const header = rows[0];
const prefixCol = header.indexOf("Prefix");
const statusCol = header.indexOf("Status");

const registry = new Map(); // "g0g1/bits" key -> prefix string
for (const row of rows.slice(1)) {
  if (row[statusCol] !== "ALLOCATED") continue;
  const prefix = row[prefixCol];
  if (SPECIAL_PURPOSE.has(prefix)) continue;
  const [value, bits] = parsePrefix(prefix);
  registry.set(`${value}/${bits}`, prefix);
}

const snapshot = new Map(
  GLOBAL_UNICAST_ALLOCATIONS.map(([value, bits]) => [
    `${value}/${bits}`,
    `0x${value.toString(16).padStart(8, "0")}/${bits}`,
  ])
);

const missing = [...registry].filter(([key]) => !snapshot.has(key));
const extra = [...snapshot].filter(([key]) => !registry.has(key));

for (const [, prefix] of missing) {
  console.error(`MISSING from snapshot (valid range blocked as bogon): ${prefix}`);
}
for (const [, entry] of extra) {
  console.error(`EXTRA in snapshot (not ALLOCATED in registry — SSRF exposure): ${entry}`);
}

if (missing.length || extra.length) {
  console.error(
    `\nSnapshot drift: ${missing.length} missing, ${extra.length} extra. ` +
      "Update GLOBAL_UNICAST_ALLOCATIONS in src/client/url-policy.ts and its boundary tests."
  );
  process.exit(1);
}
console.log(`OK: snapshot matches IANA registry (${registry.size} allocations).`);

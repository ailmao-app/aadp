/**
 * Canonical JSON per AADP spec §6 / ADR-0001 (RFC 8785 JCS): object keys
 * sorted by UTF-16 code unit value at every level, array order preserved,
 * no insignificant whitespace.
 *
 * This is a validating canonicalizer, not a coercing one: inputs outside
 * the JSON/I-JSON value domain (`undefined`, functions, symbols, bigints,
 * sparse arrays, lone UTF-16 surrogates, non-finite numbers) are rejected
 * with a `TypeError` rather than silently dropped or rewritten, so a
 * checksum is never computed over data that quietly changed shape on the
 * way in.
 */
export function canonicalize(value: unknown): string {
  try {
    return serialize(value);
  } catch (err) {
    // `serialize()` recurses once per nesting level. A document this deep
    // is either malformed or adversarial (checksums are verified against
    // server-supplied data an attacker can shape — see
    // `../client/validated-document.ts`), and a raw `RangeError: Maximum
    // call stack size exceeded` would surface as an unhandled-looking
    // crash instead of the same clearly-typed rejection every other
    // out-of-domain input in this module gets.
    if (err instanceof RangeError) {
      throw new TypeError("Canonical JSON input is too deeply nested to serialize");
    }
    throw err;
  }
}

/**
 * RFC 8785 §3.2.3 requires key comparison by UTF-16 code unit value, not
 * UTF-8 byte order or Unicode code point order — those diverge for
 * strings containing supplementary-plane characters. Explicit instead of
 * relying on `Array.prototype.sort()`'s default (which happens to match
 * today, but is not contractually guaranteed to stay that way).
 */
function compareUtf16CodeUnits(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/**
 * Rejects lone (unpaired) UTF-16 surrogates, which do not correspond to
 * any Unicode scalar value and therefore have no valid UTF-8 encoding —
 * silently passing them through (as `JSON.stringify` and `TextEncoder`
 * both do, via U+FFFD substitution or WTF-8) would change what bytes the
 * checksum is computed over depending on the runtime.
 */
function assertNoLoneSurrogates(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(
          `Canonical JSON does not support lone UTF-16 surrogate at string index ${i}`
        );
      }
      i++; // consumed the matched low surrogate too
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(
        `Canonical JSON does not support lone UTF-16 surrogate at string index ${i}`
      );
    }
  }
}

function serialize(value: unknown): string {
  if (value === undefined) {
    throw new TypeError(
      "Canonical JSON does not support undefined; omit the key/element instead"
    );
  }
  if (value === null) return "null";

  const t = typeof value;

  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support NaN/Infinity");
    }
    return String(value);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") {
    assertNoLoneSurrogates(value as string);
    return JSON.stringify(value);
  }
  if (t === "function" || t === "symbol" || t === "bigint") {
    throw new TypeError(`Canonical JSON does not support value of type ${t}`);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) {
        throw new TypeError(
          `Canonical JSON does not support sparse arrays (hole at index ${i})`
        );
      }
    }
    return `[${value.map((element) => serialize(element)).join(",")}]`;
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareUtf16CodeUnits);
    const entries = keys.map((k) => {
      assertNoLoneSurrogates(k);
      return `${JSON.stringify(k)}:${serialize(obj[k])}`;
    });
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Cannot canonicalize value of type ${t}`);
}

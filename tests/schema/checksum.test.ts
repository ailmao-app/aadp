import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checksumOf } from "../../src/canonical-json/checksum.js";
import { canonicalize } from "../../src/canonical-json/canonicalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectorsFile = path.resolve(__dirname, "..", "fixtures", "checksum-vectors.json");

interface Vector {
  description: string;
  payload: unknown;
  checksum?: string;
  checksumEquivalentTo?: unknown;
}

const vectors: Vector[] = JSON.parse(readFileSync(vectorsFile, "utf8"));

describe("checksum test vectors", () => {
  for (const vector of vectors) {
    it(vector.description, () => {
      if (vector.checksum) {
        expect(checksumOf(vector.payload)).toBe(vector.checksum);
      }
      if (vector.checksumEquivalentTo !== undefined) {
        expect(checksumOf(vector.payload)).toBe(checksumOf(vector.checksumEquivalentTo));
      }
    });
  }
});

describe("canonical JSON invariants", () => {
  it("sorts object keys regardless of insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("checksum is stable across repeated calls", () => {
    const payload = { nested: { z: 1, a: [1, 2, { y: 1, x: 2 }] } };
    const first = checksumOf(payload);
    const second = checksumOf(JSON.parse(JSON.stringify(payload)));
    expect(first).toBe(second);
  });

  it("checksum changes when semantic content changes", () => {
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });

  it("sorts keys by UTF-16 code unit order, not UTF-8 byte order or code point order", () => {
    // U+E000 (BMP) vs U+10000 (supplementary plane, surrogate pair D800 DC00
    // in UTF-16). UTF-16 code unit order puts the surrogate pair first
    // (0xD800 < 0xE000); UTF-8 byte order would put U+E000 first (0xEE...
    // < 0xF0...). RFC 8785 §3.2.3 mandates UTF-16 order.
    const bmp = String.fromCodePoint(0xe000);
    const supplementary = String.fromCodePoint(0x10000);
    const canonical = canonicalize({ [bmp]: 1, [supplementary]: 2 });
    expect(canonical.indexOf(JSON.stringify(supplementary))).toBeLessThan(
      canonical.indexOf(JSON.stringify(bmp))
    );
  });
});

describe("canonicalizer rejects out-of-domain input instead of coercing it", () => {
  it("rejects top-level undefined", () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
  });

  it("rejects an object property with an explicit undefined value", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(TypeError);
  });

  it("rejects an array element that is undefined", () => {
    expect(() => canonicalize([1, undefined, 3])).toThrow(TypeError);
  });

  it("rejects functions", () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(TypeError);
  });

  it("rejects symbols", () => {
    expect(() => canonicalize({ a: Symbol("x") })).toThrow(TypeError);
  });

  it("rejects bigint", () => {
    expect(() => canonicalize({ a: 10n })).toThrow(TypeError);
  });

  it("rejects sparse arrays (holes)", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3];
    expect(() => canonicalize(sparse)).toThrow(TypeError);
  });

  it("rejects a lone high surrogate", () => {
    expect(() => canonicalize({ a: "before\uD800after" })).toThrow(TypeError);
  });

  it("rejects a lone low surrogate", () => {
    expect(() => canonicalize({ a: "before\uDC00after" })).toThrow(TypeError);
  });

  it("rejects a lone surrogate used as an object key", () => {
    expect(() => canonicalize({ "\uD800": 1 })).toThrow(TypeError);
  });

  it("accepts a correctly paired surrogate (real supplementary-plane character)", () => {
    expect(() => canonicalize({ a: "𐀀" })).not.toThrow();
  });

  it("still rejects NaN and Infinity", () => {
    expect(() => canonicalize({ a: NaN })).toThrow(TypeError);
    expect(() => canonicalize({ a: Infinity })).toThrow(TypeError);
    expect(() => canonicalize({ a: -Infinity })).toThrow(TypeError);
  });
});

# ADR-0001: Checksum algorithm and canonical JSON

## Status

Accepted — AADP v0.1

## Context

Clients need a stable way to detect whether a resource changed without
re-downloading or re-parsing the full payload, and to verify payload
integrity independent of transport (`ETag` can be rewritten by
intermediaries; a body-derived checksum cannot).

JSON does not have a single canonical byte representation: key order,
whitespace and number formatting can vary between producers while the
semantic content stays identical. Without a canonicalization rule, the
same logical entity could produce different checksums on every
regeneration, defeating caching and change detection.

## Decision

- AADP adopts **RFC 8785 (JSON Canonicalization Scheme / JCS)** as its
  canonical JSON form, rather than inventing an ad hoc one. Concretely:
  object keys sorted by **UTF-16 code unit value** at every nesting level
  (this is what RFC 8785 §3.2.3 mandates, and what native string
  comparison/`Array.prototype.sort()` already does in JavaScript, Java,
  C#, and most other mainstream runtimes — it is *not* the same as UTF-8
  byte order for strings containing supplementary-plane characters, and
  implementers targeting those must sort by UTF-16 code unit, not raw
  UTF-8 bytes, to interoperate), no insignificant whitespace, UTF-8
  encoding of the output, arrays kept in their original order, and
  numbers serialized via the ECMAScript `Number::toString` algorithm
  (RFC 8785 §3.2.2.3) — which is exactly what `String(number)` produces
  in JavaScript, so the reference implementation needs no special-casing.
- The checksum is `sha256:<hex>` where `<hex>` is the lowercase hex SHA-256
  digest of the canonical JSON UTF-8 byte sequence of the resource's
  `data` payload (for entities) or `items` payload (for sitemaps).
- Checksums MUST be stable: re-serializing semantically identical data
  MUST produce the same checksum. Producers MUST compute the checksum from
  canonical JSON, never from the literal wire bytes if those bytes were
  pretty-printed or reordered.
- Checksum is exposed both in the payload (`checksum` field) and as the
  `ETag` HTTP header value.
- Canonicalization is a **validating** operation, not a coercing one.
  Inputs outside the JSON/I-JSON value domain — `undefined` (top-level, an
  object property, or an array element), functions, symbols, bigints,
  sparse arrays (holes), and lone (unpaired) UTF-16 surrogates in a string
  or key — MUST be rejected with an error, never silently dropped,
  nulled, or substituted. Silent coercion (e.g. `JSON.stringify`'s
  behavior of dropping `undefined` object properties, nulling `undefined`
  array elements, and substituting U+FFFD for lone surrogates) would let
  a checksum represent data that quietly changed shape on the way in,
  and different runtimes coerce these cases differently, which breaks
  cross-implementation interoperability even when everyone agrees on key
  ordering.

## Consequences

- Producers MUST implement canonical JSON before computing checksums;
  AADP core ships a reference implementation
  (`src/canonical-json/canonicalize.ts`) so implementers do not need to
  invent their own.
- Consumers MAY use the checksum for local dedupe/change detection instead
  of the `ETag`/`If-None-Match` cycle when doing bulk sync.
- SHA-256 was chosen over weaker/faster hashes (e.g. CRC32, MD5) because
  the checksum also functions as a tamper-evidence signal for AI clients
  consuming data outside a TLS-terminated browser context.
- Deferring to a published RFC (rather than a bespoke rule) means
  non-JavaScript implementers can reach for an existing JCS library
  instead of reverse-engineering AADP's canonicalization from the
  reference implementation. `tests/schema/checksum.test.ts` includes
  Unicode test vectors (BMP vs. supplementary-plane keys) to make the
  UTF-16-vs-UTF-8 ordering distinction explicit and testable across
  ports.

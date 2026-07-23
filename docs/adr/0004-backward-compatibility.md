# ADR-0004: Backward compatibility policy

## Status

Accepted — AADP v0.1

## Context

AADP is meant to be implemented independently by multiple servers and
consumed by multiple AI clients that are not co-deployed with any single
server. Without an explicit compatibility contract, any schema or
behavior change risks silently breaking already-deployed clients or
servers.

## Decision

- AADP versions follow `MAJOR.MINOR` (e.g. `0.1`, `0.2`, `1.0`); the
  `aidp_version` field in every payload pins the wire contract version
  the payload was produced under.
- **Patch changes** (documentation, non-normative clarification, bug fixes
  in reference implementation code) do not bump `aidp_version` and MUST
  NOT alter schema validation results for any previously-valid payload.
- **Minor version** bumps (e.g. `0.1` → `0.2`) MAY add new optional
  fields, new capability tokens, or new resource types. They MUST NOT
  remove or repurpose existing required fields, MUST NOT change the
  meaning of an existing field, and existing valid `0.1` payloads MUST
  remain valid under the `0.1` schema forever (schemas are versioned by
  directory, e.g. `schemas/v0.1/`, and are never mutated after release).
- **Major version** bumps MAY break wire compatibility and MUST ship a
  migration note in `CHANGELOG.md`.
- A released version's schema files, once tagged, are immutable. Fixing a
  mistake requires a new version, not an edit to a released schema.
- Reference client and conformance suite for version `N` MUST keep passing
  against any server that only claims version `N`, regardless of which
  later versions exist.

## Consequences

- Implementers can pin to `schemas/v0.1/` and `spec/v0.1/` and get a
  permanent, stable contract.
- The project must maintain multiple schema directories in parallel once
  a new minor/major version ships, rather than editing in place.
- This ADR is the basis for the Phase A3 release gate requirement that
  the v0.1 artifact be versioned and checksummed as immutable.

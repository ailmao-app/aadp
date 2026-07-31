# AADP v1.0 Implementation Plan

| Field | Value |
|---|---|
| Document type | Implementation record |
| Status | Implemented; maintained as a regression baseline |
| Audience | Package maintainers and release reviewers |
| Scope | AADP core v1.0 |
| Vietnamese internal edition | [`../vi/plans/implementation-plan.md`](../vi/plans/implementation-plan.md) |

## Abstract

This memo records the architecture, delivery phases, and release gates used to
implement AADP v1.0. It is informational and does not override the v1.0
specification or schemas.

## Status of This Memo

The original v1.0 delivery is complete. The gates remain applicable to compatible
patch and minor releases. Current maintenance work is tracked in the Vietnamese
internal edition and the issue tracker.

Requirement words follow [the AADP documentation conventions](../document-conventions.md).

## Objective

Deliver AADP v1.0 as an application-independent package containing versioned schemas, validators, a secure reference client, canonical JSON utilities, and a conformance suite.

AADP core must remain separate from application adapters. An adapter maps public domain data into AADP documents; it must not add application-specific models or business rules to the protocol package.

## Architecture

```text
application HTTP adapter
          ↓
    AADP document builder
          ↓
 JSON Schema validation
          ↓
  semantic validation
          ↓
reference client / consumer
```

Layer responsibilities:

- `schemas/`: wire shape, required fields, formats, and extension points.
- `src/validator/`: version-aware schema validation and pure semantic rules.
- `src/client/`: bounded HTTP discovery and retrieval.
- `src/canonical-json/`: deterministic serialization and checksums.
- `tests/conformance/`: externally observable protocol behavior.
- Application adapter: public field mapping and data access outside AADP core.

## Delivery phases

### 1. Contract and specification

- Close manifest design decisions through ADR-0005.
- Publish the v1.0 normative specification.
- Add v1.0 schemas, examples, and invalid fixtures.
- Keep released v0.1 artifacts immutable.

### 2. Version-aware validation

- Register schemas by `{version, kind}`.
- Distinguish an unsupported version from an invalid document.
- Allow the CLI to read `aadp_version` or accept `--version`.
- Preserve explicit v0.1 validator compatibility.

### 3. Semantic validation

- Check unique module, resource, and interface identifiers.
- Verify security-scheme references.
- Verify language preference membership.
- Detect placeholder URLs and secret-shaped public values.
- Treat instruction-like text as advisory data, never executable policy.

### 4. Secure reference client

- Validate every document before following discovered URLs.
- Bound request duration, redirects, and response size.
- Apply an injectable URL policy.
- Block private, loopback, and link-local destinations in strict mode.
- Detect pagination cursor cycles.

### 5. Conformance

- Test manifest discovery and schema validity.
- Test sitemap-to-entity consistency.
- Test cache validators and conditional requests.
- Test malformed responses, dead URLs, redirects, SSRF controls, and oversized documents.
- Support both a bundled mock server and `AADP_BASE_URL`.

### 6. Package and documentation

- Export versioned clients and schemas.
- Include specifications and examples in the npm tarball.
- Verify clean install, build, test, pack, and public imports.
- Publish implementation and security guidance.

### 7. Application adapters

- Inventory public resources and policy URLs.
- Maintain an explicit public-field allow-list.
- Publish only deployed endpoints and modules.
- Run the core conformance suite against staging before production.

## Delivered maintenance capabilities

| Capability | Status | Evidence |
|---|---|---|
| Standalone conformance runner, JSON/JUnit reports, and CLI | Implemented | `src/conformance/`, `tests/conformance/v1.0/runner.test.ts` |
| Declarative server SDK | Implemented | `src/server/`, `tests/server/runtime.test.ts` |
| Scaffold CLI | Implemented | `src/scaffold/`, `tests/scaffold/scaffold.test.ts` |
| Configurable server routes | Implemented in 1.0.7 | `src/server/routes.ts`, `tests/server/routes.test.ts` |
| Clean-install package verification | Implemented | `tests/package/` |

The standalone `aadp-conformance` CLI is the public deployment-checking surface.
The `AADP_BASE_URL` Vitest mode remains a contributor self-test mechanism and is
not required by external consumers.

`AADP-CONFORMANCE-003` added `renderJUnitReport`, the `--junit <file>` CLI flag,
and `examples/ci/github-actions-conformance.yml` for CI integration.

## Release gate

A version is ready when:

- Specification and schemas are internally consistent.
- Schema and semantic tests pass.
- The reference client never trusts unvalidated discovery URLs.
- SSRF, redirect, timeout, and response-size behavior is tested.
- Mock-server conformance passes.
- Package build, tarball contents, and import smoke tests pass.
- Documentation reflects the released wire contract.

Current verification commands:

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

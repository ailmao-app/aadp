# AADP v1.0 Implementation Plan

> Status: Implemented and released as `ail-aadp@1.0.0`.
>
> Vietnamese edition: [`vi/IMPLEMENTATION_PLAN.md`](vi/IMPLEMENTATION_PLAN.md).

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

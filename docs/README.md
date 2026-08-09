# AADP Documentation Index

## Document metadata

| Field | Value |
|---|---|
| Status | Active |
| Audience | Implementers, reviewers, and maintainers |
| Normative source | Versioned specifications under [`../spec/`](../spec/) |
| Conventions | [`document-conventions.md`](document-conventions.md) |
| Package baseline at last audit | `ail-aadp@1.1.0` |

## Abstract

This directory contains design records, implementation guidance, security notes,
delivery plans, and internal Vietnamese documents for AADP. Documents in this
directory explain the protocol and its implementation, but they do not override
the versioned specification or JSON Schemas.

## 1. Authority and precedence

When documents disagree, use this order:

1. Released JSON Schema for machine validation.
2. Versioned normative specification in `spec/<version>/`.
3. Accepted ADRs in `docs/adr/`.
4. Public implementation and security guides in `docs/`.
5. Design drafts and delivery plans.
6. Internal Vietnamese notes in `docs/vi/`.

An implementation plan or design draft MUST NOT silently change a released wire
contract. Such a change requires a new protocol version and an ADR.

## 2. Normative protocol documents

- [AADP v0.1 specification](../spec/v0.1/specification.md)
- [AADP v1.0 specification](../spec/v1.0/specification.md)
- [Relations Module v1.0 specification](../spec/modules/relations/v1.0/specification.md)
- [Relations Module v1.0 conformance contract](../spec/modules/relations/v1.0/conformance.md)
- [Answer Module v1.0 specification](../spec/modules/answer/v1.0/specification.md)
- [Answer Module v1.0 conformance contract](../spec/modules/answer/v1.0/conformance.md)
- [AADP v0.1 schemas](../schemas/v0.1/)
- [AADP v1.0 schemas](../schemas/v1.0/)

## 3. Public implementation documents

| Document | Type | Status |
|---|---|---|
| [AADP v0.1 implementation guide](guides/implementation-guide-v0.1.md) | Guide | Historical/frozen |
| [AADP v1.0 implementation guide](guides/implementation-guide-v1.0.md) | Guide | Active |
| [Security considerations](guides/security-considerations.md) | Security guidance | Active |
| [AADP v1.0 implementation record](records/implementation-record-v1.0.md) | Implementation record | Implemented |
| [`ail-aadp` 1.4.0 implementation record](records/implementation-record-v1.4.0.md) | Implementation record | In progress |
| [Manifest v1.0 design](design/manifest-v1.0-design.md) | Design memo | Accepted through ADR-0005 |
| [Agent-discovery integrations proposal](design/agent-discovery-integrations-proposal.md) | Design memo | Proposed |
| [Relations Module design](design/relations-module-design.md) | Design memo | Superseded |
| [AEO/GEO integration plan](design/aeo-geo-integration-plan.md) | Design plan | Draft |
| [Evidence Module v1.0 specification](../spec/modules/evidence/v1.0/specification.md) | Wire contract draft | Draft — non-normative until ADR-0010 is Accepted |
| [Evidence Module v1.0 conformance contract](../spec/modules/evidence/v1.0/conformance.md) | Conformance draft | Draft — non-normative until ADR-0010 is Accepted |
| [Historical AADP draft](archive/aadp-draft.md) | Archive | Superseded |

## 4. Architecture Decision Records

- [ADR-0001: Checksum algorithm and canonical JSON](adr/0001-checksum-algorithm.md)
- [ADR-0002: Cache semantics](adr/0002-cache-semantics.md)
- [ADR-0003: Capability discovery](adr/0003-capability-discovery.md)
- [ADR-0004: Backward compatibility](adr/0004-backward-compatibility.md)
- [ADR-0005: Manifest v1.0 discovery](adr/0005-manifest-v1-discovery.md)
- [ADR-0006: Bounded traversal controls](adr/0006-bounded-traversal-controls.md)
- [ADR-0007: Module versioning and discovery](adr/0007-module-versioning-and-discovery.md)
- [ADR-0008: Module traversal and authorization](adr/0008-module-traversal-and-authorization.md)
- [ADR-0009: Answer Module terminology and security boundary](adr/0009-answer-module-terminology-and-security.md)
- [ADR-0010: Evidence Module citation, provenance and security boundary](adr/0010-evidence-citation-provenance-and-security.md) — **Proposed**, not yet Accepted

ADRs retain the Context/Decision/Consequences format. They are not rewritten as
protocol specifications.

## 5. Internal Vietnamese documents

Internal planning, review, and design notes remain under [`vi/`](vi/README.md).
They are intentionally written in Vietnamese and may contain more operational
detail than the public documents. An internal document MUST link to the public
specification or ADR when it discusses a normative decision.

## 6. Maintenance rules

- Every public design memo MUST declare its status and intended audience.
- Documentation filenames use lowercase kebab-case; `README.md` is the conventional entry-point exception.
- Draft examples MUST NOT be interpreted as assigned wire versions.
- Normative terms MUST follow RFC 2119/RFC 8174 as described in the conventions.
- Links SHOULD be relative and MUST remain valid after a document move.
- Superseded material MUST be retained as history or replaced by a link to its successor.
- A release-related document change SHOULD update `CHANGELOG.md` when it changes public behavior.

## 7. Recommended reading order

1. Read the specification and schema for the target wire version.
2. Read the matching implementation guide and security considerations.
3. Read accepted ADRs when implementation behavior depends on a design decision.
4. Use design drafts only for future work; do not advertise draft modules.
5. Use implementation records and internal plans for maintenance evidence, not as wire contracts.

## 8. References

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)

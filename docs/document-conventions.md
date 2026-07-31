# AADP Documentation Conventions

## Document metadata

| Field | Value |
|---|---|
| Status | Active |
| Audience | Authors and reviewers |
| Scope | Documents under `docs/` and `docs/vi/` |

## Abstract

This memo defines the RFC-style structure used by AADP documentation. It does
not define protocol behavior.

## 1. Requirement language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** are to be interpreted as described in BCP 14, RFC 2119 and RFC
8174, only when they appear in all capitals.

Vietnamese internal documents MAY retain these uppercase English key words to
avoid ambiguity. Ordinary lowercase words such as “must” or “should” are
explanatory prose and are not normative requirements.

## 2. Document classes

| Class | Purpose | Normative authority |
|---|---|---|
| Specification | Defines a versioned wire contract | Normative |
| JSON Schema | Machine-validates a versioned wire shape | Normative for schema validation |
| ADR | Records an accepted architectural decision | Binding within its stated scope |
| Design memo | Explores or explains a design | Informational unless accepted by an ADR/specification |
| Implementation guide | Explains how to implement a released contract | Informational |
| Implementation record/plan | Tracks delivery, gates, and maintenance | Informational |
| Security considerations | Defines threats and implementation safeguards | Normative only where the specification incorporates it |
| Internal document | Supports team planning and review | Non-public, non-normative by default |

## 3. RFC-style structure

A new public memo SHOULD use the following sections where applicable:

1. Title and document metadata.
2. Abstract.
3. Status of This Memo.
4. Terminology and requirement language.
5. Scope and non-goals.
6. Protocol or architecture description.
7. Validation/conformance requirements.
8. Security considerations.
9. Compatibility/versioning considerations.
10. Operational considerations.
11. IANA considerations.
12. References.

Plans MAY replace protocol sections with work packages, acceptance criteria,
release gates, and an implementation-status registry. ADRs keep their established
Status/Context/Decision/Consequences structure.

## 4. Status values

Public memos use one of these values:

- `Draft`: open design questions remain.
- `Proposed`: ready for review but not accepted.
- `Accepted`: approved through a named ADR or specification.
- `Implemented`: delivered and covered by verification evidence.
- `Deprecated`: still available but discouraged.
- `Superseded`: replaced by a named successor.
- `Historical`: retained only as context.

Documents with mixed delivery state MUST include a per-work-item status table.

## 5. References and examples

- Normative and informative references SHOULD be separated when the distinction matters.
- Code and JSON examples MUST be in English.
- Example identifiers, versions, and URLs MUST be labeled as non-normative when they are proposals.
- A document MUST NOT claim that a draft module version is allocated solely because it appears in an example.

## 6. IANA considerations

A protocol memo MUST contain an IANA Considerations section. If it requests no
registry action, it SHOULD state: “This document has no IANA actions.”

## 7. Internal Vietnamese documents

Documents under `docs/vi/` remain in Vietnamese with accents. They SHOULD use the
same status vocabulary and authority rules, but MAY use a delivery-oriented layout
when that is clearer for internal work. They MUST NOT be presented as the public
normative source unless the project explicitly changes its publication policy.

## 8. References

### Normative references

- RFC 2119, “Key words for use in RFCs to Indicate Requirement Levels”.
- RFC 8174, “Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words”.

### Informative references

- RFC 7322, “RFC Style Guide”.

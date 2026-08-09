# AADP Relations Module v1.0 — Conformance Contract

## Document metadata

| Field | Value |
|---|---|
| Status | Accepted implementation contract |
| Module | `aadp:relations@1.0` |
| Owner | AADP maintainers |
| Normative source | [`specification.md`](specification.md) |

## Runner boundary

`runRelationsConformance(options)` is exported from
`ail-aadp/modules/relations/v1.0`. The runner shares the report and execution
utilities but has its own suite; the core `CHECKS` and their IDs MUST NOT
change.

## Stable check IDs

| Check ID | Meaning |
|---|---|
| `relations.discovery.declared` | Exact module declaration |
| `relations.schema.reachable` | Module schema URL usable |
| `relations.schema.relation_set` | `x_relations` schema |
| `relations.schema.collection` | Collection schema |
| `relations.schema.registry` | Registry schema |
| `relations.semantic.cardinality` | Cardinality/container |
| `relations.semantic.tokens` | Standard/vendor tokens |
| `relations.semantic.target_identity` | ID prefix/type |
| `relations.semantic.duplicate_target` | Duplicate target IDs |
| `relations.collection.context` | Source/rel/type context |
| `relations.collection.pagination` | Cursor termination/context |
| `relations.collection.checksum` | Canonical items checksum |
| `relations.registry.unique_token` | Registry token uniqueness |
| `relations.registry.checksum` | Canonical relations checksum |
| `relations.registry.symmetric` | `symmetric: true` requires `inverse` == `token` |
| `relations.http.errors` | Empty/error semantics |
| `relations.http.cache` | Conditional GET |
| `relations.traversal.budget` | Effective limits |
| `relations.traversal.cycle` | Cursor/graph cycle |
| `relations.traversal.partial` | Truncated result state |
| `relations.security.url_policy` | URL/DNS policy |
| `relations.security.credentials` | Credential scoping |
| `relations.privacy.social_graph` | No public follows/followers |

Released check IDs are a stable machine contract.

## Issue taxonomy

| Code | Default result |
|---|---|
| `unsupported_module` | ignored core-only; inconclusive opt-in |
| `unsupported_module_version` | inconclusive |
| `unsupported_module_kind` | inconclusive |
| `invalid_module_document` | failed |
| `invalid_relation_token` | failed |
| `invalid_cardinality_container` | failed |
| `target_identity_mismatch` | failed |
| `duplicate_target` | failed |
| `collection_context_mismatch` | failed |
| `collection_checksum_mismatch` | failed |
| `duplicate_registry_token` | failed |
| `registry_checksum_mismatch` | failed |
| `symmetric_inverse_mismatch` | failed |
| `cursor_cycle` | partial/inconclusive |
| `graph_cycle` | partial/inconclusive |
| `traversal_budget_exceeded` | partial/inconclusive |
| `traversal_aborted` | partial/inconclusive |
| `blocked_url` | failed or partial, depending on the edge requirement |
| `credential_scope_blocked` | failed or partial, depending on the edge requirement |
| `unauthorized` | failed or partial, depending on the edge requirement |
| `forbidden` | failed or partial, depending on the edge requirement |

An issue MUST carry the check ID, the document URL/path, the module
ID/version/kind, and the source/target ID when available.

## Normative fixture catalog

Valid fixtures:

| Fixture | Primary expected check ID | Expected result |
|---|---|---|
| `relations-valid-one` | `relations.schema.relation_set` | passed |
| `relations-valid-inline-many` | `relations.semantic.cardinality` | passed |
| `relations-valid-empty-inline-many` | `relations.semantic.cardinality` | passed |
| `relations-valid-collection-first-page` | `relations.collection.pagination` | passed |
| `relations-valid-collection-last-page` | `relations.collection.pagination` | passed |
| `relations-valid-vendor-token` | `relations.semantic.tokens` | passed |
| `relations-valid-empty-collection` | `relations.schema.collection` | passed |
| `relations-valid-registry` | `relations.schema.registry` | passed |

Invalid fixtures:

| Fixture | Expected check ID | Expected issue code |
|---|---|---|
| `relations-invalid-wrapper-version` | `relations.schema.relation_set` | `invalid_module_document` |
| `relations-invalid-unknown-field` | `relations.schema.relation_set` | `invalid_module_document` |
| `relations-invalid-one-with-targets` | `relations.semantic.cardinality` | `invalid_cardinality_container` |
| `relations-invalid-many-with-both-containers` | `relations.semantic.cardinality` | `invalid_cardinality_container` |
| `relations-invalid-many-without-container` | `relations.semantic.cardinality` | `invalid_cardinality_container` |
| `relations-invalid-inline-over-limit` | `relations.semantic.cardinality` | `invalid_cardinality_container` |
| `relations-invalid-token` | `relations.semantic.tokens` | `invalid_relation_token` |
| `relations-invalid-id-type-prefix` | `relations.semantic.target_identity` | `target_identity_mismatch` |
| `relations-invalid-duplicate-target` | `relations.semantic.duplicate_target` | `duplicate_target` |
| `relations-invalid-collection-context` | `relations.collection.context` | `collection_context_mismatch` |
| `relations-invalid-checksum` | `relations.collection.checksum` | `collection_checksum_mismatch` |
| `relations-invalid-registry-duplicate-token` | `relations.registry.unique_token` | `duplicate_registry_token` |
| `relations-invalid-registry-checksum` | `relations.registry.checksum` | `registry_checksum_mismatch` |
| `relations-invalid-registry-token` | `relations.semantic.tokens` | `invalid_relation_token` |
| `relations-invalid-registry-symmetric-mismatch` | `relations.registry.symmetric` | `symmetric_inverse_mismatch` |
| `relations-invalid-registry-symmetric-missing-inverse` | `relations.registry.symmetric` | `symmetric_inverse_mismatch` |

Traversal/security fixtures:

| Fixture | Expected check ID | Expected issue/result |
|---|---|---|
| `relations-cursor-cycle` | `relations.traversal.cycle` | `cursor_cycle` |
| `relations-graph-cycle` | `relations.traversal.cycle` | `graph_cycle` |
| `relations-budget-depth` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-budget-node` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-budget-request` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-budget-byte` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-budget-deadline` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-cross-origin-cap` | `relations.traversal.budget` | `traversal_budget_exceeded` |
| `relations-ssrf-private-target` | `relations.security.url_policy` | `blocked_url` |
| `relations-cross-origin-credential-strip` | `relations.security.credentials` | passed |
| `relations-private-social-graph-omitted` | `relations.privacy.social_graph` | passed |

Each row locks the primary check only; fixture metadata MAY declare additional
related check IDs. A fixture becomes a normative vector once its payload,
schema, expected result and expected issue/check ID are reviewed together. Do
not use Ailmao domain data.

## Profiles

- `relations-core`: discovery, schema and pure semantics; no traversal.
- `relations-full`: resolution, pagination, caching and bounded traversal.
- `relations-authenticated`: the full profile with an explicit test credential provider.

A report MUST record the profile, the core/module/package versions and the effective limits.

## Neutral implementation gate

A neutral implementation uses only the published spec, schemas, fixtures and
public exports; imports nothing from `src/**`; distinguishes skipped and
inconclusive from passed; and runs from a clean tarball installation.

## Release gate

- The stable IDs and the fixture catalog are fully implemented.
- Core check IDs and results show no regression.
- JSON and JUnit output carry module metadata and provenance.
- The clean-install runner, the neutral implementation and the security review are green.

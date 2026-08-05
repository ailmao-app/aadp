# AADP Relations Module v1.0 — Conformance Contract

## Thông tin

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | Accepted implementation contract |
| Module | `aadp:relations@1.0` |
| Owner | AADP maintainers |
| Normative source | [`specification.md`](specification.md) |

## Runner boundary

`runRelationsConformance(options)` export từ
`ail-aadp/modules/relations/v1.0`. Runner dùng chung report/execution utilities
nhưng có suite riêng; core `CHECKS` và IDs MUST không đổi.

## Stable check IDs

| Check ID | Ý nghĩa |
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

Released check IDs là stable machine contract.

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
| `blocked_url` | failed hoặc partial theo edge requirement |
| `credential_scope_blocked` | failed hoặc partial theo edge requirement |
| `unauthorized` | failed hoặc partial theo edge requirement |
| `forbidden` | failed hoặc partial theo edge requirement |

Issue MUST có check ID, document URL/path, module ID/version/kind và source/target
ID khi có.

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

Mỗi hàng chỉ khóa primary check; fixture metadata MAY khai báo thêm check IDs liên
quan. Fixture trở thành normative vector khi payload, schema, expected result và
expected issue/check ID được review cùng nhau. Không dùng Ailmao domain data.

## Profiles

- `relations-core`: discovery/schema/pure semantics, không traverse.
- `relations-full`: resolution, pagination, cache, bounded traversal.
- `relations-authenticated`: full với explicit test credential provider.

Report MUST ghi profile, core/module/package versions và effective limits.

## Neutral implementation gate

Neutral implementation chỉ dùng published spec/schema/fixtures/public exports,
không import `src/**`, phân biệt skipped/inconclusive với passed và chạy từ clean
tarball installation.

## Release gate

- Stable IDs và fixture catalog được implement đầy đủ.
- Core check IDs/results không regression.
- JSON/JUnit có module metadata và provenance.
- Clean-install runner, neutral implementation và security review xanh.

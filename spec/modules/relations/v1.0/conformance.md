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
| `relations.semantic.cardinality` | Cardinality/container |
| `relations.semantic.tokens` | Standard/vendor tokens |
| `relations.semantic.target_identity` | ID prefix/type |
| `relations.collection.context` | Source/rel/type context |
| `relations.collection.pagination` | Cursor termination/context |
| `relations.collection.checksum` | Canonical items checksum |
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
| `collection_context_mismatch` | failed |
| `collection_checksum_mismatch` | failed |
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

- `relations-valid-one`
- `relations-valid-inline-many`
- `relations-valid-empty-inline-many`
- `relations-valid-collection-first-page`
- `relations-valid-collection-last-page`
- `relations-valid-vendor-token`
- `relations-valid-empty-collection`
- `relations-valid-registry`

Invalid fixtures:

- `relations-invalid-wrapper-version`
- `relations-invalid-unknown-field`
- `relations-invalid-one-with-targets`
- `relations-invalid-many-with-both-containers`
- `relations-invalid-many-without-container`
- `relations-invalid-inline-over-limit`
- `relations-invalid-token`
- `relations-invalid-id-type-prefix`
- `relations-invalid-duplicate-target`
- `relations-invalid-collection-context`
- `relations-invalid-checksum`
- `relations-invalid-registry-duplicate-token`
- `relations-invalid-registry-checksum`

Traversal/security fixtures:

- `relations-cursor-cycle`
- `relations-graph-cycle`
- `relations-budget-depth`
- `relations-budget-node`
- `relations-budget-request`
- `relations-budget-byte`
- `relations-budget-deadline`
- `relations-cross-origin-cap`
- `relations-ssrf-private-target`
- `relations-cross-origin-credential-strip`
- `relations-private-social-graph-omitted`

Fixture trở thành normative vector khi payload, schema, expected result và expected
issue/check ID được review cùng nhau. Không dùng Ailmao domain data.

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

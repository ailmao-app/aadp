# ADR-0007: Versioning, discovery and package boundary for AADP Modules

## Status

Accepted — applies from the `ail-aadp@1.2.0` package plan onward.

## Context

AADP v1.0 lets a manifest declare `modules[]`, but it never locked down the
relationship between package version, core protocol version and module version.
The Relations Module is the first standard module and must set a reusable
precedent for every module after it.

## Decision

### Version domains

Three independent version domains:

```text
ail-aadp@1.2.0          npm package version
aadp_version: "1.0"    core protocol version
aadp:relations@1.0      module wire version
```

A package bump MUST NOT change the core or module version by itself. A module
major means an incompatible wire change; a minor adds compatible optional
contract; a patch only fixes the implementation and does not change the set of
accepted payloads. Released artifacts are immutable.

### Module ID and discovery

A module ID MUST match `^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$`. The `aadp`
namespace is reserved for standard AADP modules; a vendor MUST use a namespace
it owns.

Manifest v1.0 uses only the released contract:

```json
{
  "modules": [
    {
      "id": "aadp:relations",
      "version": "1.0",
      "schema": "https://aadp.dev/schemas/modules/relations/v1.0/module.schema.json"
    }
  ]
}
```

A server MUST advertise a module only once its endpoints and artifacts are
deployed and pass module conformance. Do not add unnamespaced fields such as
`registry` to a declaration. The `schema` field MUST point at the dispatch
schema for the module's top-level documents. The discovery entry
`{id, version, schema}` continues to be validated by the core manifest schema;
a module schema MUST NOT take over that role.

### Registry lookup

The registry exact-matches `{moduleId, moduleVersion, kind}` and MUST
distinguish:

- `unsupported_module`;
- `unsupported_module_version`;
- `unsupported_module_kind`;
- `invalid_module_document`.

The registry MUST NOT fall back to a different version.

### Envelope boundary

Core entity v1.0 stays immutable. An inline module payload uses the root
entity's `x_*` extension point; Relations uses `x_relations`, never a field
inside the application's `data`.

A standalone module document MUST self-describe its `aadp_version`, module ID,
module version and document kind. A core-only consumer MUST ignore an
unsupported module without fetching that module's schema or endpoints. An
opt-in consumer MUST report the unsupported state explicitly.

### Package exports

Module APIs and schemas live under versioned subpaths:

```text
ail-aadp/modules/<module-name>/v<module-version>
ail-aadp/schemas/modules/<module-name>/v<module-version>/*
```

Relations uses `ail-aadp/modules/relations/v1.0` and
`ail-aadp/schemas/modules/relations/v1.0/*`. A module API MUST NOT be
re-exported from the package root. Tarball tests MUST NOT import `src/**`.

### Conformance boundary

Core checks and stable core check IDs do not change when a module is added.
Each module has its own runner and check suite, but MAY share the report shape,
HTTP policy and execution utilities.

## Consequences

- The module registry sits outside the closed core schema registry.
- Module clients use shared infrastructure rather than duplicating HTTP, URL or
  budget handling.
- Core-only consumers stay compatible with manifest/entity v1.0.
- The public surface grows through versioned subpaths instead of the package
  root.

## References

- [AADP v1.0 specification](../../spec/v1.0/specification.md)
- [ADR-0004](0004-backward-compatibility.md)
- [Relations Module v1.0 specification](../../spec/modules/relations/v1.0/specification.md)
- [Implementation plan 1.2.0](../vi/plans/implementation-plan-v1.2.0.md)

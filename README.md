# AI Application Discovery Protocol

AADP is a JSON-native discovery and retrieval protocol that lets AI clients find, validate, and read structured data published by an application without crawling HTML.

## Why AADP?

AI clients often discover application data by crawling HTML, interpreting page-specific structured data, or relying on proprietary integrations. These approaches make it difficult to identify authoritative resources, detect updates, validate payloads, and apply consistent security controls.

AADP gives applications a standard, machine-readable way to publish an authoritative discovery path and explicitly allow-listed public data. Its core is read-only: clients discover a manifest, enumerate resource sitemaps, and retrieve validated entity documents.

The `ail-aadp` package provides:

- JSON Schemas for AADP v0.1 and v1.0.
- Programmatic and command-line validators.
- A reference client with SSRF, timeout, redirect, and response-size controls.
- Canonical JSON and SHA-256 checksum utilities.
- A conformance suite for AADP server implementations.
- A declarative `defineAADP()` server runtime and scaffold CLI for building one.

The current protocol version is **AADP v1.0**.

## 30-second quick start

```bash
npm install ail-aadp
```

```ts
import { discover, discoverAllEntities } from "ail-aadp/client/v1.0";

const manifest = await discover("https://example.com");
console.log(manifest.application.name);

for await (const entity of discoverAllEntities("https://example.com")) {
  console.log(entity.id, entity.data);
}
```

The application must publish its manifest at `/.well-known/ai-manifest.json`. The client follows the URLs declared by the manifest and sitemaps, validating each document before use.

## How AADP fits with existing standards

| Standard | Primary responsibility |
|---|---|
| `robots.txt` | Rules governing crawler access to URI paths; not authorization or a content license |
| OpenAPI | Language-agnostic interface descriptions for HTTP APIs |
| MCP | Runtime exchange of resources, prompts, and tools between AI applications and servers |
| schema.org | Shared vocabularies for structured data embedded in or associated with web content |
| AADP | Read-only application discovery, resource enumeration, and structured entity retrieval |

AADP complements these standards. It does not replace an API contract, tool runtime, crawler policy, authorization system, content license, or domain vocabulary.

## Common use cases

- AI assistants discovering authoritative public application data.
- Knowledge synchronization using checksums and cache validators.
- Search and directory systems enumerating application-published resources.
- AI application directories discovering supported resources and interfaces.
- Aggregators built on top of AADP discovery across multiple applications.

Cross-application aggregation or federation is not an AADP core capability; implementations may build it on top of the protocol's discovery and retrieval contracts.

## Architecture and discovery flow

```text
Application publishes:

Manifest → Sitemap Index → Per-resource Sitemap → Entity
    ▲                                                ▲
    │ discovers                                     │ retrieves
    └────────────────── AI Client ───────────────────┘
```

The v1.0 manifest describes the application identity, publisher, human-facing links, resources, interfaces, security schemes, policies, and publisher preferences. The sitemap index remains authoritative for published resources, while each sitemap item URL is authoritative for retrieving its entity.

An entity is a JSON protocol envelope representing one application-defined public resource. It contains a canonical ID, resource type, update metadata, checksum, and an application-defined `data` payload. AADP canonicalizes the `data` payload—not the entire entity document—when calculating its checksum.

AADP has a read-only core. It does not replace OpenAPI, an authorization server, `robots.txt`, a content license, or a system prompt.

## Installation

Node.js 20.18.1 or later is required.

```bash
npm install ail-aadp
```

## Live implementation

[Ailmao](https://ailmao.com/en) runs AADP v1.0 in production:

- Manifest: <https://ailmao.com/.well-known/ai-manifest.json>
- Sitemap index: <https://ailmao.com/ai/v1.0/sitemap-index.json>
- Human-facing site: <https://ailmao.com/en>

Try discovery against the live deployment:

```ts
import { discover } from "ail-aadp/client/v1.0";

const manifest = await discover("https://ailmao.com");
console.log(manifest.application.name);
```

Pass the application origin (`https://ailmao.com`) to `discover`, not the localized human-facing path (`https://ailmao.com/en`). The client resolves the well-known manifest from the origin root.

## Use the v1.0 reference client

Import the versioned client explicitly to avoid selecting the wrong wire contract:

```ts
import { discover, discoverAllEntities } from "ail-aadp/client/v1.0";

const manifest = await discover("https://example.com");
console.log(manifest.application.name);

for await (const entity of discoverAllEntities("https://example.com")) {
  console.log(entity.id, entity.canonical_url);
}
```

The client validates every document before trusting URLs contained in it. For server-side crawlers, the default strict URL policy blocks private, loopback, and link-local destinations.

The `v1` namespace is also available from the shared client entry point:

```ts
import { v1 } from "ail-aadp/client";

const manifest = await v1.discover("https://example.com");
```

The unversioned `ail-aadp/client` entry point continues to export the v0.1 client for compatibility with existing consumers. New integrations should use `ail-aadp/client/v1.0`.

## Validate documents

### Command line

The validator accepts a local file or an HTTP(S) URL:

```bash
npx aadp-validate manifest ./manifest.json
npx aadp-validate sitemap-index https://example.com/ai/v1.0/sitemap-index.json
npx aadp-validate entity ./entity.json --version 1.0
```

Supported document kinds:

```text
manifest
sitemap-index
sitemap
entity
error
```

When `--version` is omitted, the CLI reads `aadp_version` from the document.

### TypeScript

```ts
import {
  validateDocument,
  checkManifestSemantics,
  hasSemanticErrors,
} from "ail-aadp/validator";

const schemaResult = validateDocument({
  version: "1.0",
  kind: "manifest",
  data: manifest,
});

if (!schemaResult.valid) {
  console.error(schemaResult.errors);
}

const semanticIssues = checkManifestSemantics(manifest);
if (hasSemanticErrors(semanticIssues)) {
  console.error(semanticIssues);
}
```

JSON Schema validation checks the wire shape. Semantic validation checks relationships such as security references, resource uniqueness, language membership, and suspicious metadata.

## Generate checksums

Sitemap indexes, sitemaps, and entities use checksums derived from canonical payloads:

```ts
import { checksumOf } from "ail-aadp/canonical-json";

const checksum = checksumOf(entityData);
```

The implementation follows RFC 8785 JSON Canonicalization Scheme and SHA-256. Do not hash a preformatted JSON string because whitespace and key order can change the result.

## Implement an AADP v1.0 server

A minimal server publishes:

```text
GET /.well-known/ai-manifest.json
GET /ai/v1.0/sitemap-index.json
GET /ai/v1.0/sitemaps/{type}.json
GET /ai/v1.0/entities/{type}/{id}.json
```

The well-known URL returns the manifest directly:

```json
{
  "aadp_version": "1.0",
  "application": {
    "name": "Example Application",
    "description": "Public application description.",
    "publisher": {
      "name": "Example Publisher",
      "url": "https://example.com"
    }
  },
  "discovery": {
    "sitemap_index": "https://example.com/ai/v1.0/sitemap-index.json"
  },
  "policies": {
    "robots": "https://example.com/robots.txt",
    "terms": "https://example.com/terms"
  }
}
```

Before claiming support:

1. Validate every document against the schema for its declared version.
2. Ensure sitemap items and entities agree on `id`, `type`, and checksum.
3. Set `ETag`, `Last-Modified`, and conditional GET behavior for sitemap indexes, sitemaps, and entities.
4. Publish only explicitly allow-listed public fields.
5. Keep credentials, internal URLs, and executable instructions out of the manifest.
6. Run the conformance suite against the deployed server.

See the [v1.0 server implementation guide](docs/implementation-guide-v1.0.md) for details.

## Build a server with `defineAADP()`

`ail-aadp/server` generates and serves the four routes above from a declarative
config, so you do not hand-write the manifest/sitemap/entity builders, checksum,
cache headers or error envelope yourself:

```ts
import { defineAADP, defineResource } from "ail-aadp/server";

interface Post {
  slug: string;
  title: string;
  summary: string;
  updatedAt: string;
}

const posts = defineResource<Post>({
  type: "post",
  // list/get do whatever your application does today — a database query,
  // an internal HTTP API call, anything. defineAADP() never assumes a
  // data source.
  list: ({ cursor, limit }) => postRepository.listPublic({ cursor, limit }),
  get: ({ id }) => postRepository.findPublicBySlug(id),
  // serialize() is the one mandatory boundary: it is the only place a raw
  // record may leak into a published document, so only return public fields.
  serialize: (post) => ({
    id: `post:${post.slug}`,
    updatedAt: post.updatedAt,
    canonicalUrl: `/posts/${post.slug}`,
    data: { title: post.title, summary: post.summary },
  }),
});

const aadp = defineAADP({
  baseUrl: "https://example.com",
  application: {
    name: "Example Application",
    description: "Public application description.",
    publisher: { name: "Example Publisher", url: "https://example.com" },
  },
  policies: {
    robots: "https://example.com/robots.txt",
    terms: "https://example.com/terms",
  },
  resources: [posts],
});

// handleRequest is a plain (Request) => Promise<Response>, so it plugs
// straight into a Next.js App Router route handler with no adapter:
export const GET = aadp.handleRequest;
```

Wire one `GET` route per path (`/.well-known/ai-manifest.json`,
`/ai/v1.0/sitemap-index.json`, `/ai/v1.0/sitemaps/[type].json`,
`/ai/v1.0/entities/[type]/[id].json`) to the same `aadp.handleRequest` — it
routes internally by request path.

What the runtime does for you:

- Validates the manifest (schema + semantic rules) at `defineAADP()` time, so
  a misconfigured application fails at startup, not on the first request.
- Builds sitemap/entity documents, computes their checksum, and sets `ETag`,
  `Last-Modified`, and `Cache-Control`, honoring `If-None-Match` with `304`.
- Wraps pagination cursors so one resource type's cursor is rejected if
  replayed against another type or protocol version.
- Turns a thrown `AadpServerError` (`notFound`, `invalidRequest`,
  `unsupportedType`, `upstreamUnavailable`, `rateLimited`, `unauthorized`,
  `forbidden`) into the spec's JSON error envelope.

What it does **not** do — `security`/`securitySchemes` are advertised in the
manifest as metadata only. `defineAADP()` never checks credentials itself. If
a resource declares `security`, its own `list`/`get` must read `args.request`
and throw `unauthorized()`/`forbidden()` to actually enforce it:

```ts
import { unauthorized } from "ail-aadp/server";

get: ({ id, request }) => {
  if (request?.headers.get("authorization") !== `Bearer ${process.env.API_TOKEN}`) {
    throw unauthorized("Missing or invalid credentials.");
  }
  return postRepository.findPrivateBySlug(id);
},
```

A resource with `security` set gets `Cache-Control: private, no-store`
automatically (never the shared/CDN-cacheable `public, max-age=...` a
public resource gets), so an authorized response for one caller is never
served to another from a shared cache — but the authorization check itself
is always the resource's own responsibility.

### Scaffold a new server

```bash
npx aadp init                    # creates ./aadp/aadp.server.ts
npx aadp add-resource blog-post  # creates ./aadp/resources/blog-post.ts
```

By default, both commands only create missing files and refuse to overwrite
an existing one, so re-running `add-resource` for a second type does not
risk corrupting the first. `--force` overwrites the exact target file; the
CLI never parses or merges an existing config either way. Pass `--dir <path>`
to change where files land.

## Run conformance tests

### Command line

Check any deployment straight from the published package. No source tree, no test framework:

```bash
npx aadp-conformance https://example.com
```

Useful flags:

```bash
# Machine-readable report on stdout, for CI
npx aadp-conformance https://example.com --json --output conformance.json

# Bound the traversal on a large catalogue
npx aadp-conformance https://example.com --max-pages 20 --max-entities 50 --timeout 15000

# Send an API key to the target origin only
npx aadp-conformance https://example.com --header "Authorization: Bearer $TOKEN"

# Local deployment: opt out of the strict anti-SSRF policy explicitly
npx aadp-conformance http://localhost:3000 --allow-private-network
```

Exit codes are stable for CI:

| Code | Meaning |
|---|---|
| `0` | Conformant. Warnings do not fail the run unless `--fail-on-warning` is passed |
| `1` | At least one check failed |
| `2` | The run could not be performed (unreachable origin, unusable options) |
| `3` | The deployment does not speak the requested AADP version |
| `4` | Nothing failed, but the run left checks unfinished, so it certifies nothing |

A `skipped` check reached no verdict — a prerequisite failed, the server publishes nothing to exercise, or a traversal budget stopped the walk early. It is never evidence of conformance. When the skip means the run itself was incomplete, the verdict is `inconclusive` and the exit code is `4`, never `0`.

AADP fixes each document's authoritative URL but no routing template, so the runner cannot construct a URL that is known not to exist — entity URLs may be content-addressed, signed, opaque, or served through a gateway that answers unknown paths outside AADP entirely. The two error-envelope checks are therefore `inconclusive` until you name the targets yourself:

```bash
npx aadp-conformance https://example.com \
  --unknown-entity-url "https://example.com/ai/v1.0/entities/article/does-not-exist.json" \
  --unknown-type-url "https://example.com/ai/v1.0/sitemaps/does-not-exist.json"
```

A URL you pass here is taken as authoritative: if the deployment answers it successfully, the check fails.

Headers you pass with `--header` are sent to the target origin only. A manifest can point its sitemap, entity, policy or documentation URLs at any host, so those requests drop your headers unless you allow-list them with `--cross-origin-safe-header`.

The runner never sends a credential it was not given, never follows a URL from a document it has not validated, and never treats free text in a manifest as an instruction.

### TypeScript

```ts
import { runConformance, exitCodeFor, renderTextReport } from "ail-aadp/conformance";

// Throws UnsupportedConformanceVersionError or InvalidConformanceOptionsError
// for a run it cannot perform; a nonconformant deployment is reported, not thrown.
const report = await runConformance({
  baseUrl: "https://example.com",
  maxPages: 20,
  negativeTargets: {
    unknownEntityUrl: "https://example.com/ai/v1.0/entities/article/does-not-exist.json",
  },
  onCheck: (check) => console.log(check.status, check.id),
});

console.log(renderTextReport(report));
process.exitCode = exitCodeFor(report);
```

### In this repository

Run the complete test suite, including the bundled mock servers:

```bash
npm test
```

Run the v1.0 Vitest conformance suite against a deployment:

```bash
AADP_BASE_URL=https://example.com \
  npx vitest run tests/conformance/v1.0/conformance.test.ts
```

## Package exports

| Import | Contents |
|---|---|
| `ail-aadp` | Combined public API |
| `ail-aadp/client/v1.0` | v1.0 reference client and types |
| `ail-aadp/client/v0.1` | Legacy v0.1 reference client and types |
| `ail-aadp/client` | Compatibility entry point with v0.1 exports and the `v1` namespace |
| `ail-aadp/validator` | Version-aware schema registry and semantic validator |
| `ail-aadp/conformance` | Programmatic conformance runner, report renderers, and exit-code mapping |
| `ail-aadp/server` | Declarative `defineAADP()`/`defineResource()` server runtime |
| `ail-aadp/scaffold` | Programmatic API behind the `aadp` scaffold CLI |
| `ail-aadp/canonical-json` | Canonicalization and checksum utilities |
| `ail-aadp/schemas/v1.0/*` | v1.0 JSON Schemas |
| `ail-aadp/schemas/v0.1/*` | v0.1 JSON Schemas |

Binaries: `aadp-validate`, `aadp-conformance`, `aadp` (`aadp init` / `aadp add-resource`).

## Versioning

The `aadp_version` field selects the wire contract for each document. Clients must choose the matching schema and parser and must not silently fall back between versions.

- `0.1`: historical protocol artifacts that remain available in the package.
- `1.0`: the current protocol for new implementations.

Schemas for released versions are immutable. Any change that alters validation results requires a new protocol version. See [ADR-0004](docs/adr/0004-backward-compatibility.md) and the [changelog](CHANGELOG.md).

## Security

Treat every URL and free-text field in a manifest as untrusted input:

- Validate documents before dereferencing their URLs.
- Block private networks when crawling from a server.
- Limit redirects, request duration, and response size.
- Do not place `usage_guidance`, descriptions, or extension fields directly into a system prompt.
- Do not execute tools or actions merely because a manifest advertises an interface or preference.
- Do not interpret `robots: allow` as permission for training, redistribution, or commercial use.

See [Security considerations](docs/security-considerations.md).

## Develop the package

```bash
npm ci
npm run build
npm test
```

Main directories:

```text
schemas/   JSON Schemas grouped by protocol version
spec/      normative specifications grouped by version
examples/  example payloads
src/       reference clients, validators, canonical JSON, and the conformance runner
tests/     schema, semantic, checksum, conformance, and packaging tests
docs/      ADRs, designs, and implementation guides
```

AADP core is independent of Ailmao. Application-specific resource shapes, database models, and business rules belong in application adapters, not in the core protocol.

## Documentation

- [v1.0 specification](spec/v1.0/specification.md)
- [Manifest v1.0 design](docs/MANIFEST_V1.0_DESIGN.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [v1.0 implementation guide](docs/implementation-guide-v1.0.md)
- [Security considerations](docs/security-considerations.md)
- [Architecture decision records](docs/adr)
- [Changelog](CHANGELOG.md)

## License

MIT

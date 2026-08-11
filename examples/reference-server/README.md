# AADP reference server example

A neutral, third-party AADP v1.0 deployment built entirely on `ail-aadp`'s
public API (`defineAADP()`, `defineResource()`, `handleRequest()`). It exists
to prove the package works for an independent consumer installing from a
tarball, not as a framework adapter or a starter template — it uses
`node:http` and the Fetch API, nothing else.

Layers, kept separate on purpose:

- `src/data/example-repository.js`, `src/data/answer-repository.js`,
  `src/data/evidence-repository.js` — sample data access. Stands in for a
  database or internal API.
- `src/resources/example-resource.js` — the `note` resource's serializer, the
  one allow-list boundary between a raw record and the published document.
- `src/resources/answer-resource.js` — the `answer` resource, which publishes
  the Answer Module `1.0` wrapper (`x_answer`) through the server's generic
  extension support.
- `src/resources/evidence-resource.js` — the `claim` and `evidence` resources,
  publishing Evidence Module `1.0` wrappers (`x_evidence`) through the same
  generic support. One evidence record is served only to an authorized caller,
  which is how a citation walk produces a `forbidden` outcome rather than a
  dangling reference.
- `src/resources/module-schemas.js` — serves the Evidence `1.0` schema
  artifacts this deployment's manifest points at. A manifest must never
  advertise a `modules[].schema` an agent cannot fetch, and Evidence `1.0` is
  not published on `aadp.dev` yet.
- `src/aadp.js` — the `defineAADP()`/`defineResource()` composition.
- `src/server.js` — the HTTP entry point. Only starts the server and maps
  `node:http` request/response to the Fetch `Request`/`Response` the runtime
  expects.

## Run it

From a real consumer install (not this repo's workspace):

```bash
cd /path/to/aadp
npm run build
npm pack
cd examples/reference-server
npm install ../../ail-aadp-<version>.tgz
npm run start
```

The server prints the port it bound and the manifest URL. By default:

```
http://127.0.0.1:<port>/.well-known/ai-manifest.json
```

Set `AADP_CUSTOM_ROUTES=1` to serve the same resource under the custom
`routes` templates configured in `src/aadp.js` (`/discovery/index.json`,
`/discovery/sitemaps/{type}.json`, `/discovery/entities/{type}/{id}.json`
instead of the default `/ai/v1.0/...` convention) — same composition,
different publish location.

Set `AADP_BASE_URL` (e.g. `https://example.com`) when running behind a
reverse proxy or under a real domain — every URL the manifest, sitemaps and
entities publish is built from this origin, resolved once at startup. It is
never taken from an inbound request's `Host` header, which a caller
controls: trusting it would let any request permanently repoint every
published discovery URL at whatever origin it named. Without it, the
published origin defaults to the address `listen()` actually bound
(`http://127.0.0.1:<port>`), correct for local/dev use only. When the two
differ the server prints both — the origin it publishes, and the `Bound to`
address it can actually be reached at.

## Modules

The deployment publishes four resource types:

- `note` — core AADP only, no module payload.
- `answer` — the same core entity plus an `x_answer` wrapper
  ([Answer Module `1.0`](../../spec/modules/answer/v1.0/specification.md)).
- `claim` and `evidence` — core entities plus an `x_evidence` wrapper
  ([Evidence Module `1.0`](../../spec/modules/evidence/v1.0/specification.md)).

Every one of them is emitted through the same `SerializedEntity.extensions`
field. The runtime never knows which module produced a payload; the manifest
declares `aadp:answer@1.0` and `aadp:evidence@1.0` in `modules[]` only because
this deployment actually serves them.

The citation graph is deliberately more than one happy path:

- the answer `what-uptime-did-orbit-report` cites the claim
  `orbit-uptime-2026` through `related_entities` — two hops, answer → claim →
  evidence, with `x_answer` itself unchanged;
- that claim cites two evidence documents with **opposing stances**
  (`support` and `contradict`);
- a second claim cites one of the same evidence documents (**fan-in**): one
  canonical node, two edges, one fetch per walk;
- `orbit-status-report` was **retrieved before it was last updated**, which
  exercises `retrieved_at <= updated_at` as an ordering rather than an
  equality;
- `orbit-embargoed-filing` is served only to an authorized caller, so a walk
  reaching it reports `forbidden` — a valid outcome of a healthy graph, not a
  dangling reference. It is deliberately absent from the sitemap, which
  advertises only what an anonymous agent can fetch.

Both modules require an absolute **HTTPS** `canonical_url`, so run with
`AADP_BASE_URL=https://…` when the answer, claim and evidence entities are
meant to validate. Over the plain-HTTP local default they still serve, but
`validateAnswerEntityV1`/`validateEvidenceEntityV1` will reject their
canonical URL.

## Validate and check conformance

With the server running:

```bash
npx aadp-validate http://localhost:<port>/.well-known/ai-manifest.json
npx aadp-conformance http://localhost:<port> --allow-private-network
```

`aadp-conformance` exits `0` for a conformant deployment. See the root
package's `docs/` for the meaning of non-zero exit codes.

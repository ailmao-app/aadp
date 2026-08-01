# AADP reference server example

A neutral, third-party AADP v1.0 deployment built entirely on `ail-aadp`'s
public API (`defineAADP()`, `defineResource()`, `handleRequest()`). It exists
to prove the package works for an independent consumer installing from a
tarball, not as a framework adapter or a starter template — it uses
`node:http` and the Fetch API, nothing else.

Layers, kept separate on purpose:

- `src/data/example-repository.js` — sample data access. Stands in for a
  database or internal API.
- `src/resources/example-resource.js` — the resource's serializer, the one
  allow-list boundary between a raw record and the published document.
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

## Validate and check conformance

With the server running:

```bash
npx aadp-validate http://localhost:<port>/.well-known/ai-manifest.json
npx aadp-conformance http://localhost:<port> --allow-private-network
```

`aadp-conformance` exits `0` for a conformant deployment. See the root
package's `docs/` for the meaning of non-zero exit codes.

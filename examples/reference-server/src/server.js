import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { buildAadpServer } from "./aadp.js";

/**
 * `defineAADP()` returns a plain `(Request) => Promise<Response>` — no
 * framework adapter needed. `node:http` predates the Fetch API, so this is
 * the one piece of glue an application on Node's raw HTTP server (rather
 * than Next.js or another Fetch-native runtime) has to write itself.
 */
async function toFetchRequest(req, baseUrl) {
  const url = new URL(req.url ?? "/", baseUrl);
  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) chunks.push(chunk);
  }
  return new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([key, value]) =>
      value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((v) => [key, v])
    ),
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}

async function writeFetchResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
  res.end(body);
}

function staticText(body) {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * `baseUrl` is the *publish* origin — every URL the manifest, sitemaps and
 * entities advertise is built from it. It MUST come from trusted
 * configuration (an explicit option/env var, or the address `listen()`
 * actually bound), never from an inbound request's `Host` header: `Host`
 * is attacker-controlled, and building `aadp` from it — worse, caching
 * that instance for the process's lifetime — would let the first request
 * permanently repoint every published discovery URL at whatever origin it
 * named.
 */
export function startReferenceServer({
  host = "127.0.0.1",
  port = 0,
  useCustomRoutes = false,
  baseUrl,
} = {}) {
  const server = createServer((req, res) => {
    toFetchRequest(req, publishedBaseUrl)
      .then(async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/robots.txt") return staticText("User-agent: *\nAllow: /\n");
        if (url.pathname === "/terms") return staticText("Example terms of use.\n");
        return aadp.handleRequest(request);
      })
      .then((response) => writeFetchResponse(response, res))
      .catch((error) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`Internal error: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  // Populated once `listen()` resolves, before any request is served.
  let publishedBaseUrl;
  let aadp;

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      // An explicit `baseUrl` (e.g. the public domain a reverse proxy
      // fronts this server with) always wins; otherwise fall back to the
      // address actually bound, for local/dev use.
      publishedBaseUrl = baseUrl ?? `http://${host}:${resolvedPort}`;
      aadp = buildAadpServer(publishedBaseUrl, { useCustomRoutes });
      resolve({ server, baseUrl: publishedBaseUrl });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ? Number(process.env.PORT) : 0;
  const useCustomRoutes = process.env.AADP_CUSTOM_ROUTES === "1";
  // Set this when running behind a reverse proxy or under a real domain —
  // otherwise the published origin defaults to the address bound above.
  const baseUrl = process.env.AADP_BASE_URL;
  const { baseUrl: resolvedBaseUrl } = await startReferenceServer({ port, useCustomRoutes, baseUrl });
  console.log(`AADP reference server listening on ${resolvedBaseUrl}`);
  console.log(`Manifest: ${resolvedBaseUrl}/.well-known/ai-manifest.json`);
}

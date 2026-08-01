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

export function startReferenceServer({ host = "127.0.0.1", port = 0, useCustomRoutes = false } = {}) {
  let aadp;

  const server = createServer((req, res) => {
    const baseUrl = `http://${req.headers.host ?? `${host}:${port}`}`;
    toFetchRequest(req, baseUrl)
      .then(async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/robots.txt") return staticText("User-agent: *\nAllow: /\n");
        if (url.pathname === "/terms") return staticText("Example terms of use.\n");
        aadp ??= buildAadpServer(baseUrl, { useCustomRoutes });
        return aadp.handleRequest(request);
      })
      .then((response) => writeFetchResponse(response, res))
      .catch((error) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(`Internal error: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolve({ server, baseUrl: `http://${host}:${resolvedPort}` });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ? Number(process.env.PORT) : 0;
  const useCustomRoutes = process.env.AADP_CUSTOM_ROUTES === "1";
  const { baseUrl } = await startReferenceServer({ port, useCustomRoutes });
  console.log(`AADP reference server listening on ${baseUrl}`);
  console.log(`Manifest: ${baseUrl}/.well-known/ai-manifest.json`);
}

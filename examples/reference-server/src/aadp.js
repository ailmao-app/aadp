import { defineAADP } from "ail-aadp/server";
import { noteResource } from "./resources/example-resource.js";

/**
 * Builds the AADP server for one origin. Same resource, same document
 * builder either way — `useCustomRoutes` only swaps where the discovery
 * documents are published, to demonstrate `AadpServerConfig.routes`
 * without duplicating the composition.
 */
export function buildAadpServer(baseUrl, { useCustomRoutes = false } = {}) {
  return defineAADP({
    baseUrl,
    application: {
      name: "AADP Reference Server Example",
      description: "A neutral, third-party AADP v1.0 deployment built with ail-aadp/server.",
      publisher: { name: "AADP Reference Server Example", url: baseUrl },
    },
    policies: {
      robots: `${baseUrl}/robots.txt`,
      terms: `${baseUrl}/terms`,
    },
    resources: [noteResource],
    routes: useCustomRoutes
      ? {
          sitemapIndex: "/discovery/index.json",
          sitemap: "/discovery/sitemaps/{type}.json",
          entity: "/discovery/entities/{type}/{id}.json",
        }
      : undefined,
  });
}

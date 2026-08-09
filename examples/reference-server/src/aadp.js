import { defineAADP } from "ail-aadp/server";
import { noteResource } from "./resources/example-resource.js";
import { createAnswerResource } from "./resources/answer-resource.js";

const DEFAULT_ENTITY_ROUTE = "/ai/v1.0/entities/{type}/{id}.json";
const CUSTOM_ENTITY_ROUTE = "/discovery/entities/{type}/{id}.json";

/**
 * Builds the AADP server for one origin. Same resources, same document
 * builders either way — `useCustomRoutes` only swaps where the discovery
 * documents are published, to demonstrate `AadpServerConfig.routes`
 * without duplicating the composition.
 */
export function buildAadpServer(baseUrl, { useCustomRoutes = false } = {}) {
  const routes = useCustomRoutes
    ? {
        sitemapIndex: "/discovery/index.json",
        sitemap: "/discovery/sitemaps/{type}.json",
        entity: CUSTOM_ENTITY_ROUTE,
      }
    : undefined;

  // Answer references point at the note entities this same server publishes,
  // so they have to be built from the route config actually in effect — the
  // custom-routes run must not advertise default-route URLs.
  const entityRoute = routes?.entity ?? DEFAULT_ENTITY_ROUTE;
  const noteEntityUrl = (slug) =>
    new URL(entityRoute.replace("{type}", "note").replace("{id}", slug), baseUrl).toString();

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
    // Declared only because the `answer` resource below actually serves
    // `x_answer` documents — a manifest must never advertise a module the
    // deployment does not publish.
    modules: [
      {
        id: "aadp:answer",
        version: "1.0",
        schema: "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json",
      },
    ],
    resources: [noteResource, createAnswerResource({ noteEntityUrl })],
    routes,
  });
}

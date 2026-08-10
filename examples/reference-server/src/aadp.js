import { defineAADP } from "ail-aadp/server";
import { noteResource } from "./resources/example-resource.js";
import { createAnswerResource } from "./resources/answer-resource.js";
import { createClaimResource, createEvidenceResource } from "./resources/evidence-resource.js";
import { EVIDENCE_SCHEMA_PREFIX } from "./resources/module-schemas.js";

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

  // Cross-entity references point at entities this same server publishes, so
  // they have to be built from the route config actually in effect — the
  // custom-routes run must not advertise default-route URLs.
  const entityRoute = routes?.entity ?? DEFAULT_ENTITY_ROUTE;
  const entityUrl = (type, slug) =>
    new URL(entityRoute.replace("{type}", type).replace("{id}", slug), baseUrl).toString();
  const noteEntityUrl = (slug) => entityUrl("note", slug);
  const claimEntityUrl = (slug) => entityUrl("claim", slug);
  const evidenceEntityUrl = (slug) => entityUrl("evidence", slug);

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
    // Referenced by the `evidence` resource, one of whose records is served
    // only to an authorized caller. The scheme is advertised here; enforcing
    // it is the resource's own job.
    securitySchemes: {
      bearer: { type: "api_key", in: "header", name: "Authorization" },
    },
    // Declared only because the resources below actually serve `x_answer`
    // and `x_evidence` documents — a manifest must never advertise a module
    // the deployment does not publish.
    modules: [
      {
        id: "aadp:answer",
        version: "1.0",
        schema: "https://aadp.dev/schemas/modules/answer/v1.0/module.schema.json",
      },
      {
        id: "aadp:evidence",
        // Served by this deployment itself (`resources/module-schemas.js`)
        // rather than pointed at a canonical `aadp.dev` URL: a manifest must
        // not advertise a schema an agent cannot fetch, and a deployment
        // running a module version that is not published there yet has to
        // serve its own copy of the released artifacts.
        version: "1.0",
        schema: new URL(`${EVIDENCE_SCHEMA_PREFIX}module.schema.json`, baseUrl).toString(),
      },
    ],
    resources: [
      noteResource,
      createAnswerResource({ noteEntityUrl, claimEntityUrl }),
      createClaimResource({ evidenceEntityUrl }),
      createEvidenceResource(),
    ],
    routes,
  });
}

import { defineResource, forbidden } from "ail-aadp/server";
import { checksumOf } from "ail-aadp/canonical-json";
import { listClaims, findClaimBySlug, listEvidence, findEvidenceBySlug } from "../data/evidence-repository.js";

/**
 * Publishes the Evidence & Provenance Module `1.0` (`aadp:evidence`) on top
 * of the generic server support: `SerializedEntity.extensions` carries
 * `x_evidence`, and the runtime emits it without knowing this module exists.
 * Nothing here is `ail-aadp`-internal — the example only uses public
 * subpaths (`ail-aadp/server`, `ail-aadp/canonical-json`), the same way any
 * third party would.
 *
 * `evidenceEntityUrl` is injected rather than built here: an entity's
 * published URL depends on the deployment's `baseUrl` and route
 * configuration, both of which live in `aadp.js`. `serialize()` receives
 * only the record.
 */
export function createClaimResource({ evidenceEntityUrl }) {
  return defineResource({
    type: "claim",
    list: ({ cursor, limit }) => listClaims({ cursor, limit }),
    get: ({ id }) => findClaimBySlug(id),
    serialize: (claim) => {
      // Built without `content_checksum`, which is then computed over exactly
      // this object — the digest covers `x_evidence` minus itself.
      const xEvidence = {
        module: "aadp:evidence",
        version: "1.0",
        kind: "claim",
        statement: claim.statement,
        locale: "en",
        evidence_refs: claim.refs.map((ref) => ({
          // Constant by contract: a claim can cite only evidence, which is
          // what keeps the graph acyclic.
          target_type: "evidence",
          target: { id: `evidence:${ref.evidenceSlug}`, url: evidenceEntityUrl(ref.evidenceSlug) },
          stance: ref.stance,
          // Omitted entirely when the record declares none — "not declared"
          // is a distinct state from 0 and from 1.
          ...(ref.confidence === undefined ? {} : { confidence: ref.confidence }),
        })),
      };

      return {
        id: `claim:${claim.slug}`,
        updatedAt: new Date(claim.updatedAt).toISOString(),
        // Evidence 1.0 requires an absolute HTTPS `canonical_url`, so a
        // deployment publishing claims must run under an HTTPS `baseUrl`
        // (`AADP_BASE_URL`) — the same constraint the answer resource has.
        canonicalUrl: `/claims/${claim.slug}`,
        locale: "en",
        data: { statement: claim.statement },
        extensions: { x_evidence: { ...xEvidence, content_checksum: checksumOf(xEvidence) } },
      };
    },
  });
}

/**
 * The evidence resource declares a security scheme because one of its
 * records is only served to an authorized caller. Enforcement is this
 * resource's own job — `defineAADP()` never enforces `security` itself; the
 * declaration is what the manifest advertises.
 */
export function createEvidenceResource() {
  return defineResource({
    type: "evidence",
    security: "bearer",
    list: ({ cursor, limit }) => listEvidence({ cursor, limit }),
    get: ({ id, request }) => {
      const evidence = findEvidenceBySlug(id);
      if (evidence?.restricted && !isAuthorized(request)) {
        // A 403 is a valid outcome of a healthy graph: a claim citing this
        // record resolves to `forbidden`, NOT to a dangling reference.
        throw forbidden("This evidence record is under embargo.");
      }
      return evidence;
    },
    serialize: (evidence) => {
      const xEvidence = {
        module: "aadp:evidence",
        version: "1.0",
        kind: "evidence",
        summary: evidence.summary,
        locale: "en",
        source: {
          title: evidence.source.title,
          url: evidence.source.url,
          publisher: {
            name: evidence.source.publisherName,
            ...(evidence.source.publisherUrl ? { url: evidence.source.publisherUrl } : {}),
          },
          // Presentation metadata only: it tells a reader whether the source
          // is behind a paywall or a login. It grants nothing, and no
          // traversal or authorization decision reads it.
          access: evidence.source.access,
        },
        provenance: {
          published_at: new Date(evidence.publishedAt).toISOString(),
          ...(evidence.modifiedAt ? { modified_at: new Date(evidence.modifiedAt).toISOString() } : {}),
          retrieved_at: new Date(evidence.retrievedAt).toISOString(),
        },
        ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
      };

      return {
        id: `evidence:${evidence.slug}`,
        // Deliberately NOT derived from `retrievedAt`: the invariant is
        // `retrieved_at <= updated_at`, an ordering between two independent
        // events, not an equality.
        updatedAt: new Date(evidence.updatedAt).toISOString(),
        canonicalUrl: `/evidence/${evidence.slug}`,
        locale: "en",
        data: { summary: evidence.summary },
        extensions: { x_evidence: { ...xEvidence, content_checksum: checksumOf(xEvidence) } },
      };
    },
  });
}

/** Demo-only credential check — a real deployment would verify a real token. */
function isAuthorized(request) {
  return request?.headers?.get?.("authorization") === "Bearer reference-server-demo-token";
}

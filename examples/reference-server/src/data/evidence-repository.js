/**
 * Sample data access for the reference server's `claim` and `evidence`
 * resource types.
 *
 * Same rule as the note and answer repositories: this layer owns lookups
 * only. It stores plain application fields and knows nothing about the
 * Evidence Module wire format — building `x_evidence` is the serializer's
 * job, so the module contract stays in one place instead of leaking into
 * storage.
 *
 * The shape of this sample set is deliberate, so a conformance run against
 * this deployment exercises the contract rather than one happy path:
 *
 * - `orbit-status-report` is cited by TWO claims (fan-in): one evidence
 *   entity, fetched once per walk, two edges;
 * - `orbit-status-report` was RETRIEVED before it was last updated, so the
 *   `retrieved_at <= entity.updated_at` invariant is exercised as an
 *   ordering rather than an equality (a correction with no re-retrieval);
 * - `orbit-embargoed-filing` is served only to an authorized caller, so a
 *   walk produces a `forbidden` entry — a valid outcome of a healthy graph,
 *   not a dangling reference.
 */

const EVIDENCE = [
  {
    slug: "orbit-status-report",
    summary: "Annual status report published by Example Orbit.",
    excerpt: "Availability across the reporting period was 99.9 percent.",
    source: {
      title: "Orbit 2026 Status Report",
      url: "https://example.com/reports/2026-status",
      publisherName: "Example Orbit",
      publisherUrl: "https://example.com",
      access: "public",
    },
    publishedAt: "2026-01-15T00:00:00.000Z",
    retrievedAt: "2026-02-01T09:00:00.000Z",
    // Later than `retrievedAt`: the summary was corrected on this date
    // without re-fetching the source.
    updatedAt: "2026-03-10T00:00:00.000Z",
  },
  {
    slug: "orbit-incident-review",
    summary: "Post-incident review covering the March 2026 outage.",
    modifiedAt: "2026-04-02T00:00:00.000Z",
    source: {
      title: "Orbit March 2026 Incident Review",
      url: "https://example.com/reports/2026-03-incident",
      publisherName: "Example Orbit",
      access: "public",
    },
    publishedAt: "2026-03-20T00:00:00.000Z",
    retrievedAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
  },
  {
    slug: "orbit-embargoed-filing",
    summary: "Regulatory filing referenced under embargo.",
    source: {
      title: "Orbit 2026 Regulatory Filing",
      url: "https://example.com/filings/2026",
      publisherName: "Example Regulator",
      // `access` describes the SOURCE outside AADP. It is presentation
      // metadata and grants nothing — this record is protected because the
      // resource says so below, not because of this value.
      access: "restricted",
    },
    publishedAt: "2026-05-01T00:00:00.000Z",
    retrievedAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    restricted: true,
  },
];

const CLAIMS = [
  {
    slug: "orbit-uptime-2026",
    statement: "Orbit reported 99.9% uptime in 2026.",
    updatedAt: "2026-04-06T00:00:00.000Z",
    refs: [
      { evidenceSlug: "orbit-status-report", stance: "support", confidence: 0.8 },
      { evidenceSlug: "orbit-incident-review", stance: "contradict", confidence: 0.4 },
    ],
  },
  {
    slug: "orbit-availability-2026",
    statement: "Orbit published an availability figure for 2026.",
    updatedAt: "2026-04-06T00:00:00.000Z",
    // Cites the same evidence as the claim above — fan-in, not a cycle.
    refs: [{ evidenceSlug: "orbit-status-report", stance: "support" }],
  },
  {
    slug: "orbit-filing-2026",
    statement: "Orbit filed a 2026 regulatory disclosure.",
    updatedAt: "2026-05-03T00:00:00.000Z",
    refs: [{ evidenceSlug: "orbit-embargoed-filing", stance: "support", confidence: 0.5 }],
  },
];

function page(records, { cursor, limit }) {
  const start = cursor ? Number(cursor) : 0;
  const items = records.slice(start, start + limit);
  const nextCursor = start + limit < records.length ? String(start + limit) : null;
  return { items, nextCursor };
}

export function listClaims({ cursor, limit }) {
  return page(CLAIMS, { cursor, limit });
}

export function findClaimBySlug(slug) {
  return CLAIMS.find((claim) => claim.slug === slug) ?? null;
}

/**
 * The embargoed record is deliberately NOT listed: a sitemap advertises what
 * an anonymous agent can fetch. It stays reachable by direct URL — which is
 * how a claim citing it produces a `forbidden` entry rather than a dangling
 * one.
 */
export function listEvidence({ cursor, limit }) {
  return page(
    EVIDENCE.filter((evidence) => !evidence.restricted),
    { cursor, limit }
  );
}

export function findEvidenceBySlug(slug) {
  return EVIDENCE.find((evidence) => evidence.slug === slug) ?? null;
}

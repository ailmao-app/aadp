/**
 * Sample data access for the reference server's Answer resource type.
 *
 * Same rule as the note repository: this layer owns lookups only. It stores
 * plain application fields (question, answer text, timestamps, which notes
 * an answer refers to) and knows nothing about the Answer Module wire
 * format — building `x_answer` is the serializer's job, so the module
 * contract stays in one place instead of leaking into storage.
 */

const ANSWERS = [
  {
    slug: "what-is-aadp",
    question: "What is AADP?",
    conciseAnswer: "AADP is a discovery protocol that lets an application publish its content for AI agents to read.",
    answer:
      "AADP publishes a manifest at a well-known URL, a sitemap index listing every resource type, and a JSON entity document per record. An agent starts at the manifest and follows those links; no crawling of HTML is involved.",
    author: "AADP Reference Server Example",
    publishedAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    relatedNoteSlugs: ["welcome"],
  },
  {
    slug: "how-do-i-start-discovery",
    question: "How does an agent start discovering this server?",
    conciseAnswer: "Fetch /.well-known/ai-manifest.json, then follow discovery.sitemap_index.",
    answer:
      "The manifest is the only path an agent has to know in advance. Everything else — the sitemap index, each type's sitemap, and every entity URL — is discovered from it, which is what lets a deployment move those documents to custom routes without breaking clients.",
    author: "AADP Reference Server Example",
    publishedAt: "2026-02-02T00:00:00.000Z",
    updatedAt: "2026-02-05T00:00:00.000Z",
    relatedNoteSlugs: ["discovery", "custom-routes"],
  },
  {
    slug: "what-uptime-did-orbit-report",
    question: "What uptime did Orbit report for 2026?",
    conciseAnswer: "Orbit reported 99.9% uptime for 2026, with one incident review disputing the figure.",
    answer:
      "The 2026 status report states 99.9% availability. A separate post-incident review covering the March outage contradicts that figure. Both are published as evidence behind the claim this answer cites, so an agent can follow the citation graph rather than take the summary on trust.",
    author: "AADP Reference Server Example",
    publishedAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    relatedNoteSlugs: [],
    // The two-hop root: answer -> claim -> evidence.
    citedClaimSlugs: ["orbit-uptime-2026"],
  },
];

export function listAnswers({ cursor, limit }) {
  const start = cursor ? Number(cursor) : 0;
  const items = ANSWERS.slice(start, start + limit);
  const nextCursor = start + limit < ANSWERS.length ? String(start + limit) : null;
  return { items, nextCursor };
}

export function findAnswerBySlug(slug) {
  return ANSWERS.find((answer) => answer.slug === slug) ?? null;
}

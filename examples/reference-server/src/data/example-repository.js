/**
 * Sample data access for the reference server's one demo resource type.
 * Stands in for a database or internal HTTP API — the only rule this
 * layer follows is that it owns lookups, and never decides what a
 * consumer is allowed to see (that boundary is the serializer).
 */

const NOTES = [
  { slug: "welcome", title: "Welcome to AADP", body: "This note is served by the reference server example.", updatedAt: "2026-01-01T00:00:00.000Z" },
  { slug: "discovery", title: "How discovery works", body: "Start at /.well-known/ai-manifest.json and follow the sitemap.", updatedAt: "2026-01-02T00:00:00.000Z" },
  { slug: "custom-routes", title: "Custom routes", body: "AadpServerConfig.routes can move discovery documents off the default paths.", updatedAt: "2026-01-03T00:00:00.000Z" },
];

export function listNotes({ cursor, limit }) {
  const start = cursor ? Number(cursor) : 0;
  const items = NOTES.slice(start, start + limit);
  const nextCursor = start + limit < NOTES.length ? String(start + limit) : null;
  return { items, nextCursor };
}

export function findNoteBySlug(slug) {
  return NOTES.find((note) => note.slug === slug) ?? null;
}

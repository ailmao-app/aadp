import { defineResource } from "ail-aadp/server";
import { listNotes, findNoteBySlug } from "../data/example-repository.js";

/**
 * The serializer is the one allow-list boundary between a raw repository
 * record and the published document — it never forwards the record itself.
 */
export const noteResource = defineResource({
  type: "note",
  list: ({ cursor, limit }) => listNotes({ cursor, limit }),
  get: ({ id }) => findNoteBySlug(id),
  serialize: (note) => ({
    id: `note:${note.slug}`,
    updatedAt: note.updatedAt,
    canonicalUrl: `/notes/${note.slug}`,
    data: { title: note.title, body: note.body },
  }),
});

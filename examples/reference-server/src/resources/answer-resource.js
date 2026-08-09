import { defineResource } from "ail-aadp/server";
import { checksumOf } from "ail-aadp/canonical-json";
import { listAnswers, findAnswerBySlug } from "../data/answer-repository.js";

/**
 * Publishes the Answer Module `1.0` (`aadp:answer`) on top of the generic
 * server support: `SerializedEntity.extensions` carries `x_answer`, and the
 * runtime emits it without knowing this module exists. Nothing here is
 * `ail-aadp`-internal — the example only uses public exports
 * (`ail-aadp/server`, `ail-aadp/canonical-json`), the same way any third
 * party would.
 *
 * `noteEntityUrl` is injected rather than built here: an entity's published
 * URL depends on the deployment's `baseUrl` and route configuration, both of
 * which live in `aadp.js`. `serialize()` receives only the record.
 */
export function createAnswerResource({ noteEntityUrl, claimEntityUrl }) {
  return defineResource({
    type: "answer",
    list: ({ cursor, limit }) => listAnswers({ cursor, limit }),
    get: ({ id }) => findAnswerBySlug(id),
    serialize: (answer) => {
      // The server normalizes `updatedAt` onto the entity, and Answer 1.0
      // requires `x_answer.freshness.updated_at` to equal `entity.updated_at`
      // exactly — so both come from one value here rather than from two
      // independently formatted timestamps.
      const updatedAt = new Date(answer.updatedAt).toISOString();

      // Built without `content_checksum`, which is then computed over exactly
      // this object — the digest covers `x_answer` minus itself.
      const xAnswer = {
        module: "aadp:answer",
        version: "1.0",
        kind: "answer",
        question: answer.question,
        concise_answer: answer.conciseAnswer,
        answer: answer.answer,
        locale: "en",
        authorship: {
          kind: "source-authored",
          author: { name: answer.author },
        },
        freshness: {
          published_at: new Date(answer.publishedAt).toISOString(),
          updated_at: updatedAt,
        },
        // Citations ride on the released `related_entities` field with a
        // `target_type` of `claim` — Answer 1.0 is immutable, so linking to
        // the Evidence module adds no field to `x_answer`, and
        // `authorship.source_targets` is deliberately not reused for it.
        related_entities: [
          ...answer.relatedNoteSlugs.map((slug) => ({
            target_type: "note",
            target: { id: `note:${slug}`, url: noteEntityUrl(slug) },
          })),
          ...(answer.citedClaimSlugs ?? []).map((slug) => ({
            target_type: "claim",
            target: { id: `claim:${slug}`, url: claimEntityUrl(slug) },
          })),
        ],
      };

      return {
        id: `answer:${answer.slug}`,
        updatedAt,
        // Answer 1.0 requires an absolute HTTPS `canonical_url`, so a
        // deployment publishing answers must run under an HTTPS `baseUrl`
        // (`AADP_BASE_URL`). Over a plain-HTTP local origin the entity still
        // serves, but `validateAnswerEntityV1` will reject its canonical URL.
        canonicalUrl: `/answers/${answer.slug}`,
        locale: "en",
        data: { question: answer.question, concise_answer: answer.conciseAnswer },
        extensions: { x_answer: { ...xAnswer, content_checksum: checksumOf(xAnswer) } },
      };
    },
  });
}

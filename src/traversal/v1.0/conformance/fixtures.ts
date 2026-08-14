/**
 * In-package fixture matrix for the `aadp:graph-traversal@1.0` profile.
 *
 * The profile exercises a TRAVERSAL ALGORITHM, not a deployment: cycle
 * containment, fan-in, ordering and budget behavior are properties of this
 * package, and pinning them to someone's live data would make the verdict
 * depend on whatever that server happens to publish today. So the fixtures live
 * here, in the shipped package — the runner works identically from this repo,
 * from a packed tarball, and in a consumer's CI, with no network at all.
 *
 * `sampleRootUrl` remains available for the checks that can additionally be
 * observed against a real deployment; see the runner.
 */
import { checksumOf } from "../../../canonical-json/checksum.js";
import type { EntityV1 } from "../../../client/v1.0/index.js";
import type { TraversalNodeResolution, TraversalNodeResolver } from "../state-machine.js";

export const FIXTURE_ORIGIN = "https://fixtures.aadp.invalid";

export const FIXTURE_URLS = {
  answer: `${FIXTURE_ORIGIN}/entities/answer/a.json`,
  claimOne: `${FIXTURE_ORIGIN}/entities/claim/c1.json`,
  claimTwo: `${FIXTURE_ORIGIN}/entities/claim/c2.json`,
  evidence: `${FIXTURE_ORIGIN}/entities/evidence/e.json`,
  document: `${FIXTURE_ORIGIN}/entities/document/d.json`,
  missing: `${FIXTURE_ORIGIN}/entities/document/missing.json`,
  manifest: `${FIXTURE_ORIGIN}/.well-known/ai-manifest.json`,
  evidenceSource: "https://publisher.aadp.invalid/reports/2026",
  evidencePublisher: "https://publisher.aadp.invalid",
} as const;

const UPDATED_AT = "2026-08-06T00:00:00Z";

function sealed(wrapper: Record<string, unknown>): Record<string, unknown> {
  return { ...wrapper, content_checksum: checksumOf(wrapper) };
}

export function fixtureEntity(over: Record<string, unknown>): EntityV1 {
  return entity(over);
}

function entity(over: Record<string, unknown>): EntityV1 {
  return {
    aadp_version: "1.0",
    checksum: checksumOf({}),
    updated_at: UPDATED_AT,
    data: {},
    ...over,
  } as EntityV1;
}

export function answerWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:answer",
    version: "1.0",
    kind: "answer",
    question: "What does this fixture prove?",
    concise_answer: "That traversal behaves the same everywhere.",
    locale: "en",
    authorship: { kind: "source-authored", author: { name: "AADP fixtures" } },
    freshness: { published_at: "2026-08-01T00:00:00Z", updated_at: UPDATED_AT },
    ...over,
  });
}

export function claimWrapper(over: Record<string, unknown> = {}): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "claim",
    statement: "This claim exists so an evidence edge can be observed.",
    locale: "en",
    evidence_refs: [
      { target_type: "evidence", target: { id: "evidence:e", url: FIXTURE_URLS.evidence }, stance: "support" },
    ],
    ...over,
  });
}

export function evidenceWrapper(): Record<string, unknown> {
  return sealed({
    module: "aadp:evidence",
    version: "1.0",
    kind: "evidence",
    summary: "A source that traversal must never dereference.",
    locale: "en",
    source: {
      title: "Fixture report",
      url: FIXTURE_URLS.evidenceSource,
      publisher: { name: "Fixture publisher", url: FIXTURE_URLS.evidencePublisher },
      access: "public",
    },
    provenance: { published_at: "2026-01-15T00:00:00Z", retrieved_at: "2026-08-01T09:00:00Z" },
  });
}

export function relationSet(items: unknown[]): Record<string, unknown> {
  return { module: "aadp:relations", version: "1.0", kind: "relation-set", items };
}

/** Root answer referencing the two claims — the diamond's top. */
export function answerRoot(over: Record<string, unknown> = {}): EntityV1 {
  return entity({
    id: "answer:a",
    type: "answer",
    canonical_url: FIXTURE_URLS.answer,
    x_answer: answerWrapper({
      related_entities: [
        { target_type: "claim", target: { id: "claim:c1", url: FIXTURE_URLS.claimOne } },
        { target_type: "claim", target: { id: "claim:c2", url: FIXTURE_URLS.claimTwo } },
      ],
      ...over,
    }),
  });
}

export function claimEntity(id: string, url: string): EntityV1 {
  return entity({ id, type: "claim", canonical_url: url, x_evidence: claimWrapper() });
}

export function evidenceEntity(): EntityV1 {
  return entity({
    id: "evidence:e",
    type: "evidence",
    canonical_url: FIXTURE_URLS.evidence,
    x_evidence: evidenceWrapper(),
  });
}

export function documentEntity(id = "document:d", url = FIXTURE_URLS.document): EntityV1 {
  return entity({ id, type: "document", canonical_url: url });
}

/** The diamond: two claims, one shared evidence entity. */
export function diamondEntities(): Record<string, EntityV1> {
  return {
    [FIXTURE_URLS.answer]: answerRoot(),
    [FIXTURE_URLS.claimOne]: claimEntity("claim:c1", FIXTURE_URLS.claimOne),
    [FIXTURE_URLS.claimTwo]: claimEntity("claim:c2", FIXTURE_URLS.claimTwo),
    [FIXTURE_URLS.evidence]: evidenceEntity(),
  };
}

/** A true cycle: the claim points back at the root answer. */
export function cycleEntities(): Record<string, EntityV1> {
  return {
    [FIXTURE_URLS.answer]: entity({
      id: "answer:a",
      type: "answer",
      canonical_url: FIXTURE_URLS.answer,
      x_answer: answerWrapper({
        related_entities: [{ target_type: "claim", target: { id: "claim:c1", url: FIXTURE_URLS.claimOne } }],
      }),
    }),
    [FIXTURE_URLS.claimOne]: entity({
      id: "claim:c1",
      type: "claim",
      canonical_url: FIXTURE_URLS.claimOne,
      x_relations: relationSet([
        {
          rel: "about",
          target_type: "answer",
          cardinality: "one",
          target: { id: "answer:a", url: FIXTURE_URLS.answer },
        },
      ]),
    }),
  };
}

/**
 * Fan-in through EXPANDABLE edges: two claims whose `x_relations` both point at
 * one document. Distinct from `diamondEntities`, whose shared target is reached
 * by leaf edges — only an expandable second occurrence can produce
 * `already-expanded`, which is the outcome that must not be reported as a cycle.
 */
export function fanInEntities(): Record<string, EntityV1> {
  const pointsAtDocument = (id: string, url: string): EntityV1 =>
    entity({
      id,
      type: "claim",
      canonical_url: url,
      x_relations: relationSet([
        {
          rel: "related",
          target_type: "document",
          cardinality: "one",
          target: { id: "document:d", url: FIXTURE_URLS.document },
        },
      ]),
    });
  return {
    [FIXTURE_URLS.answer]: answerRoot(),
    [FIXTURE_URLS.claimOne]: pointsAtDocument("claim:c1", FIXTURE_URLS.claimOne),
    [FIXTURE_URLS.claimTwo]: pointsAtDocument("claim:c2", FIXTURE_URLS.claimTwo),
    [FIXTURE_URLS.document]: documentEntity(),
  };
}

/**
 * One `x_relations` planning three edges whose fates differ: one expands, one
 * re-enters an ancestor, one lands past the depth limit. The extension record
 * must stay `planned` — there is no single correct outcome for it.
 */
export function multiOutcomeEntities(): Record<string, EntityV1> {
  return {
    [FIXTURE_URLS.answer]: entity({
      id: "answer:a",
      type: "answer",
      canonical_url: FIXTURE_URLS.answer,
      x_relations: relationSet([
        {
          rel: "related",
          target_type: "claim",
          cardinality: "one",
          target: { id: "claim:c1", url: FIXTURE_URLS.claimOne },
        },
      ]),
    }),
    [FIXTURE_URLS.claimOne]: entity({
      id: "claim:c1",
      type: "claim",
      canonical_url: FIXTURE_URLS.claimOne,
      x_relations: relationSet([
        {
          rel: "about",
          target_type: "answer",
          cardinality: "one",
          target: { id: "answer:a", url: FIXTURE_URLS.answer },
        },
        {
          rel: "related",
          target_type: "document",
          cardinality: "one",
          target: { id: "document:d", url: FIXTURE_URLS.document },
        },
      ]),
    }),
    [FIXTURE_URLS.document]: documentEntity(),
  };
}

/** A generated-summary answer, whose `authorship.source_targets` is opt-in only. */
export function generatedSummaryEntities(): Record<string, EntityV1> {
  return {
    [FIXTURE_URLS.answer]: entity({
      id: "answer:a",
      type: "answer",
      canonical_url: FIXTURE_URLS.answer,
      x_answer: answerWrapper({
        authorship: {
          kind: "generated-summary",
          generator: { name: "Fixture summarizer" },
          generated_at: "2026-08-05T00:00:00Z",
          source_targets: [{ target_type: "document", target: { id: "document:d", url: FIXTURE_URLS.document } }],
        },
      }),
    }),
    [FIXTURE_URLS.document]: documentEntity(),
  };
}

export interface FixtureResolver {
  resolve: TraversalNodeResolver;
  /** Every URL the walk asked to resolve, in order. */
  requested: string[];
}

/**
 * Resolves from a fixed map. A URL with no fixture is `not-found` — the same
 * outcome a deployment would produce — and every request is recorded, which is
 * how the "never fetched" checks observe absence rather than assume it.
 */
export function fixtureResolver(
  entities: Record<string, EntityV1>,
  options: { delayByUrl?: Record<string, number> } = {}
): FixtureResolver {
  const requested: string[] = [];
  const resolve: TraversalNodeResolver = async (request) => {
    requested.push(request.url);
    const delay = options.delayByUrl?.[request.url];
    if (delay) await new Promise<void>((done) => setTimeout(done, delay));
    const found = entities[request.url];
    const resolution: TraversalNodeResolution = found
      ? { status: "resolved", entity: found }
      : { status: "not-found", message: `no fixture published at ${request.url}` };
    return resolution;
  };
  return { resolve, requested };
}

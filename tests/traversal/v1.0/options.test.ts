/**
 * Root identity and option validation — every failure here must happen BEFORE
 * the first request (plan 1.5.0 §"Root identity").
 */
import { describe, expect, it } from "vitest";
import {
  InvalidGraphTraversalOptionsError,
  resolveTraversalOptions,
} from "../../../src/traversal/v1.0/options.js";
import { createRelationsTraversalBudget } from "../../../src/modules/relations/v1.0/index.js";
import type { GraphTraversalOptions } from "../../../src/traversal/v1.0/index.js";
import { answerEntity, entityOf } from "./entity-helpers.js";

const ROOT_URL = "https://example.com/entities/answer/what-is-orbit.json";

function options(over: Partial<GraphTraversalOptions> = {}): GraphTraversalOptions {
  return { budget: createRelationsTraversalBudget(), ...over };
}

describe("root identity", () => {
  it("takes the root URL from a URL root", () => {
    const effective = resolveTraversalOptions("https://example.com/a.json", options());
    expect(effective.rootUrl).toBe("https://example.com/a.json");
    expect(effective.rootOrigin).toBe("https://example.com");
  });

  it("falls back to the root entity's canonical_url", () => {
    expect(resolveTraversalOptions(answerEntity(), options()).rootUrl).toBe(ROOT_URL);
  });

  it("falls back to options.rootUrl for an entity with no canonical_url", () => {
    const entity = entityOf({ canonical_url: undefined });
    const effective = resolveTraversalOptions(entity, options({ rootUrl: "https://example.com/b.json" }));
    expect(effective.rootUrl).toBe("https://example.com/b.json");
  });

  it("prefers the root's own URL over options.rootUrl", () => {
    const effective = resolveTraversalOptions(answerEntity(), options({ rootUrl: "https://other.example/z.json" }));
    expect(effective.rootUrl).toBe(ROOT_URL);
  });

  it("throws invalid-options when no source of a root URL exists", () => {
    const entity = entityOf({ canonical_url: undefined });
    expect(() => resolveTraversalOptions(entity, options())).toThrow(InvalidGraphTraversalOptionsError);
  });

  it("rejects a rootOrigin alone — an origin cannot produce a canonical key", () => {
    const entity = entityOf({ canonical_url: undefined });
    expect(() => resolveTraversalOptions(entity, options({ rootOrigin: "https://example.com" }))).toThrow(
      /needs a URL/
    );
  });

  it("rejects an unparseable root URL", () => {
    expect(() => resolveTraversalOptions("not-a-url", options())).toThrow(/not a valid absolute URL/);
  });
});

describe("rootOrigin precedence", () => {
  it("derives rootOrigin from the root URL", () => {
    expect(resolveTraversalOptions(answerEntity(), options()).rootOrigin).toBe("https://example.com");
  });

  it("accepts a matching rootOrigin as a no-op", () => {
    const effective = resolveTraversalOptions(answerEntity(), options({ rootOrigin: "https://example.com" }));
    expect(effective.rootOrigin).toBe("https://example.com");
  });

  it("throws rather than picking a side when rootOrigin disagrees", () => {
    expect(() => resolveTraversalOptions(answerEntity(), options({ rootOrigin: "https://other.example" }))).toThrow(
      /disagrees with the origin/
    );
  });
});

describe("option validation", () => {
  it("requires the caller's budget", () => {
    expect(() => resolveTraversalOptions(answerEntity(), {} as GraphTraversalOptions)).toThrow(
      /options.budget is required/
    );
  });

  it("applies the root URL policy to the identity URL too", () => {
    expect(() => resolveTraversalOptions("http://127.0.0.1/a.json", options())).toThrow();
  });

  it("defaults followCollections and includeGeneratedSummarySources to false", () => {
    const effective = resolveTraversalOptions(answerEntity(), options());
    expect(effective.followCollections).toBe(false);
    expect(effective.includeGeneratedSummarySources).toBe(false);
    expect(effective.maxBufferedEvents).toBe(256);
  });

  it("carries the caller's opt-ins through", () => {
    const effective = resolveTraversalOptions(
      answerEntity(),
      options({ followCollections: true, includeGeneratedSummarySources: true, maxBufferedEvents: 8 })
    );
    expect(effective).toMatchObject({
      followCollections: true,
      includeGeneratedSummarySources: true,
      maxBufferedEvents: 8,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscoveryBudget, AadpDiscoveryBudgetExceededError } from "../../src/client/discovery-budget.js";
import type { ManifestV1 } from "../../src/client/v1.0/index.js";
import type { CheckContext, CheckOutcome } from "../../src/conformance/checks.js";

/**
 * Focused regression for the `links.no_dead_urls` swallow bug (code review
 * `.claude/review/review-20260803-201951.md` [P1], 2026-08-03): its
 * `probeUrl()` call site didn't pass `ctx.budget`, and its own `catch`
 * turned *every* thrown error — including a shared-budget/deadline stop or
 * a caller abort — into a generic "unreachable" warning before `runCheck()`
 * (runner.ts) ever got a chance to classify it as `inconclusive`/aborted.
 *
 * A realistic end-to-end reproduction requires exhausting the shared
 * budget/deadline at *exactly* the moment `links.no_dead_urls` itself
 * probes a URL — not any earlier, or the whole prerequisite chain up to
 * `manifest.schema` gets skipped first for an unrelated reason, and not
 * any later, or the check just passes normally. That's fragile to pin
 * against real HTTP round-trip timing/response sizes. Mocking `probeUrl`
 * instead exercises `links.no_dead_urls`'s own try/catch directly and
 * deterministically — this is a unit test of that one check, not of the
 * whole runner.
 */
vi.mock("../../src/client/http.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/client/http.js")>();
  return { ...actual, probeUrl: vi.fn() };
});

const { probeUrl, AbortedError } = await import("../../src/client/http.js");
const { CHECKS, CheckSignal } = await import("../../src/conformance/checks.js");

const linksCheck = CHECKS.find((check) => check.id === "links.no_dead_urls")!;

const MANIFEST: ManifestV1 = {
  aadp_version: "1.0",
  application: {
    name: "Test App",
    description: "A test app.",
    publisher: { name: "Test Publisher", url: "https://example.com" },
  },
  discovery: { sitemap_index: "https://example.com/ai/v1.0/sitemap-index.json" },
  policies: {
    robots: "https://example.com/robots.txt",
    terms: "https://example.com/terms",
  },
};

/** Minimal `CheckContext`, replicating the trap functions `runCheck()` (runner.ts) builds. */
function buildCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  const signal = (outcome: CheckOutcome | { status: "failed"; message: string; details?: string[] }): never => {
    throw new CheckSignal(outcome);
  };
  return {
    baseUrl: "https://example.com",
    client: {},
    scoped: () => ({}),
    budget: createDiscoveryBudget(),
    maxSitemaps: 100,
    negativeTargets: {},
    state: { manifestUrl: "https://example.com/.well-known/ai-manifest.json", manifest: MANIFEST },
    skip: (message, details) => signal({ status: "skipped", message, details }),
    inconclusive: (message, details) => signal({ status: "skipped", message, details, inconclusive: true }),
    warn: (message, details) => signal({ status: "warning", message, details }),
    fail: (message, details) => signal({ status: "failed", message, details }),
    ...overrides,
  };
}

describe("links.no_dead_urls — budget/abort must propagate, never become a generic 'unreachable' warning", () => {
  beforeEach(() => {
    vi.mocked(probeUrl).mockReset();
  });

  it("rethrows AadpDiscoveryBudgetExceededError instead of swallowing it", async () => {
    vi.mocked(probeUrl).mockRejectedValue(new AadpDiscoveryBudgetExceededError("test: exceeded maxTotalBytes"));
    await expect(linksCheck.run(buildCtx())).rejects.toThrow(AadpDiscoveryBudgetExceededError);
  });

  it("rethrows AbortedError instead of swallowing it", async () => {
    vi.mocked(probeUrl).mockRejectedValue(new AbortedError("https://example.com/robots.txt"));
    await expect(linksCheck.run(buildCtx())).rejects.toThrow(AbortedError);
  });

  it("still reports an ordinary transport failure as an 'unreachable' warning (unaffected by the fix)", async () => {
    vi.mocked(probeUrl).mockRejectedValue(new Error("ECONNREFUSED"));
    let signalErr: InstanceType<typeof CheckSignal> | undefined;
    try {
      await linksCheck.run(buildCtx());
    } catch (err) {
      signalErr = err as InstanceType<typeof CheckSignal>;
    }
    expect(signalErr).toBeInstanceOf(CheckSignal);
    expect(signalErr!.outcome.status).toBe("warning");
    expect(signalErr!.outcome.message).toMatch(/could not be reached/);
  });

  it("passes ctx.budget through to every probeUrl() call", async () => {
    vi.mocked(probeUrl).mockResolvedValue({
      status: 200,
      contentType: "text/plain",
      headers: new Headers(),
      url: "https://example.com/robots.txt",
    });
    const budget = createDiscoveryBudget();
    await linksCheck.run(buildCtx({ budget }));
    expect(vi.mocked(probeUrl)).toHaveBeenCalled();
    for (const call of vi.mocked(probeUrl).mock.calls) {
      expect(call[2]).toBe(budget);
    }
  });
});

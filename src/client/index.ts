/**
 * Package-level client entry point. Unversioned exports are the AADP v0.1
 * client, kept for backward compatibility with existing v0.1
 * consumers/tests. New code targeting AADP v1.0 should import from the
 * `v1` namespace here, or `./v1.0/index.js` directly — v1.0 has its own
 * types and is deliberately not merged into these v0.1 exports (spec
 * `docs/IMPLEMENTATION_PLAN.md` Phase 4).
 */
export * from "./v0.1/index.js";
export * as v1 from "./v1.0/index.js";

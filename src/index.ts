export * from "./client/index.js";
export * from "./validator/index.js";
export * from "./canonical-json/index.js";
export * from "./conformance/index.js";
export * from "./server/index.js";
// Generic module registry engine (ADR-0007). Concrete module APIs (e.g.
// Relations) live under their own versioned subpath and MUST NOT be
// re-exported here — this export is the registry infrastructure itself,
// not a module.
export * from "./module-registry/index.js";

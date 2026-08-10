/**
 * The single source of truth for the AADP v1.0 extension-field key grammar.
 *
 * Every released v1.0 schema that accepts vendor/module extensions declares
 * the exact same `patternProperties` key — `^x_[a-zA-Z0-9_]*$` (see
 * `schemas/v1.0/entity.schema.json`, `schemas/v1.0/manifest.schema.json` and
 * the Relations module schemas). Any code path that decides whether a key is
 * an extension key MUST reuse this predicate rather than inlining a second
 * regex: a stricter copy would reject keys the released core schema considers
 * valid (`x_Foo`, `x_1`, bare `x_`), which would break the additive
 * compatibility guarantee for a producer moving from hand-written entities to
 * `ail-aadp/server`.
 */
export const EXTENSION_KEY_GRAMMAR = /^x_[a-zA-Z0-9_]*$/;

/** True when `key` matches the released core extension-field grammar `^x_[a-zA-Z0-9_]*$`. */
export function isExtensionKey(key: string): boolean {
  return EXTENSION_KEY_GRAMMAR.test(key);
}

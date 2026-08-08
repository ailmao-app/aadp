/** Errors specific to the Answer v1.0 client layer. Mirrors `../../../relations/v1.0/client/errors.ts`. */

/** A fetched entity failed Answer `1.0` entity-context validation (core envelope, `x_answer`, or entity-context invariants). */
export class AnswerEntityFetchValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly errors: unknown[],
    public readonly semanticIssues: unknown[]
  ) {
    super(`Entity at ${url} failed Answer 1.0 entity-context validation.`);
    this.name = "AnswerEntityFetchValidationError";
  }
}

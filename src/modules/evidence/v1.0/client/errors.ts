/** Errors specific to the Evidence v1.0 client layer. Mirrors `../../../answer/v1.0/client/errors.ts`. */

/** A fetched entity failed Evidence `1.0` entity-context validation (core envelope, `x_evidence`, or entity-context invariants). */
export class EvidenceEntityFetchValidationError extends Error {
  constructor(
    public readonly url: string,
    public readonly errors: unknown[],
    public readonly semanticIssues: unknown[]
  ) {
    super(`Entity at ${url} failed Evidence 1.0 entity-context validation.`);
    this.name = "EvidenceEntityFetchValidationError";
  }
}

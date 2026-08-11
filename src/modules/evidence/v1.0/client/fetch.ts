/**
 * `fetchEvidenceEntityV1` — fetches via the core v1.0 client (`fetchEntity`,
 * which schema-validates the entity envelope and verifies its own checksum
 * against `data` before returning), then parses/validates the result as an
 * Evidence `1.0` entity. No URL out of `x_evidence` is ever fetched or
 * trusted: `source.url` and `publisher.url` are metadata this package never
 * requests (specification.md §13), and an `evidence_refs` target is only
 * followed by the resolvers in `./resolve.ts`, when the caller opts in.
 */
import { fetchEntity } from "../../../../client/v1.0/index.js";
import type { DiscoveryBudgetState } from "../../../../client/discovery-budget.js";
import { parseEvidenceEntityV1, EvidenceEntityValidationError, type ValidatedEvidenceEntityV1 } from "../entity.js";
import { EvidenceEntityFetchValidationError } from "./errors.js";
import type { EvidenceClientOptions } from "./types.js";

/**
 * Fetches the entity at `url`, then validates it end-to-end as an Evidence
 * `1.0` entity (either document kind) via `parseEvidenceEntityV1`. Throws
 * `EvidenceEntityFetchValidationError` (carrying `url` for provenance) when
 * validation fails, rather than the URL-less
 * `EvidenceEntityValidationError` `parseEvidenceEntityV1` throws on its own.
 */
export async function fetchEvidenceEntityV1(
  url: string,
  options: EvidenceClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<ValidatedEvidenceEntityV1> {
  const entity = await fetchEntity(url, options, budget);
  try {
    return parseEvidenceEntityV1(entity);
  } catch (err) {
    if (err instanceof EvidenceEntityValidationError) {
      throw new EvidenceEntityFetchValidationError(url, err.result.errors, err.result.semanticIssues);
    }
    throw err;
  }
}

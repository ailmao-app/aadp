/**
 * `fetchAnswerEntityV1` — fetches via the core v1.0 client (`fetchEntity`,
 * which schema-validates the entity envelope and verifies its own
 * checksum against `data` before returning), then parses/validates the
 * result as an Answer `1.0` entity. No target URL from `x_answer` is ever
 * fetched or trusted before the whole core entity and `x_answer` are
 * valid (specification.md "Typed API contract").
 */
import { fetchEntity, type ClientOptions } from "../../../../client/v1.0/index.js";
import type { DiscoveryBudgetState } from "../../../../client/discovery-budget.js";
import { parseAnswerEntityV1, AnswerEntityValidationError, type ValidatedAnswerEntityV1 } from "../entity.js";
import { AnswerEntityFetchValidationError } from "./errors.js";

export type AnswerClientOptions = ClientOptions;

/**
 * Fetches the entity at `url`, then validates it end-to-end as an Answer
 * `1.0` entity via `parseAnswerEntityV1`. Throws
 * `AnswerEntityFetchValidationError` (carrying `url` for provenance) when
 * validation fails, rather than the URL-less `AnswerEntityValidationError`
 * `parseAnswerEntityV1` throws on its own.
 */
export async function fetchAnswerEntityV1(
  url: string,
  options: AnswerClientOptions = {},
  budget?: DiscoveryBudgetState
): Promise<ValidatedAnswerEntityV1> {
  const entity = await fetchEntity(url, options, budget);
  try {
    return parseAnswerEntityV1(entity);
  } catch (err) {
    if (err instanceof AnswerEntityValidationError) {
      throw new AnswerEntityFetchValidationError(url, err.result.errors, err.result.semanticIssues);
    }
    throw err;
  }
}

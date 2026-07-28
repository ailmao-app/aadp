/**
 * Server-side error envelope (spec v1.0 §9). Distinct from
 * `../client/errors.ts` (which models an error envelope the *client*
 * received) — this is what a `defineAADP()` application throws to have
 * `handleRequest()` turn it into the wire error envelope.
 */
export type AadpServerErrorCode =
  | "not_found"
  | "invalid_request"
  | "unsupported_type"
  | "upstream_unavailable"
  | "rate_limited";

export class AadpServerError extends Error {
  constructor(
    public readonly code: AadpServerErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AadpServerError";
  }
}

export function notFound(message: string): AadpServerError {
  return new AadpServerError("not_found", message, 404);
}

export function invalidRequest(message: string): AadpServerError {
  return new AadpServerError("invalid_request", message, 400);
}

export function unsupportedType(message: string): AadpServerError {
  return new AadpServerError("unsupported_type", message, 404);
}

export function upstreamUnavailable(message: string): AadpServerError {
  return new AadpServerError("upstream_unavailable", message, 502);
}

export function rateLimited(message: string): AadpServerError {
  return new AadpServerError("rate_limited", message, 429);
}

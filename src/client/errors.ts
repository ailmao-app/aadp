/**
 * Version-agnostic client errors. The AADP error envelope (spec §9) has
 * the same shape in every version — it carries no `aadp_version` field —
 * so a single error type serves both the v0.1 and v1.0 client modules.
 */

export interface AadpErrorEnvelope {
  error: { code: string; message: string; request_id: string };
}

export class AadpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly envelope?: AadpErrorEnvelope
  ) {
    super(message);
    this.name = "AadpRequestError";
  }
}

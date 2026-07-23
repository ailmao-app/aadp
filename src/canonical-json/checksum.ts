import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize.js";

/** sha256:<hex> of the canonical JSON of `payload`, per AADP spec §6. */
export function checksumOf(payload: unknown): string {
  const canonical = canonicalize(payload);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

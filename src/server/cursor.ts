import { invalidRequest } from "./errors.js";

/**
 * Wraps an application-owned opaque cursor with `type`/`version` so a
 * cursor minted for one resource type or protocol version is rejected,
 * not silently applied, if replayed against another. The application's
 * own cursor value (`raw`) is never interpreted by this package.
 */
export function encodeCursor(type: string, version: string, raw: string): string {
  return Buffer.from(JSON.stringify({ type, version, raw })).toString("base64url");
}

export function decodeCursor(type: string, version: string, wireCursor: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(wireCursor, "base64url").toString("utf8"));
  } catch {
    throw invalidRequest(`Malformed cursor for resource type "${type}".`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).type !== type ||
    (parsed as Record<string, unknown>).version !== version ||
    typeof (parsed as Record<string, unknown>).raw !== "string"
  ) {
    throw invalidRequest(`Cursor does not belong to resource type "${type}".`);
  }
  return (parsed as { raw: string }).raw;
}

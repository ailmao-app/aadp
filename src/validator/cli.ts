#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  validateDocument,
  UnsupportedAadpVersionError,
  KINDS,
  SUPPORTED_VERSIONS,
  type ResourceKind,
} from "./index.js";
import { fetchJson } from "../client/http.js";
import { createStrictUrlPolicy, createPermissiveUrlPolicy } from "../client/url-policy.js";

function detectVersion(data: unknown): string | undefined {
  if (
    typeof data === "object" &&
    data !== null &&
    "aadp_version" in data &&
    typeof (data as Record<string, unknown>).aadp_version === "string"
  ) {
    return (data as Record<string, unknown>).aadp_version as string;
  }
  return undefined;
}

const program = new Command();

program
  .name("aadp-validate")
  .description("Validate a local file or URL against an AADP schema")
  .argument("<kind>", `resource kind: ${KINDS.join(" | ")}`)
  .argument("<source>", "path to a local JSON file, or an http(s) URL")
  .option(
    "--version <version>",
    `AADP wire version to validate against (${SUPPORTED_VERSIONS.join(", ")}). ` +
      `If omitted, read from the document's own "aadp_version" field.`
  )
  .option(
    "--allow-private-network",
    "Allow <source> (and any redirect it follows) to resolve to a private/loopback/link-local " +
      "address. Only pass this for a deliberately local/offline deployment you trust — the " +
      "default strict policy blocks it to prevent SSRF when validating an untrusted URL."
  )
  .action(async (kind: string, source: string, opts: { version?: string; allowPrivateNetwork?: boolean }) => {
    if (!KINDS.includes(kind as ResourceKind)) {
      console.error(`Unknown kind "${kind}". Expected one of: ${KINDS.join(", ")}`);
      process.exitCode = 2;
      return;
    }

    let data: unknown;
    if (/^https?:\/\//.test(source)) {
      // Same SSRF-aware, resource-bounded transport as the reference
      // client: URL policy, timeout, redirect cap, streamed size cap, and
      // a JSON content-type check — a CI job or bot running this CLI
      // against an externally-supplied URL is exposed to the same
      // untrusted-origin risks the client is.
      try {
        const result = await fetchJson(source, {
          urlPolicy: opts.allowPrivateNetwork ? createPermissiveUrlPolicy() : createStrictUrlPolicy(),
        });
        data = result.data;
      } catch (err) {
        console.error(`Failed to fetch ${source}: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }
    } else {
      const raw = readFileSync(source, "utf8");
      try {
        data = JSON.parse(raw);
      } catch (err) {
        console.error(`Invalid JSON in ${source}: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }
    }

    const version = opts.version ?? detectVersion(data);
    if (!version) {
      console.error(
        `Could not determine AADP version for ${source}: document has no ` +
          `"aadp_version" field (expected for kind "${kind}") and --version ` +
          `was not passed. Pass --version explicitly, e.g. --version ${SUPPORTED_VERSIONS.at(-1)}.`
      );
      process.exitCode = 2;
      return;
    }

    let result;
    try {
      result = validateDocument({ version, kind: kind as ResourceKind, data });
    } catch (err) {
      if (err instanceof UnsupportedAadpVersionError) {
        console.error(err.message);
        process.exitCode = 3;
        return;
      }
      throw err;
    }

    if (result.valid) {
      console.log(`OK: ${source} is a valid AADP v${version} ${kind}.`);
      return;
    }

    console.error(`INVALID: ${source} failed AADP v${version} ${kind} schema.`);
    for (const err of result.errors) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    process.exitCode = 1;
  });

program.parseAsync(process.argv);

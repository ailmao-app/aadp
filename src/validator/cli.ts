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
  .action(async (kind: string, source: string, opts: { version?: string }) => {
    if (!KINDS.includes(kind as ResourceKind)) {
      console.error(`Unknown kind "${kind}". Expected one of: ${KINDS.join(", ")}`);
      process.exitCode = 2;
      return;
    }

    let raw: string;
    if (/^https?:\/\//.test(source)) {
      const res = await fetch(source);
      raw = await res.text();
    } else {
      raw = readFileSync(source, "utf8");
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`Invalid JSON in ${source}: ${(err as Error).message}`);
      process.exitCode = 2;
      return;
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

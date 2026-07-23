#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { validate, type ResourceKind } from "./index.js";

const KINDS: ResourceKind[] = [
  "manifest",
  "sitemap-index",
  "sitemap",
  "entity",
  "error",
];

const program = new Command();

program
  .name("aadp-validate")
  .description("Validate a local file or URL against an AADP v0.1 schema")
  .argument("<kind>", `resource kind: ${KINDS.join(" | ")}`)
  .argument("<source>", "path to a local JSON file, or an http(s) URL")
  .action(async (kind: string, source: string) => {
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

    const result = validate(kind as ResourceKind, data);
    if (result.valid) {
      console.log(`OK: ${source} is a valid AADP v0.1 ${kind}.`);
      return;
    }

    console.error(`INVALID: ${source} failed AADP v0.1 ${kind} schema.`);
    for (const err of result.errors) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    process.exitCode = 1;
  });

program.parseAsync(process.argv);

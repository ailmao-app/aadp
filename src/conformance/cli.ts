#!/usr/bin/env node
/**
 * `aadp-conformance` — run the AADP conformance suite against a live
 * deployment from a shell or CI job, with no source tree and no test
 * framework:
 *
 * ```sh
 * npx aadp-conformance https://example.com
 * ```
 *
 * This file only parses argv, calls `runConformance`, renders the report
 * and picks an exit code. Every conformance decision lives in
 * `./checks.ts` / `./runner.ts`, so the CLI and a programmatic caller can
 * never disagree about what "conformant" means
 * (`docs/vi/IMPLEMENTATION_PLAN.md` §11 "Ưu tiên 1").
 */
import { writeFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { runConformance } from "./runner.js";
import { renderJsonReport, renderCheckLines, renderSummary, exitCodeFor } from "./report.js";
import {
  SUPPORTED_CONFORMANCE_VERSIONS,
  UnsupportedConformanceVersionError,
  type CheckResult,
  type ConformanceOptions,
} from "./types.js";

interface CliOptions {
  protocolVersion: string;
  timeout?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  maxEntities?: number;
  maxSitemaps?: number;
  deadline?: number;
  unknownEntityUrl?: string;
  unknownTypeUrl?: string;
  allowPrivateNetwork?: boolean;
  header: string[];
  crossOriginSafeHeader: string[];
  json?: boolean;
  output?: string;
  failOnWarning?: boolean;
  quiet?: boolean;
  color?: boolean;
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Parses repeated `--header 'Name: value'` into a header map. */
function parseHeaders(raw: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of raw) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new InvalidArgumentError(`--header must be "Name: value", got "${entry}"`);
    }
    headers[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return headers;
}

const program = new Command();

program
  .name("aadp-conformance")
  .description(
    "Run the AADP conformance suite against a deployment.\n\n" +
      "Exit codes: 0 conformant, 1 one or more checks failed, 2 the run could not be " +
      "performed, 3 the deployment does not speak the requested AADP version, 4 the run " +
      "left checks unfinished and certifies nothing."
  )
  .argument("<base-url>", "origin to exercise, e.g. https://example.com")
  .option(
    "--protocol-version <version>",
    `AADP wire version to exercise (${SUPPORTED_CONFORMANCE_VERSIONS.join(", ")})`,
    "1.0"
  )
  .option("--timeout <ms>", "per-request timeout in milliseconds", positiveInt)
  .option("--max-redirects <n>", "maximum redirect hops per request", positiveInt)
  .option("--max-response-bytes <n>", "maximum response body size in bytes", positiveInt)
  .option("--max-pages <n>", "traversal budget: maximum sitemap pages fetched", positiveInt)
  .option("--max-entities <n>", "traversal budget: maximum entities fetched", positiveInt)
  .option("--max-sitemaps <n>", "traversal budget: maximum sitemaps the index may list", positiveInt)
  .option("--deadline <ms>", "traversal budget: wall-clock deadline for the walk", positiveInt)
  .option(
    "--allow-private-network",
    "allow the target (and its redirects) to resolve to a private/loopback/link-local address. " +
      "Only pass this for a local deployment you trust — the default strict policy blocks it to " +
      "prevent SSRF when the URL comes from somewhere else."
  )
  .option("--header <name:value>", "extra request header; repeatable", collect, [])
  .option(
    "--cross-origin-safe-header <name>",
    "header name that may survive a cross-origin hop; repeatable. Every other --header is " +
      "dropped when a document points at another origin.",
    collect,
    []
  )
  .option(
    "--unknown-entity-url <url>",
    "URL of an entity that does not exist, for the not_found envelope check. Needed when entity " +
      "URLs are query-based, opaque or signed, since AADP defines no routing template to derive one."
  )
  .option(
    "--unknown-type-url <url>",
    "URL of a sitemap for an unpublished type, for the unsupported_type envelope check."
  )
  .option("--json", "print the machine-readable report to stdout instead of the text report")
  .option("--output <file>", "also write the JSON report to <file>")
  .option("--fail-on-warning", "treat warnings as failures in the exit code")
  .option("--quiet", "text report: print only non-passing checks and the summary")
  .option("--color", "colorize the text report")
  .action(async (baseUrl: string, opts: CliOptions) => {
    // With --json, stdout carries the report and nothing else so a CI job
    // can pipe it straight into a parser; progress is suppressed there
    // rather than mixed into stderr, since the JSON report already
    // contains every line it would have printed.
    const streaming = !opts.json;
    let currentGroup: string | undefined;

    // Checks are printed as they settle rather than batched at the end: a
    // run against a real deployment can take minutes, and a reader should
    // see which check is slow or failing while it happens. The final text
    // output is therefore the summary only, not a second copy.
    const onCheck = (result: CheckResult) => {
      if (!streaming) return;
      if (opts.quiet && result.status === "passed") return;
      if (result.group !== currentGroup) {
        process.stdout.write(`${currentGroup === undefined ? "" : "\n"}${result.group}:\n`);
        currentGroup = result.group;
      }
      for (const line of renderCheckLines(result, { color: opts.color })) {
        process.stdout.write(`${line}\n`);
      }
    };

    const options: ConformanceOptions = {
      baseUrl,
      version: opts.protocolVersion,
      timeoutMs: opts.timeout,
      maxRedirects: opts.maxRedirects,
      maxResponseBytes: opts.maxResponseBytes,
      maxPages: opts.maxPages,
      maxEntities: opts.maxEntities,
      maxSitemaps: opts.maxSitemaps,
      deadlineMs: opts.deadline,
      allowPrivateNetwork: opts.allowPrivateNetwork,
      failOnWarning: opts.failOnWarning,
      onCheck,
    };
    if (opts.unknownEntityUrl || opts.unknownTypeUrl) {
      options.negativeTargets = {
        ...(opts.unknownEntityUrl ? { unknownEntityUrl: opts.unknownEntityUrl } : {}),
        ...(opts.unknownTypeUrl ? { unknownTypeUrl: opts.unknownTypeUrl } : {}),
      };
    }
    const headers = parseHeaders(opts.header);
    if (Object.keys(headers).length > 0) options.headers = headers;
    if (opts.crossOriginSafeHeader.length > 0) options.crossOriginSafeHeaders = opts.crossOriginSafeHeader;

    let report;
    try {
      if (streaming) {
        process.stdout.write(`AADP v${opts.protocolVersion} conformance — ${baseUrl}\n\n`);
      }
      report = await runConformance(options);
    } catch (err) {
      if (err instanceof UnsupportedConformanceVersionError) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = 3;
        return;
      }
      process.stderr.write(`Could not run conformance against ${baseUrl}: ${(err as Error).message}\n`);
      process.exitCode = 2;
      return;
    }

    const json = renderJsonReport(report);
    if (opts.output) {
      try {
        writeFileSync(opts.output, `${json}\n`, "utf8");
      } catch (err) {
        process.stderr.write(`Could not write report to ${opts.output}: ${(err as Error).message}\n`);
        process.exitCode = 2;
        return;
      }
    }

    if (opts.json) {
      process.stdout.write(`${json}\n`);
    } else {
      process.stdout.write(`\n${renderSummary(report)}\n`);
    }

    process.exitCode = exitCodeFor(report);
  });

program.parseAsync(process.argv);

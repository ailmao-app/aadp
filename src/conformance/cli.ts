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
 * (`docs/vi/plans/implementation-plan.md` §11, priority 1).
 */
import { writeFileSync } from "node:fs";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { runConformance } from "./runner.js";
import { renderJsonReport, renderJUnitReport, renderCheckLines, renderSummary, exitCodeFor } from "./report.js";
import {
  SUPPORTED_CONFORMANCE_VERSIONS,
  CONFORMANCE_PROFILES,
  UnsupportedConformanceVersionError,
  type CheckResult,
  type ConformanceOptions,
} from "./types.js";

interface CliOptions {
  protocolVersion: string;
  profile?: string;
  timeout?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxPages?: number;
  maxEntities?: number;
  maxSitemaps?: number;
  deadline?: number;
  maxTotalBytes?: number;
  retryMaxAttempts?: number;
  retryBaseDelay?: number;
  retryMaxDelay?: number;
  unknownEntityUrl?: string;
  unknownTypeUrl?: string;
  allowPrivateNetwork?: boolean;
  header: string[];
  crossOriginSafeHeader: string[];
  json?: boolean;
  output?: string;
  junit?: string;
  failOnWarning?: boolean;
  quiet?: boolean;
  color?: boolean;
}

/**
 * Parses an integer flag. Range checking is deliberately left to
 * `runConformance`, so the CLI and a programmatic caller enforce exactly
 * the same bounds instead of drifting apart (`--max-redirects 0`, for
 * one, is a meaningful value the API accepts).
 */
function intOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`expected an integer, got "${value}"`);
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

/**
 * Without this, Commander's own argv-parsing failures (missing base-url,
 * unknown flag, `--timeout abc`/NaN/non-integer) call `process.exit(1)`
 * directly — colliding with this CLI's own documented exit code `1`
 * ("one or more checks failed"). A CI job checking `$? === 1` to mean "the
 * deployment is nonconformant" would misread a typo'd flag as a failed
 * run. These never reach `runConformance`, so they belong in the same "the
 * run could not be performed" class as `InvalidConformanceOptionsError`
 * (exit `2`), not "a check failed".
 *
 * `--help`/`--version` still exit `0`: Commander reaches this same override
 * for those too, but they are not argv errors.
 */
program.exitOverride((err) => {
  // `Command._exit()` calls `process.exit(err.exitCode)` right after this
  // callback returns *unless* the callback throws — so setting
  // `process.exitCode` alone would be silently overwritten back to
  // Commander's own exit code. Throwing is the only way to keep ours.
  if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
    process.exitCode = 0;
  } else {
    process.exitCode = 2;
  }
  throw err;
});

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
  .option(
    "--profile <name>",
    `named preset of budget/retry defaults (${CONFORMANCE_PROFILES.join(", ")}); any flag below still overrides ` +
      "the preset's value for that one field"
  )
  .option("--timeout <ms>", "per-request timeout in milliseconds", intOption)
  .option("--max-redirects <n>", "maximum redirect hops per request", intOption)
  .option("--max-response-bytes <n>", "maximum response body size in bytes", intOption)
  .option("--max-pages <n>", "traversal budget: maximum sitemap pages fetched", intOption)
  .option("--max-entities <n>", "traversal budget: maximum entities fetched", intOption)
  .option("--max-sitemaps <n>", "traversal budget: maximum sitemaps the index may list", intOption)
  .option("--deadline <ms>", "traversal budget: wall-clock deadline for the walk", intOption)
  .option("--max-total-bytes <n>", "traversal budget: maximum total response bytes across the whole run", intOption)
  .option(
    "--retry-max-attempts <n>",
    "enable retry: maximum attempts per request, including the first (default 3 once retry is enabled)",
    intOption
  )
  .option("--retry-base-delay <ms>", "enable retry: base exponential-backoff delay in ms (default 500)", intOption)
  .option("--retry-max-delay <ms>", "enable retry: maximum backoff delay in ms, also caps Retry-After (default 10000)", intOption)
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
  .option(
    "--junit <file>",
    "also write a JUnit XML report to <file>, for CI systems that render test results (GitHub Actions " +
      "test-reporter, GitLab, Jenkins, ...) instead of parsing JSON"
  )
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
      profile: opts.profile as ConformanceOptions["profile"],
      timeoutMs: opts.timeout,
      maxRedirects: opts.maxRedirects,
      maxResponseBytes: opts.maxResponseBytes,
      maxPages: opts.maxPages,
      maxEntities: opts.maxEntities,
      maxSitemaps: opts.maxSitemaps,
      deadlineMs: opts.deadline,
      maxTotalBytes: opts.maxTotalBytes,
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
    // Any one of the three flags opts into retry; the others fall back to
    // RetryOptions' own defaults (maxAttempts 3, baseDelayMs 500, maxDelayMs
    // 10000) rather than this CLI inventing a second set of defaults.
    if (opts.retryMaxAttempts !== undefined || opts.retryBaseDelay !== undefined || opts.retryMaxDelay !== undefined) {
      options.retry = {
        ...(opts.retryMaxAttempts !== undefined ? { maxAttempts: opts.retryMaxAttempts } : {}),
        ...(opts.retryBaseDelay !== undefined ? { baseDelayMs: opts.retryBaseDelay } : {}),
        ...(opts.retryMaxDelay !== undefined ? { maxDelayMs: opts.retryMaxDelay } : {}),
      };
    }
    // Not a Commander option-parser (it validates the whole repeated
    // `--header` list at once, after `collect()` has assembled it), so a
    // malformed entry throws here rather than through `exitOverride()` —
    // it needs its own catch, same as every other CLI-level validation
    // error in this action.
    let headers: Record<string, string>;
    try {
      headers = parseHeaders(opts.header);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = 2;
      return;
    }
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
    if (opts.junit) {
      try {
        writeFileSync(opts.junit, `${renderJUnitReport(report, { failOnWarning: opts.failOnWarning })}\n`, "utf8");
      } catch (err) {
        process.stderr.write(`Could not write JUnit report to ${opts.junit}: ${(err as Error).message}\n`);
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

// `exitOverride()` makes Commander throw its `CommanderError` instead of
// calling `process.exit()` after our override callback above already set
// `process.exitCode` — this swallows only that expected rethrow, so it
// doesn't surface as an unhandled rejection with a confusing stack trace.
// Anything else here is a bug in the `.action()` callback itself (every
// *expected* failure inside it already catches its own error and sets
// `process.exitCode`) — it must not be swallowed into a silent exit 0.
program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CommanderError) return;
  process.stderr.write(`Unexpected error: ${(err as Error)?.stack ?? err}\n`);
  process.exitCode = 2;
});

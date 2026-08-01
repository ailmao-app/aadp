#!/usr/bin/env node
/**
 * Release gate (docs/vi/plans/implementation-plan-v1.0.9.md §7.1, §11):
 * package.json version, package-lock.json version, CHANGELOG.md's latest
 * entry and (when run against a tag ref) the Git tag itself must all agree.
 * Meant to run right before `npm publish`, not on every push — the
 * repository legitimately sits ahead of the last release between tags.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`check-release-consistency: ${message}`);
  process.exitCode = 1;
}

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");

const version = pkg.version;
if (typeof version !== "string" || version.length === 0) {
  fail('package.json has no "version".');
}

if (lock.version !== version) {
  fail(`package-lock.json version "${lock.version}" does not match package.json version "${version}".`);
}
if (lock.packages?.[""]?.version !== version) {
  fail(`package-lock.json packages[""].version "${lock.packages?.[""]?.version}" does not match package.json version "${version}".`);
}

const changelogHeading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`, "m");
if (!changelogHeading.test(changelog)) {
  fail(`CHANGELOG.md has no "## ${version}" entry.`);
}

// Only enforced when this runs against a tag ref (release time) — a normal
// branch/PR run has no tag yet and legitimately sits ahead of the last release.
const ref = process.env.GITHUB_REF ?? "";
const tagMatch = /^refs\/tags\/(.+)$/.exec(ref);
if (tagMatch) {
  const tagName = tagMatch[1];
  const expected = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  if (expected !== version) {
    fail(`Git tag "${tagName}" does not match package.json version "${version}".`);
  }
}

if (process.exitCode !== 1) {
  console.log(`check-release-consistency: package.json, package-lock.json and CHANGELOG.md agree on version ${version}.`);
}

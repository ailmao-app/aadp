import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The `scripts` field of `package.json` is published verbatim, but only
 * the paths listed in `files` end up in the tarball. Any script that
 * references a repo file which isn't packaged becomes a command the
 * published package advertises but cannot run (2026-07-26 re-review:
 * `check:iana-ipv6` shipped without `scripts/` in `files`; `validate` had
 * the same defect, pointing at `src/` plus a devDependency loader).
 *
 * This asserts the invariant for every script at once, rather than
 * re-checking the one command that was reported, so a future script that
 * forgets `files` fails here instead of in a consumer's install.
 *
 * Checked against the `files` config rather than a real `npm pack`, so it
 * stays correct on a fresh clone where `dist/` has not been built yet.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  files: string[];
  scripts: Record<string, string>;
};

/**
 * Whether `files` packages `filePath`. Positive entries in this package are
 * plain file or directory names, so a directory entry covers everything
 * beneath it and a file entry must match exactly.
 *
 * Negations (`!...`) are skipped rather than interpreted: the only one
 * excludes `node_modules` at any depth, i.e. generated dependency trees,
 * and can never exclude a script's own source file. What the tarball
 * contains is asserted directly against `npm pack` in
 * `tarball-contents.test.ts`, which is the right place for exclusion
 * semantics — this file is only asking "did someone forget to package a
 * file a published script reads".
 */
function isPackaged(filePath: string): boolean {
  return pkg.files
    .filter((entry) => !entry.startsWith("!"))
    .some((entry) => filePath === entry || filePath.startsWith(`${entry}/`));
}

/**
 * Repo-relative file paths a shell command reads as an argument. Matches
 * bare `dir/file.ext` tokens: enough for this package's `node <file>` and
 * `tsc -p <file>` scripts, and deliberately narrow — a token has to look
 * like a relative path with an extension to be treated as one.
 */
function referencedRepoPaths(command: string): string[] {
  return command.split(/\s+/).filter((token) => /^[\w.@-]+(?:\/[\w.@-]+)+\.[a-z]+$/i.test(token));
}

// `build` and `test` are development-only entry points that run
// devDependency binaries (tsc, vitest) a consumer install never has, so
// requiring their config to be packaged would prove nothing.
const consumerRunnable = Object.entries(pkg.scripts).filter(
  ([name]) => name !== "build" && name !== "test"
);

describe("published package: every npm script's files are actually packaged", () => {
  it.each(consumerRunnable)('script "%s" (%s) references only packaged files', (_name, command) => {
    const referenced = referencedRepoPaths(command);
    expect(referenced.length).toBeGreaterThan(0);
    for (const filePath of referenced) {
      expect(isPackaged(filePath), `${filePath} is not covered by package.json "files"`).toBe(true);
    }
  });

  it("every referenced path that is committed source exists on disk", () => {
    for (const [, command] of consumerRunnable) {
      for (const filePath of referencedRepoPaths(command)) {
        // dist/ is a gitignored build output — absent until `npm run build`.
        if (filePath.startsWith("dist/")) continue;
        expect(existsSync(path.join(repoRoot, filePath)), `${filePath} does not exist`).toBe(true);
      }
    }
  });
});

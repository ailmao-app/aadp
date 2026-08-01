#!/usr/bin/env node
/**
 * `aadp init` / `aadp add-resource <type>` — scaffold starter files for
 * the `defineAADP()`/`defineResource()` server runtime
 * (`docs/vi/plans/implementation-plan.md` §11 "Ưu tiên 2"). Generates
 * files only; it never edits an existing config file, since parsing and
 * rewriting arbitrary user TypeScript is more likely to corrupt it than
 * help — the generated file's own comments tell the user what to wire up
 * by hand.
 */
import { Command } from "commander";
import { scaffoldInit, scaffoldAddResource, ScaffoldFileExistsError } from "./scaffold.js";

const program = new Command();

program.name("aadp").description("Scaffold starter files for the ail-aadp declarative server runtime.");

program
  .command("init")
  .description("Create a starter defineAADP() config file.")
  .option("--dir <path>", "directory to create the file in", "aadp")
  .option("--force", "overwrite the file if it already exists")
  .action((opts: { dir: string; force?: boolean }) => {
    try {
      const { filePath } = scaffoldInit(opts.dir, { force: opts.force });
      process.stdout.write(
        `Created ${filePath}\n\n` +
          "Next steps:\n" +
          "  1. Fill in baseUrl / application / policies.\n" +
          '  2. Run "npx aadp add-resource <type>" for each resource type you publish.\n' +
          "  3. Wire aadp.handleRequest into your framework's route handlers (see the comments in the generated file).\n"
      );
    } catch (err) {
      if (err instanceof ScaffoldFileExistsError) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  });

program
  .command("add-resource")
  .argument("<type>", "AADP resource type, e.g. post")
  .description("Create a starter defineResource() file for <type>.")
  .option("--dir <path>", "directory the config file was created in", "aadp")
  .option("--force", "overwrite the file if it already exists")
  .action((type: string, opts: { dir: string; force?: boolean }) => {
    try {
      const { filePath } = scaffoldAddResource(opts.dir, type, { force: opts.force });
      process.stdout.write(
        `Created ${filePath}\n\n` +
          "Next steps:\n" +
          `  1. Implement list/get/serialize for "${type}".\n` +
          '  2. Import it in your defineAADP() config file and add it to "resources".\n'
      );
    } catch (err) {
      if (err instanceof ScaffoldFileExistsError) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

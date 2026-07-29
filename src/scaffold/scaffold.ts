import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RESOURCE_TYPE_GRAMMAR } from "../server/types.js";
import { initTemplate, resourceTemplate } from "./templates.js";

export class ScaffoldFileExistsError extends Error {
  constructor(public readonly filePath: string) {
    super(`"${filePath}" already exists. Pass --force to overwrite it.`);
    this.name = "ScaffoldFileExistsError";
  }
}

export interface ScaffoldOptions {
  force?: boolean;
}

export interface ScaffoldResult {
  filePath: string;
}

function writeScaffoldFile(
  filePath: string,
  contents: string,
  options: ScaffoldOptions
): ScaffoldResult {
  if (existsSync(filePath) && !options.force) {
    throw new ScaffoldFileExistsError(filePath);
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  return { filePath };
}

/** Writes a starter `defineAADP()` config to `<targetDir>/aadp.server.ts`. */
export function scaffoldInit(targetDir: string, options: ScaffoldOptions = {}): ScaffoldResult {
  return writeScaffoldFile(path.join(targetDir, "aadp.server.ts"), initTemplate(), options);
}

/** Writes a starter `defineResource()` file to `<targetDir>/resources/<type>.ts`. */
export function scaffoldAddResource(
  targetDir: string,
  type: string,
  options: ScaffoldOptions = {}
): ScaffoldResult {
  if (!RESOURCE_TYPE_GRAMMAR.test(type)) {
    throw new Error(
      `"${type}" is not a valid AADP resource type (must match ${RESOURCE_TYPE_GRAMMAR}).`
    );
  }
  return writeScaffoldFile(
    path.join(targetDir, "resources", `${type}.ts`),
    resourceTemplate(type),
    options
  );
}

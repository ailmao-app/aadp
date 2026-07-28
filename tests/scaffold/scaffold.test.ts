import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  scaffoldInit,
  scaffoldAddResource,
  ScaffoldFileExistsError,
} from "../../src/scaffold/scaffold.js";
import { toCamelCase } from "../../src/scaffold/templates.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aadp-scaffold-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("toCamelCase()", () => {
  it("converts kebab-case and snake_case resource types", () => {
    expect(toCamelCase("post")).toBe("post");
    expect(toCamelCase("blog-post")).toBe("blogPost");
    expect(toCamelCase("blog_post")).toBe("blogPost");
  });
});

describe("scaffoldInit()", () => {
  it("writes a starter config file containing defineAADP()", () => {
    const { filePath } = scaffoldInit(dir);
    expect(filePath).toBe(path.join(dir, "aadp.server.ts"));
    const contents = readFileSync(filePath, "utf8");
    expect(contents).toContain("defineAADP");
    expect(contents).toContain("ail-aadp/server");
  });

  it("refuses to overwrite an existing file without --force", () => {
    scaffoldInit(dir);
    expect(() => scaffoldInit(dir)).toThrow(ScaffoldFileExistsError);
  });

  it("overwrites when force is set", () => {
    scaffoldInit(dir);
    expect(() => scaffoldInit(dir, { force: true })).not.toThrow();
  });
});

describe("scaffoldAddResource()", () => {
  it("writes a starter resource file under resources/<type>.ts", () => {
    const { filePath } = scaffoldAddResource(dir, "post");
    expect(filePath).toBe(path.join(dir, "resources", "post.ts"));
    const contents = readFileSync(filePath, "utf8");
    expect(contents).toContain("defineResource");
    expect(contents).toContain('type: "post"');
    expect(contents).toContain("postResource");
  });

  it("camelCases a hyphenated type into the exported const name", () => {
    const { filePath } = scaffoldAddResource(dir, "blog-post");
    const contents = readFileSync(filePath, "utf8");
    expect(contents).toContain("blogPostResource");
    expect(contents).toContain('type: "blog-post"');
  });

  it("rejects an invalid resource type before touching the filesystem", () => {
    expect(() => scaffoldAddResource(dir, "Not_Valid!")).toThrow(/not a valid AADP resource type/);
  });

  it("refuses to overwrite an existing resource file without --force", () => {
    scaffoldAddResource(dir, "post");
    expect(() => scaffoldAddResource(dir, "post")).toThrow(ScaffoldFileExistsError);
    expect(() => scaffoldAddResource(dir, "post", { force: true })).not.toThrow();
  });
});

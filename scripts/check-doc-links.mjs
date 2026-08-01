import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const roots = ["README.md", "docs", "spec"];
const markdownFiles = [];

function collectMarkdownFiles(target) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const child of readdirSync(target)) {
      collectMarkdownFiles(resolve(target, child));
    }
    return;
  }

  if (extname(target) === ".md") {
    markdownFiles.push(resolve(target));
  }
}

for (const root of roots) {
  collectMarkdownFiles(root);
}

const failures = [];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdownFiles) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    const pathTarget = rawTarget.split("#", 1)[0];

    if (!pathTarget || /^[a-z][a-z0-9+.-]*:/i.test(pathTarget)) {
      continue;
    }

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(pathTarget);
    } catch {
      failures.push(`${file}: malformed link target ${rawTarget}`);
      continue;
    }

    if (!existsSync(resolve(dirname(file), decodedTarget))) {
      failures.push(`${file}: missing ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files; all relative links resolve.`);
}

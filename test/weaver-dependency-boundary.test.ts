import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const authoritativeRoots = [
  "domains/shortlet/src",
  "packages/platform-core/src",
];
const weaverImport = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']@weaver\/(?:core|web)["']/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

test("authoritative application and domain files do not import Weaver", async () => {
  const violations: string[] = [];

  for (const relativeRoot of authoritativeRoots) {
    const absoluteRoot = path.join(repositoryRoot, relativeRoot);
    for (const file of await sourceFiles(absoluteRoot)) {
      if (weaverImport.test(await readFile(file, "utf8"))) {
        violations.push(path.relative(repositoryRoot, file));
      }
    }
  }

  assert.deepEqual(violations, []);
});

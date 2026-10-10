import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const authoritativeRoots = [
  "domains/shortlet/src",
  "packages/platform-core/src",
];
const weaverImport = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']@weaver\/(?:core|web)["']/;
const obsoleteWeaverName = new RegExp(["@weaver", "(?:core|web)"].join("\\/"));

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

test("published Weaver packages are pinned and no vendored or obsolete package remains", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const packageLock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { resolved?: string; integrity?: string }>;
  };
  for (const name of ["@cylayo/weaver-core", "@cylayo/weaver-web"]) {
    assert.equal(packageJson.dependencies?.[name], "0.2.1", `${name} must use the exact published version`);
    assert.match(packageLock.packages?.[`node_modules/${name}`]?.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//);
    assert.match(packageLock.packages?.[`node_modules/${name}`]?.integrity ?? "", /^sha512-/);
  }
  assert.equal(await access(path.join(repositoryRoot, "vendor/weaver")).then(() => true, () => false), false);
  assert.equal(await access(path.join(repositoryRoot, "scripts/verify-weaver-vendor.mjs")).then(() => true, () => false), false);
  assert.equal(packageJson.dependencies?.[["@weaver", "core"].join("/")], undefined);
  assert.equal(packageJson.dependencies?.[["@weaver", "web"].join("/")], undefined);

  const violations: string[] = [];
  for (const relativeRoot of ["apps", "scripts", "test"]) {
    for (const file of await sourceFiles(path.join(repositoryRoot, relativeRoot))) {
      if (!file.endsWith(".ts") && !file.endsWith(".js") && !file.endsWith(".mjs")) continue;
      if (obsoleteWeaverName.test(await readFile(file, "utf8"))) violations.push(path.relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});

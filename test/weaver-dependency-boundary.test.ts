import assert from "node:assert/strict";
import { access, lstat, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const authoritativeRoots = [
  "domains/shortlet/src",
  "packages/platform-core/src",
];
const legacyWeaverImport = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']@weaver\/(?:core|web)["']/;
const anyWeaverImport = /(?:\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']@(?:cylayo\/weaver-(?:core|web)|weaver\/(?:core|web))["']/;

async function sourceFiles(directory: string, ancestors: readonly string[] = []): Promise<string[]> {
  const canonical = await realpath(directory);
  if (ancestors.includes(canonical)) return [];
  const nextAncestors = [...ancestors, canonical];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (entry.name === "node_modules") return [];
    const entryPath = path.join(directory, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      const targetStat = await stat(entryPath);
      if (targetStat.isDirectory()) return sourceFiles(entryPath, nextAncestors);
      if (targetStat.isFile()) return [entryPath];
      throw new Error(`Unsupported source link target: ${entryPath}`);
    }
    if (entry.isDirectory()) return sourceFiles(entryPath, nextAncestors);
    if (entry.isFile()) return [entryPath];
    throw new Error(`Unsupported source entry: ${entryPath}`);
  }));
  return files.flat();
}

test("AC1 — package.json pins both Weaver 0.2.1 dependencies and the lockfile resolves registry integrity", async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
  };
  for (const name of ["@cylayo/weaver-core", "@cylayo/weaver-web"]) {
    assert.equal(manifest.dependencies[name], "0.2.1", `${name} must be exactly pinned`);
    const resolved = lock.packages[`node_modules/${name}`];
    assert.equal(resolved?.version, "0.2.1");
    assert.match(resolved?.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//);
    assert.match(resolved?.integrity ?? "", /^sha512-/);
  }
});

test("AC2 — source, tests and scripts use no legacy Weaver imports or vendor verifier", async () => {
  const violations: string[] = [];
  for (const relativeRoot of ["apps", "scripts", "test"]) {
    for (const file of await sourceFiles(path.join(repositoryRoot, relativeRoot))) {
      if (legacyWeaverImport.test(await readFile(file, "utf8"))) violations.push(path.relative(repositoryRoot, file));
    }
  }
  assert.deepEqual(violations, []);
  for (const relativePath of ["vendor/weaver", "scripts/verify-weaver-vendor.mjs"]) {
    await assert.rejects(access(path.join(repositoryRoot, relativePath)), `${relativePath} must not exist`);
  }
});

test("AC2 source scan follows linked source files but excludes dependency junctions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "weaver-boundary-links-"));
  try {
    const linkedSourceDirectory = path.join(root, "linked-source");
    const dependencyDirectory = path.join(root, "dependency-cache");
    await mkdir(linkedSourceDirectory);
    await mkdir(dependencyDirectory);
    await writeFile(path.join(linkedSourceDirectory, "forbidden.ts"), 'import "@weaver/' + 'core";\n');
    await writeFile(path.join(dependencyDirectory, "vendor.ts"), 'import "@weaver/' + 'core";\n');
    await symlink(linkedSourceDirectory, path.join(root, "source-link"), "junction");
    await symlink(dependencyDirectory, path.join(root, "node_modules"), "junction");

    const linkedSourceFile = path.join(root, "source-link", "forbidden.ts");
    const files = await sourceFiles(root);
    assert.ok(files.includes(linkedSourceFile), "the scanner follows source directories reached through junctions");
    assert.match(await readFile(linkedSourceFile, "utf8"), legacyWeaverImport);
    assert.ok(!files.includes(path.join(root, "node_modules", "vendor.ts")), "the scanner excludes dependency junctions");

    const fileAlias = path.join(root, "source-alias.ts");
    let fileAliasSupported = true;
    try {
      await symlink(path.join(linkedSourceDirectory, "forbidden.ts"), fileAlias, "file");
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "EPERM" || code === "ENOTSUP" || code === "EACCES") fileAliasSupported = false;
      else throw error;
    }
    if (fileAliasSupported) assert.ok((await sourceFiles(root)).includes(fileAlias), "the scanner reads forbidden imports through file links");
    else t.diagnostic("This Windows account cannot create file symlinks; the source-directory junction assertion still ran.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("AC3 — authoritative application and domain files do not import Weaver", async () => {
  const violations: string[] = [];

  for (const relativeRoot of authoritativeRoots) {
    const absoluteRoot = path.join(repositoryRoot, relativeRoot);
    for (const file of await sourceFiles(absoluteRoot)) {
      if (anyWeaverImport.test(await readFile(file, "utf8"))) {
        violations.push(path.relative(repositoryRoot, file));
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("Weaver's published default safety policy keeps the documented limits", async () => {
  const safety = await readFile(path.join(repositoryRoot, "node_modules/@cylayo/weaver-core/dist/runtime/safety.js"), "utf8");
  assert.match(safety, /DEFAULT_MAX_RESOLUTION_DEPTH\s*=\s*32/);
  assert.match(safety, /DEFAULT_MAX_RESOLVED_INSTANCES\s*=\s*1000/);
});

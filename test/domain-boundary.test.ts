import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A domain exposes exactly one module: `domains/<domain>/src/index.ts`. No file outside a
// domain may import a path past that index (ADR 0099). This test enforces the rule with a
// ratchet: the violations that exist today are recorded in
// `test/fixtures/domain-boundary-allowlist.json`, a new (file, module) pair fails, and a
// listed pair that no longer exists also fails so the list can only shrink.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

type Pair = [file: string, module: string];

interface Source {
  readonly path: string;
  readonly source: string;
}

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
  ".git",
  ".scratch",
  "dist",
  "build",
  "coverage",
]);

const importSpecifier =
  /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?|\b(?:import|require)\s*\()\s*["']([^"']+)["']/g;

function normalize(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isTestFile(relativePath: string): boolean {
  if (relativePath.split("/").includes("test")) return true;
  return /\.(?:test|spec)\.ts$/.test(relativePath);
}

// Reduces an import specifier to the deep domain module it names, or null when it targets
// `domains/<domain>/src/index` (the façade) or anything outside a domain's `src`.
function deepModule(specifier: string): string | null {
  const normalized = specifier.replace(/\\/g, "/").replace(/\.(?:ts|tsx|js|mjs|cjs)$/, "");
  const match = normalized.match(/(?:^|\/)domains\/([^/]+)\/src\/(.+)$/);
  if (!match || match[2] === "index") return null;
  return `domains/${match[1]}/src/${match[2]}`;
}

function belongsToModuleDomain(file: string, module: string): boolean {
  const domain = module.split("/")[1];
  return file.startsWith(`domains/${domain}/`);
}

function pairKey([file, module]: Pair): string {
  return `${file}\u0000${module}`;
}

function comparePairs(a: Pair, b: Pair): number {
  return a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]);
}

function deepDomainImports(sources: readonly Source[]): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const file of sources) {
    const relativePath = normalize(file.path);
    for (const match of file.source.matchAll(importSpecifier)) {
      const module = deepModule(match[1]);
      if (!module || belongsToModuleDomain(relativePath, module)) continue;
      const pair: Pair = [relativePath, module];
      pairs.set(pairKey(pair), pair);
    }
  }
  return [...pairs.values()].sort(comparePairs);
}

function boundaryReport(
  sources: readonly Source[],
  allowlist: readonly Pair[],
): { unlisted: Pair[]; stale: Pair[] } {
  const found = deepDomainImports(sources);
  const foundKeys = new Set(found.map(pairKey));
  const allowedKeys = new Set(allowlist.map(pairKey));
  return {
    unlisted: found.filter((pair) => !allowedKeys.has(pairKey(pair))),
    stale: allowlist.filter((pair) => !foundKeys.has(pairKey(pair))).slice().sort(comparePairs),
  };
}

async function collectSources(directory: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await collectSources(path.join(directory, entry.name), out);
    } else if (entry.name.endsWith(".ts")) {
      const file = path.join(directory, entry.name);
      if (!isTestFile(normalize(path.relative(repositoryRoot, file)))) out.push(file);
    }
  }
  return out;
}

async function repositorySources(): Promise<Source[]> {
  const files = await collectSources(repositoryRoot);
  return Promise.all(
    files.map(async (file) => ({
      path: path.relative(repositoryRoot, file),
      source: await readFile(file, "utf8"),
    })),
  );
}

const allowlist = JSON.parse(
  readFileSync(new URL("./fixtures/domain-boundary-allowlist.json", import.meta.url), "utf8"),
) as Pair[];

test("AC1: A new deep import outside the allow-list fails the test", () => {
  const sources: Source[] = [
    {
      path: "apps/web/src/rogue.ts",
      source: `import { BookingStateRepository } from "../../../domains/shortlet/src/booking-state.js";`,
    },
  ];

  const report = boundaryReport(sources, []);

  assert.deepEqual(report.unlisted, [
    ["apps/web/src/rogue.ts", "domains/shortlet/src/booking-state"],
  ]);
});

test("AC2: A stale allow-list entry (pair no longer present) fails the test", () => {
  const sources: Source[] = [
    {
      path: "apps/web/src/clean.ts",
      source: `import { x } from "../../../domains/shortlet/src/index.js";`,
    },
  ];
  const staleEntry: Pair = ["apps/web/src/gone.ts", "domains/shortlet/src/booking-state"];

  const report = boundaryReport(sources, [staleEntry]);

  assert.deepEqual(report.stale, [staleEntry]);
  assert.deepEqual(report.unlisted, []);
});

test("AC3: Imports through domains/<d>/src/index and imports inside the same domain pass", () => {
  const sources: Source[] = [
    {
      path: "apps/web/src/ok.ts",
      source: `import { stay } from "../../../domains/shortlet/src/index.js";`,
    },
    {
      path: "domains/shortlet/src/inside.ts",
      source: `import { sibling } from "../../../domains/shortlet/src/booking-state.js";`,
    },
  ];

  assert.deepEqual(deepDomainImports(sources), []);
});

test("AC4: The repository has no unlisted deep import and no stale allow-list entry", async () => {
  const report = boundaryReport(await repositorySources(), allowlist);

  assert.deepEqual(report.unlisted, []);
  assert.deepEqual(report.stale, []);
});

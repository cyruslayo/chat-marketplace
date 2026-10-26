import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The shared import-graph reader for the boundary tests (ADR 0099, ADR 0100 decision 1, ADR 0104 decision 6). One
 * reader, so every boundary test counts the same edges: static `import`, `export ... from`, side-effect `import "x"`,
 * literal `import("x")`, and type-only edges. Only relative specifiers are followed. Raw `?raw` inputs are bundler
 * inputs, not module edges, and are skipped. A non-literal `import(expression)` cannot be resolved here and is not
 * followed, so a test that needs that guarantee must not rely on this reader alone.
 */

/** The repository root (this file sits in test/helpers/). */
export const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// `import x from "a"`, `import type {...} from "a"`, `export {...} from "a"`, `import "a"`. The specifier list may span lines.
const STATIC_EDGE = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"'`\n]+)["']/g;
// `import("a")` with a literal specifier.
const DYNAMIC_EDGE = /\bimport\s*\(\s*["']([^"'`\n]+)["']\s*\)/g;

/** Every specifier a source file names, in any import form. */
export function specifiersIn(source: string): string[] {
  return [...source.matchAll(STATIC_EDGE), ...source.matchAll(DYNAMIC_EDGE)].map((match) => match[1]!);
}

/** Forward-slash path of an absolute file, relative to the repository root. */
export function repositoryPath(absolute: string): string {
  return relative(REPOSITORY_ROOT, absolute).split("\\").join("/");
}

/** The repository-relative files one file imports directly (any form, type-only included). Missing targets are dropped. */
export function importsOf(repositoryFile: string): string[] {
  const file = join(REPOSITORY_ROOT, repositoryFile);
  const targets: string[] = [];
  for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
    if (!specifier.startsWith(".") || specifier.includes("?")) continue;
    const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
    if (existsSync(target)) targets.push(repositoryPath(target));
  }
  return targets;
}

/** Every repository-relative file reachable from an entry file through import edges, the entry included, sorted. */
export function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  return [...seen].sort();
}

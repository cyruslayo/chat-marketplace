import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ImportRefusedError, importBatch } from "../apps/cloudflare/src/ops-import-core.js";
import type { SqlDatabase } from "../packages/platform-core/src/sql-database.js";

/**
 * guest-identity-assurance AC5 (review 1) and the commerce object's runtime boundary (ADR 0099, ADR 0101). ops-import.ts imports
 * the Shortlet guest identity store, so the commerce object reaches only the neutral core, and the core refuses the identity
 * table unless the caller supplies the identity rule.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMERCE_OBJECT = "apps/cloudflare/src/commerce-market-do.ts";
const CORE = "apps/cloudflare/src/ops-import-core.ts";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const specifiersOf = (source: string) => [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
/** Forward-slash path relative to the repository root. */
const relative = (absolute: string) => absolute.slice(ROOT.length).split("\\").join("/");
/** Resolves a relative specifier (a .js import of a .ts source) to its absolute source file. */
const resolveSpecifier = (from: string, specifier: string) => resolve(dirname(join(ROOT, from)), specifier.replace(/\.js$/, ".ts"));

/** Every source file under the given roots (.ts only), as repository-relative paths. */
function sourcesUnder(roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) out.push(relative(path));
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  return out;
}

/** Every relative module reachable from a file through its import edges, type-only edges included. */
function runtimeClosure(start: string): string[] {
  const seen = new Set<string>();
  const queue = [join(ROOT, start)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  }
  return [...seen].map(relative);
}

test("the commerce object imports the neutral ops import core, never ops-import.ts (which reaches the assurance store)", () => {
  const specifiers = specifiersOf(read(COMMERCE_OBJECT));
  assert.ok(specifiers.includes("./ops-import-core.js"), "commerce-market-do imports ./ops-import-core.js");
  assert.equal(specifiers.includes("./ops-import.js"), false, "commerce-market-do does not import ./ops-import.js");
});

test("the neutral ops import core imports no guest identity assurance module and not the Shortlet import surface", () => {
  const specifiers = specifiersOf(read(CORE));
  assert.equal(specifiers.some((specifier) => specifier.includes("guest-identity-assurance")), false);
  assert.equal(specifiers.some((specifier) => specifier.endsWith("ops-import.js")), false);
});

test("the identity assurance rule stays in ops-import.ts, which supplies it to the core as a hook", () => {
  assert.ok(specifiersOf(read("apps/cloudflare/src/ops-import.ts")).some((specifier) => specifier.includes("guest-identity-assurance")));
});

test("the core refuses the identity assurance table when no identity rule is supplied, and writes nothing", () => {
  // The refusal runs before any database access, so a stub database is enough: nothing may be read or written.
  const untouched = {} as SqlDatabase;
  assert.throws(
    () => importBatch(untouched, "guest_identity_assurance", [{ guest_id: "g" }], 1, new Date()),
    (error: unknown) => error instanceof ImportRefusedError && (error as ImportRefusedError).message.includes("identity assurance"),
  );
});

test("the importers of the neutral ops import core are exactly the commerce object and the Shortlet import surface", () => {
  const target = join(ROOT, CORE);
  // Production sources only: test files exercise the core directly and are not part of the runtime boundary.
  const importers = sourcesUnder(["apps", "packages", "domains", "scripts"])
    .filter((file) => specifiersOf(read(file)).some((specifier) => specifier.startsWith(".") && resolveSpecifier(file, specifier) === target))
    .sort();
  assert.deepEqual(importers, ["apps/cloudflare/src/commerce-market-do.ts", "apps/cloudflare/src/ops-import.ts"]);
});

test("the commerce object's full runtime closure, type-only edges included, reaches no Shortlet domain, pilot config, local guest or pilot app", () => {
  const closure = runtimeClosure(COMMERCE_OBJECT);
  const forbidden = closure.filter((file) =>
    file.startsWith("domains/shortlet/") ||
    file.endsWith("pilot-config-core.ts") ||
    file.startsWith("apps/local-guest/") ||
    file.startsWith("apps/pilot/") ||
    file.endsWith("guest-identity-assurance.ts") ||
    file.endsWith("apps/cloudflare/src/schema.ts") ||
    file.endsWith("apps/cloudflare/src/ops-import.ts"),
  );
  assert.deepEqual(forbidden, []);
});

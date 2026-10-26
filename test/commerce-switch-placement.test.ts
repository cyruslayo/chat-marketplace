import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMMERCE_ENABLED_VARIABLE, commerceEnabledFromEnv } from "../packages/commerce-switch/src/commerce-switch.js";

// ADR 0104 decision 5 and the placement decision recorded in it. The COMMERCE_ENABLED parser is read by apartment and shortlet code,
// and ADR 0099 says shortlet never imports commerce, so the parser lives in a neutral package that imports nothing from apps/ or domains/.
// These tests fix that placement: one parser, outside the commerce domain, reached by every host and by the commerce object.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PARSER = "packages/commerce-switch/src/commerce-switch.ts";
const RETIRED_PARSER = "domains/commerce/src/commerce-switch.ts";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const specifiersOf = (source: string) => [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g)]
  .map((match) => match[1] ?? match[2] ?? match[3] ?? "");
const forwardSlashes = (path: string) => path.split("\\").join("/");

/** Every file reachable from a start file through relative import edges (type-only edges included), as repository-relative paths. */
function runtimeClosure(start: string): string[] {
  const seen = new Set<string>();
  const queue = [join(ROOT, start)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      // Raw text imports (`?raw`) are bundler inputs, not modules; the boundary is about module edges.
      if (!specifier.startsWith(".") || specifier.includes("?")) continue;
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].map((file) => forwardSlashes(relative(ROOT, file)));
}

test("AC1: the COMMERCE_ENABLED parser lives in packages/commerce-switch and the commerce domain copy is retired", () => {
  assert.equal(existsSync(join(ROOT, PARSER)), true);
  assert.equal(existsSync(join(ROOT, RETIRED_PARSER)), false);
});

test("AC2: the parser imports nothing from apps/ or domains/ (shortlet and apartment code may read the switch without the commerce domain)", () => {
  const source = read(PARSER);
  const escaping = specifiersOf(source).filter((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = forwardSlashes(relative(ROOT, resolve(dirname(join(ROOT, PARSER)), specifier)));
    return target.startsWith("apps/") || target.startsWith("domains/");
  });
  assert.deepEqual(escaping, []);
});

test("AC3: the parser keeps its behaviour: unset, empty and exactly \"false\" are off; exactly \"true\" is on; any other value throws and does not echo it", () => {
  assert.equal(COMMERCE_ENABLED_VARIABLE, "COMMERCE_ENABLED");
  assert.equal(commerceEnabledFromEnv({}), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "" }), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "false" }), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "true" }), true);
  assert.throws(
    () => commerceEnabledFromEnv({ COMMERCE_ENABLED: "yes-please-secret-value" }),
    (error: unknown) => error instanceof Error && error.message.includes(COMMERCE_ENABLED_VARIABLE) && !error.message.includes("yes-please-secret-value"),
  );
});

test("AC4: the commerce object's runtime closure reads the switch from packages/commerce-switch, never from domains/commerce", () => {
  const closure = runtimeClosure("apps/cloudflare/src/commerce-market-do.ts");
  assert.ok(closure.includes(PARSER), "the commerce object reaches the parser");
  assert.equal(closure.includes(RETIRED_PARSER), false);
});

test("AC5: the shortlet pilot DO's runtime closure reaches the switch through packages/commerce-switch and not through domains/commerce/src/commerce-switch", () => {
  const closure = runtimeClosure("apps/cloudflare/src/shortlet-pilot-do.ts");
  assert.ok(closure.includes(PARSER), "the shortlet pilot object reaches the parser");
  assert.equal(closure.includes(RETIRED_PARSER), false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Final review (guest-identity-assurance AC5, review 1): ops-import.ts imports the guest identity assurance store, so anything
 * that imports ops-import.ts can reach the store. The CommerceMarket object needs only the generic batch import and export,
 * so it imports the neutral core, which imports no assurance module.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const importsOf = (source: string) => [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);

test("commerce object imports the neutral ops import core, never ops-import.ts (which reaches the assurance store)", () => {
  const specifiers = importsOf(read("apps/cloudflare/src/commerce-market-do.ts"));
  assert.ok(specifiers.includes("./ops-import-core.js"), "commerce-market-do imports ./ops-import-core.js");
  assert.equal(specifiers.includes("./ops-import.js"), false, "commerce-market-do does not import ./ops-import.js");
});

test("the neutral ops import core imports no guest identity assurance module, directly or through a store path", () => {
  const specifiers = importsOf(read("apps/cloudflare/src/ops-import-core.ts"));
  assert.equal(specifiers.some((specifier) => specifier.includes("guest-identity-assurance")), false);
  assert.equal(specifiers.some((specifier) => specifier.endsWith("ops-import.js")), false);
});

test("the identity assurance rule stays in ops-import.ts, which supplies it to the core as a hook", () => {
  assert.ok(importsOf(read("apps/cloudflare/src/ops-import.ts")).some((specifier) => specifier.includes("guest-identity-assurance")));
});

/** Every relative module reachable from a file through imports, resolved to a .ts source (the guard's own reachability logic). */
function reachableFrom(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const target = fileURLToPath(new URL(specifier.replace(/\.js$/, ".ts"), new URL(`file://${file}`)));
      queue.push(target);
    }
  }
  return seen;
}

test("the commerce object's full import closure reaches no guest identity assurance module and no Shortlet schema", () => {
  const closure = reachableFrom(`${ROOT}apps/cloudflare/src/commerce-market-do.ts`).values();
  const reached = [...closure].map((file) => file.slice(ROOT.length).split(String.fromCharCode(92)).join("/"));
  const guarded = ["domains/shortlet/src/guest-identity-assurance.ts", "domains/shortlet/src/guest-check-in-eligibility.ts", "apps/cloudflare/src/schema.ts", "apps/cloudflare/src/ops-import.ts"];
  const forbidden = reached.filter((file) => guarded.some((path) => file.endsWith(path)));
  assert.deepEqual(forbidden, []);
});

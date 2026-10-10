import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planTestPhases } from "../scripts/test-phases.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

const allTestFiles = readdirSync(join(root, "test"))
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => `test/${name}`)
  .sort();

// A direct call, not the bare name: this file mentions the name in its own text.
const callsChromeDirectly = (file: string) => /launchRealBrowser\(/.test(readFileSync(join(root, file), "utf8"));

test("the default plan puts every test file in exactly one phase", () => {
  const plan = planTestPhases({ root, args: [] });
  const placed = [...plan.concurrent, ...plan.browser].sort();
  assert.deepEqual(placed, allTestFiles);
  assert.equal(new Set(placed).size, placed.length, "a file appears in both phases");
  assert.ok(plan.browser.length > 0, "the default plan keeps the real-browser phase");
});

test("every file that calls launchRealBrowser directly is in the browser phase", () => {
  const plan = planTestPhases({ root, args: [] });
  const direct = allTestFiles.filter(callsChromeDirectly);
  assert.ok(direct.length > 0);
  assert.ok(direct.every((file) => plan.browser.includes(file)), "a Chrome-driving file is in the concurrent phase");
  assert.ok(plan.concurrent.every((file) => !callsChromeDirectly(file)), "a concurrent file calls launchRealBrowser");
});

test("--non-browser plan runs no real-browser files and keeps every other file", () => {
  const defaults = planTestPhases({ root, args: [] });
  const nonBrowser = planTestPhases({ root, args: ["--non-browser"] });
  assert.deepEqual(nonBrowser.browser, []);
  assert.deepEqual(nonBrowser.concurrent, defaults.concurrent);
});

test("--browser-only plan runs only the real-browser files, one phase", () => {
  const defaults = planTestPhases({ root, args: [] });
  const browserOnly = planTestPhases({ root, args: ["--browser-only"] });
  assert.deepEqual(browserOnly.concurrent, []);
  assert.deepEqual(browserOnly.browser, defaults.browser);
  assert.deepEqual(browserOnly.extra, []);
});

test("--non-browser is consumed and not forwarded to node --test", () => {
  const plan = planTestPhases({ root, args: ["--non-browser", "--test-name-pattern=abc"] });
  assert.deepEqual(plan.extra, ["--test-name-pattern=abc"]);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The local guest server reads apps/local-guest/dist/client.js from disk, and that file is not rebuilt per change. The browser job
 * therefore builds the current client before any real-browser test runs (issue 08 follow-up, delegated decision).
 */
const workflow = readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
const browserJob = workflow.slice(workflow.indexOf("\n  browser:"));

test("CI browser job builds the guest client bundle before the real-browser tests run", () => {
  const build = browserJob.indexOf("run: npm run build");
  const browserTests = browserJob.indexOf("run: npm run test:browser");
  assert.ok(build >= 0, "the browser job runs npm run build");
  assert.ok(browserTests > build, "the build runs before npm run test:browser");
});

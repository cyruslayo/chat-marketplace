import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BROWSER_FILE_TIMEOUT_MS, browserFileTimeoutMs, runBrowserFile } from "../scripts/browser-phase.mjs";

// Phase 2 of `npm test` runs each real-browser file in its own process under a timeout. A file that stalls is killed
// (with its browser children) and reported as timed out, and the run goes on to the next file.
const root = fileURLToPath(new URL("..", import.meta.url));
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const fixture = (name: string) => `test/fixtures/browser-timeout/${name}`;

test("A browser file that runs past its timeout is killed and reported as timed out, in a few seconds", async () => {
  const started = Date.now();
  const result = await runBrowserFile({ root, tsx, file: fixture("sleeps.test.ts"), extra: [], timeoutMs: 2_000, log: () => {} });
  assert.equal(result.status, "timed-out");
  assert.equal(result.file, fixture("sleeps.test.ts"));
  assert.ok(Date.now() - started < 60_000, "the sleeping file did not run to completion");
});

test("A browser file that finishes within its timeout passes", async () => {
  const result = await runBrowserFile({ root, tsx, file: fixture("passes.test.ts"), extra: [], timeoutMs: 120_000, log: () => {} });
  assert.equal(result.status, "passed");
  assert.equal(result.exitCode, 0);
});

test("The per-file timeout defaults to about 2.4 times the slowest browser file, and an environment variable overrides it", () => {
  assert.equal(BROWSER_FILE_TIMEOUT_MS, 900_000);
  assert.equal(browserFileTimeoutMs({}), 900_000);
  assert.equal(browserFileTimeoutMs({ SHORTLET_BROWSER_FILE_TIMEOUT_MS: "1500" }), 1500);
  assert.throws(() => browserFileTimeoutMs({ SHORTLET_BROWSER_FILE_TIMEOUT_MS: "soon" }), /SHORTLET_BROWSER_FILE_TIMEOUT_MS/);
});

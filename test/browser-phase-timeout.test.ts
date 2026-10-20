import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BROWSER_FILE_TIMEOUT_MS, browserFileTimeoutMs, killProcessTree, runBrowserFile } from "../scripts/browser-phase.mjs";

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

test("The final buffered TAP summary is parsed after the child streams close", async () => {
  const runner = join(root, "test/fixtures/browser-timeout/buffered-runner.mjs");
  const file = fixture("passes.test.ts");
  const result = await runBrowserFile({ root, tsx: runner, file, timeoutMs: 5000, log: () => {} });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.summary, { tests: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0 });
});

test("The deadline settles when a grandchild keeps stdout open after the runner exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "browser-phase-pipe-holder-"));
  const pidFile = join(dir, "child.pid");
  const runner = join(root, "test/fixtures/browser-timeout/descendant-holds-output.mjs");
  try {
    const started = Date.now();
    const result = await runBrowserFile({ root, tsx: runner, file: pidFile, timeoutMs: 1200, log: () => {} });
    assert.equal(result.status, "timed-out");
    assert.ok(Date.now() - started < 10_000, "the result settled at the configured deadline");
  } finally {
    if (await import("node:fs").then(({ existsSync }) => existsSync(pidFile))) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (Number.isInteger(pid) && pid > 0) killProcessTree(pid);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("The per-file timeout defaults to about 2.4 times the slowest browser file, and an environment variable overrides it", () => {
  assert.equal(BROWSER_FILE_TIMEOUT_MS, 900_000);
  assert.equal(browserFileTimeoutMs({}), 900_000);
  assert.equal(browserFileTimeoutMs({ SHORTLET_BROWSER_FILE_TIMEOUT_MS: "1500" }), 1500);
  assert.throws(() => browserFileTimeoutMs({ SHORTLET_BROWSER_FILE_TIMEOUT_MS: "soon" }), /SHORTLET_BROWSER_FILE_TIMEOUT_MS/);
});

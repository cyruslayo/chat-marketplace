import test from "node:test";
import assert from "node:assert/strict";
import { aggregateBrowserPhase, browserFileStatus, formatBrowserPhaseTotals, parseTapSummary } from "../scripts/browser-phase.mjs";

// Phase 2 is one line per file in the totals: each file's own TAP summary is read back from its output. A file with no
// summary (a crash, or a timeout that killed it) counts as failed, and a timed-out file is shown as timed out.

const summary = (pass: number, fail = 0, skipped = 0) => ({ tests: pass + fail + skipped, pass, fail, skipped, cancelled: 0 });

test("parseTapSummary reads the last summary of each counter from a file's output", () => {
  const output = [
    "# Subtest: a",
    "ok 1 - a",
    "# tests 2",
    "# pass 2",
    "# fail 0",
    "# skipped 0",
    "# cancelled 0",
    "# tests 3",
    "# pass 1",
    "# fail 2",
    "# skipped 0",
    "# cancelled 0",
  ].join("\n");
  assert.deepEqual(parseTapSummary(output), { tests: 3, pass: 1, fail: 2, skipped: 0, cancelled: 0 });
});

test("parseTapSummary returns undefined when a file printed no summary (a crash)", () => {
  assert.equal(parseTapSummary("TypeError: boom\n    at file.ts:1\n"), undefined);
});

test("A file's status is passed only when it exits zero with no failing test; anything else is failed or timed out", () => {
  assert.equal(browserFileStatus({ timedOut: false, exitCode: 0, summary: summary(3) }), "passed");
  assert.equal(browserFileStatus({ timedOut: false, exitCode: 1, summary: summary(2, 1) }), "failed");
  assert.equal(browserFileStatus({ timedOut: false, exitCode: 1, summary: undefined }), "failed", "a crash with no summary");
  assert.equal(browserFileStatus({ timedOut: true, exitCode: null, summary: undefined }), "timed-out");
});

test("The phase totals add the files' counters, and a timed-out file and a crash both count as failed", () => {
  const totals = aggregateBrowserPhase([
    { file: "test/a-chromium.test.ts", status: "passed", summary: summary(10) },
    { file: "test/b-chromium.test.ts", status: "failed", summary: summary(4, 1, 1) },
    { file: "test/c-chromium.test.ts", status: "timed-out", summary: undefined },
    { file: "test/d-chromium.test.ts", status: "failed", summary: undefined },
  ]);
  assert.deepEqual(totals, {
    files: 4,
    passed: 1,
    failed: 3,
    timedOut: 1,
    tests: 16,
    pass: 14,
    fail: 1,
    skipped: 1,
    cancelled: 0,
  });
});

test("The totals print in the same '# tests N' format as before, then one phase line", () => {
  const lines = formatBrowserPhaseTotals(
    aggregateBrowserPhase([
      { file: "test/a.test.ts", status: "passed", summary: summary(5) },
      { file: "test/b.test.ts", status: "timed-out", summary: undefined },
    ])
  );
  assert.deepEqual(lines, [
    "# tests 5",
    "# pass 5",
    "# fail 0",
    "# skipped 0",
    "# cancelled 0",
    "# Phase 2: 2 files, 1 passed, 1 failed, 1 timed out",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatParityReport, passAllK } from "../scripts/parity-live-report.js";
import { ROWS } from "./helpers/parity-rows.js";

// Issue 16 (AC4): the owner-run live report. Its formatting and its no-guest-text rule are tested offline; the live run is never run here.

test("parity live report: pass^k is true only when every run passed", () => {
  assert.equal(passAllK([true, true, true, true, true]), true);
  assert.equal(passAllK([true, true, false, true, true]), false);
  assert.equal(passAllK([]), false);
});

test("parity live report: one line per row with passes out of k, then the total pass^k", () => {
  const report = formatParityReport([{ name: "row a", passes: 5 }, { name: "row b", passes: 4 }], 5);
  assert.equal(report, "row a: 5/5 passed, pass^5 yes\nrow b: 4/5 passed, pass^5 no\npass^5 over all rows: no");
  assert.equal(formatParityReport([{ name: "row a", passes: 5 }], 5).split("\n").at(-1), "pass^5 over all rows: yes");
});

test("parity live report: prints row labels and counts only, never guest text", () => {
  // Every guest message the rows send must stay out of the report (ADR 0075). The report takes only labels and counts.
  const report = formatParityReport(ROWS.map((row) => ({ name: row.name, passes: 5 })), 5);
  for (const row of ROWS) {
    for (const turn of row.turns) {
      if ("text" in turn) assert.equal(report.includes(turn.text), false, `guest text leaked: ${turn.text}`);
    }
  }
});

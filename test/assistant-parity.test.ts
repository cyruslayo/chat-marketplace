import test from "node:test";
import assert from "node:assert/strict";
import { runParityPath } from "./helpers/parity-fixture.js";
import { ROWS } from "./helpers/parity-rows.js";

// Issue 16 (ADR 0080, ADR 0106): the same guest turns through the deterministic concierge and the assistant must give the same
// filters and surface kinds. One test per row (AC1). The rows live in test/helpers/parity-rows.ts, shared with the live script.

ROWS.forEach((row, index) => {
  test(`parity: ${row.name} gives the same filters and surface kinds on both paths`, async () => {
    const threadId = `g-16${(index + 1).toString(16).padStart(6, "0")}`;
    const deterministic = await runParityPath("deterministic", row.turns, row.script, threadId);
    const assistant = await runParityPath("assistant", row.turns, row.script, threadId);
    if (row.keepsResults === true) {
      // The last turn may re-present the current surface on one path and send nothing on the other; both must keep the results.
      const last = assistant.length - 1;
      assert.deepEqual(assistant.slice(0, last).map((step) => step.kinds), deterministic.slice(0, last).map((step) => step.kinds), "surface kinds before the last turn");
      for (const steps of [assistant, deterministic]) {
        assert.equal(steps[last]!.kinds.includes("discovery"), false, "no new results replace the current ones");
        assert.deepEqual(steps[last]!.filters, steps[last - 1]!.filters, "the criteria are unchanged by the turn");
      }
      assert.deepEqual(assistant.map((step) => step.filters), deterministic.map((step) => step.filters), "filters");
      return;
    }
    assert.deepEqual(assistant.map((step) => step.kinds), deterministic.map((step) => step.kinds), "surface kinds");
    assert.deepEqual(assistant.map((step) => step.filters), deterministic.map((step) => step.filters), "filters");
  });
});

// Issue 16 (AC4, offline): the assistant path records no failure outcome for any row. The owner-run live script applies the same rule
// to the staging model (scripts/parity-live.ts).
import { runHasFailureOutcome } from "../scripts/parity-live-report.js";
ROWS.forEach((row, index) => {
  test(`parity outcomes: ${row.name} records no failure outcome on the assistant path`, async () => {
    const threadId = `g-16${(index + 101).toString(16).padStart(6, "0")}`;
    const assistant = await runParityPath("assistant", row.turns, row.script, threadId);
    assert.equal(runHasFailureOutcome(assistant.flatMap((step) => step.outcomes)), false, JSON.stringify(assistant.map((step) => step.outcomes)));
  });
});

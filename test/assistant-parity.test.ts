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
    assert.deepEqual(assistant.map((step) => step.kinds), deterministic.map((step) => step.kinds), "surface kinds");
    assert.deepEqual(assistant.map((step) => step.filters), deterministic.map((step) => step.filters), "filters");
  });
});

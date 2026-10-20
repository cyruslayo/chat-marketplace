import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_MIGRATION_FAILED, COMMERCE_SCHEMA_SHAPE_INVALID } from "../apps/cloudflare/src/commerce-schema-guard.js";
import { commerceAlarmPlan } from "../apps/cloudflare/src/commerce-alarm.js";

/** Final review F5 (no export from a failed object) and the review of 8febb76 (a failed object still sweeps its own expired exports). */

test("F5: a failed commerce object does not export and logs only its fixed code", () => {
  for (const code of [COMMERCE_MIGRATION_FAILED, COMMERCE_SCHEMA_SHAPE_INVALID]) {
    const plan = commerceAlarmPlan({ failure: code, lastExportDate: null, today: "2026-10-19" });
    assert.equal(plan.runExport, false);
    assert.equal(plan.logCode, code);
  }
});

test("review of 8febb76: a failed commerce object still requests its own retention sweep, so expired personal-data exports do not outlive retention", () => {
  for (const code of [COMMERCE_MIGRATION_FAILED, COMMERCE_SCHEMA_SHAPE_INVALID]) {
    assert.equal(commerceAlarmPlan({ failure: code, lastExportDate: null, today: "2026-10-19" }).runRetentionSweep, true);
    assert.equal(commerceAlarmPlan({ failure: code, lastExportDate: "2026-10-19", today: "2026-10-19" }).runRetentionSweep, true);
  }
});

test("a healthy commerce object exports once per day, and that export includes the retention sweep", () => {
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: null, today: "2026-10-19" }), { runExport: true, runRetentionSweep: true, logCode: null });
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: "2026-10-18", today: "2026-10-19" }), { runExport: true, runRetentionSweep: true, logCode: null });
});

test("a healthy commerce object already exported today neither exports nor sweeps again", () => {
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: "2026-10-19", today: "2026-10-19" }), { runExport: false, runRetentionSweep: false, logCode: null });
});

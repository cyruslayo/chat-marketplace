import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_MIGRATION_FAILED, COMMERCE_SCHEMA_SHAPE_INVALID } from "../apps/cloudflare/src/commerce-schema-guard.js";
import { commerceAlarmPlan } from "../apps/cloudflare/src/commerce-alarm.js";

/** Final review F5: the commerce alarm never exports from a failed object. */

test("F5: a failed commerce object skips the daily export and logs only its fixed code", () => {
  for (const code of [COMMERCE_MIGRATION_FAILED, COMMERCE_SCHEMA_SHAPE_INVALID]) {
    assert.deepEqual(commerceAlarmPlan({ failure: code, lastExportDate: null, today: "2026-10-19" }), { runExport: false, logCode: code });
  }
});

test("F5: a healthy object exports once per day", () => {
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: null, today: "2026-10-19" }), { runExport: true });
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: "2026-10-18", today: "2026-10-19" }), { runExport: true });
  assert.deepEqual(commerceAlarmPlan({ failure: null, lastExportDate: "2026-10-19", today: "2026-10-19" }), { runExport: false, logCode: null });
});

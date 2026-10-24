import assert from "node:assert/strict";
import test from "node:test";
import { controlsEvaluationOptions } from "../scripts/concierge-controls-eval.js";

test("Controlled live evaluation requires explicit opt-in and a bounded total attempt limit", () => {
  assert.deepEqual(controlsEvaluationOptions(["--live", "--request-limit", "64"]), { requestLimit: 64 });
  assert.deepEqual(controlsEvaluationOptions(["--live", "--request-limit", "6", "--case", "other-guest-data"]), { requestLimit: 6, caseId: "other-guest-data" });
  for (const args of [
    [], ["--request-limit", "64"], ["--live"], ["--live", "--request-limit", "0"],
    ["--live", "--request-limit", "65"], ["--live", "--request-limit", "1.5"],
    ["--live", "--request-limit", "2", "--request-limit", "3"],
    ["--live", "--live", "--request-limit", "2"],
    ["--live", "--request-limit", "2", "--case", "unknown"],
    ["--live", "--request-limit", "2", "--model", "another-model"],
  ]) assert.throws(() => controlsEvaluationOptions(args));
});

import test from "node:test";
import assert from "node:assert/strict";
import { applyTestEnvDefaults, TEST_ENV_DEFAULTS } from "../scripts/test-env-defaults.mjs";

// The runner sets the suite's environment defaults on process.env before either phase, so phase 2's child processes
// inherit them. A value the caller already set is never overwritten.

test("A default is set when the variable is unset, and reported as applied", () => {
  const env: Record<string, string | undefined> = {};
  const applied = applyTestEnvDefaults(env, { EXAMPLE_FLAG: "1" });
  assert.equal(env.EXAMPLE_FLAG, "1");
  assert.deepEqual(applied, ["EXAMPLE_FLAG"]);
});

test("A variable the caller already set keeps its value", () => {
  const env: Record<string, string | undefined> = { EXAMPLE_FLAG: "mine" };
  const applied = applyTestEnvDefaults(env, { EXAMPLE_FLAG: "1" });
  assert.equal(env.EXAMPLE_FLAG, "mine");
  assert.deepEqual(applied, []);
});

test("On main there are no defaults, so the environment is left as it is", () => {
  assert.deepEqual(TEST_ENV_DEFAULTS, {});
  const env: Record<string, string | undefined> = { PATH: "x" };
  assert.deepEqual(applyTestEnvDefaults(env), []);
  assert.deepEqual(env, { PATH: "x" });
});

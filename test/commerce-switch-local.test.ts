import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_ENABLED_VARIABLE, commerceEnabledFromEnv } from "../apps/local-guest/src/commerce-switch-local.js";

// ADR 0104 / owner decision: one fail-closed switch. Unset, empty or exactly "false" is OFF; exactly "true" is ON;
// any other value throws at startup and names the variable. Nothing is ever silently on.

test("The switch variable is named COMMERCE_ENABLED", () => {
  assert.equal(COMMERCE_ENABLED_VARIABLE, "COMMERCE_ENABLED");
});

test("ADR 0104: unset, empty and exactly \"false\" leave commerce OFF", () => {
  assert.equal(commerceEnabledFromEnv({}), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: undefined }), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "" }), false);
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "false" }), false);
});

test("ADR 0104: exactly \"true\" turns commerce ON", () => {
  assert.equal(commerceEnabledFromEnv({ COMMERCE_ENABLED: "true" }), true);
});

test("ADR 0104: any other value throws and names COMMERCE_ENABLED, so nothing is silently on", () => {
  for (const value of ["1", "TRUE", "True", "yes", "on", " true", "true ", "false ", "FALSE", "garbage"]) {
    assert.throws(
      () => commerceEnabledFromEnv({ COMMERCE_ENABLED: value }),
      (error: unknown) => error instanceof Error && error.message.includes("COMMERCE_ENABLED"),
      `value ${JSON.stringify(value)} must be refused`,
    );
  }
});

test("ADR 0104: the refusal names the variable but never echoes the rejected value", () => {
  assert.throws(
    () => commerceEnabledFromEnv({ COMMERCE_ENABLED: "sensitive-looking-value-42" }),
    (error: unknown) => error instanceof Error && error.message.includes("COMMERCE_ENABLED") && !error.message.includes("sensitive-looking-value-42"),
  );
});

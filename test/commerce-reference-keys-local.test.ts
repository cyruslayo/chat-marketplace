import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS, commerceReferenceKeysFromProcessEnv } from "../apps/local-guest/src/commerce-reference-keys-local.js";

/** Final review F1 and F2: the test-only payment reference key needs an explicit opt-in AND NODE_ENV=test. */

const SECRET = "a-real-looking-local-secret-of-at-least-32-bytes";
const KEY_ID = "local-k7";

test("F1: environment keys win over the test-only fallback, under any NODE_ENV and opt-in", () => {
  const env = { COMMERCE_REFERENCE_HMAC_KEY: SECRET, COMMERCE_REFERENCE_HMAC_KEY_ID: KEY_ID };
  assert.deepEqual(commerceReferenceKeysFromProcessEnv(env, undefined), { currentKeyId: KEY_ID, currentKey: SECRET });
  assert.deepEqual(commerceReferenceKeysFromProcessEnv({ ...env, COMMERCE_REFERENCE_TEST_KEY: "allow" }, "test"), { currentKeyId: KEY_ID, currentKey: SECRET });
});

test("F1: the test-only key is used only with the explicit opt-in AND NODE_ENV=test", () => {
  assert.deepEqual(commerceReferenceKeysFromProcessEnv({ COMMERCE_REFERENCE_TEST_KEY: "allow" }, "test"), LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS);
});

test("F2: with the variables unset and no opt-in, a test run still refuses and names the variables but not any value", () => {
  assert.throws(() => commerceReferenceKeysFromProcessEnv({}, "test"), (error: unknown) => {
    const message = (error as Error).message;
    return message.includes("COMMERCE_REFERENCE_HMAC_KEY") && message.includes("COMMERCE_REFERENCE_HMAC_KEY_ID") && !message.includes(LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS.currentKey);
  });
});

test("F2: with the opt-in but NODE_ENV not test, the start refuses and names the variables but not any value", () => {
  for (const nodeEnv of [undefined, "development", "production"]) {
    assert.throws(() => commerceReferenceKeysFromProcessEnv({ COMMERCE_REFERENCE_TEST_KEY: "allow" }, nodeEnv), (error: unknown) => {
      const message = (error as Error).message;
      return message.includes("COMMERCE_REFERENCE_HMAC_KEY") && !message.includes(LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS.currentKey);
    }, String(nodeEnv));
  }
});

test("F2: the opt-in must be exactly 'allow'; any other value refuses", () => {
  assert.throws(() => commerceReferenceKeysFromProcessEnv({ COMMERCE_REFERENCE_TEST_KEY: "true" }, "test"), /COMMERCE_REFERENCE_HMAC_KEY/);
});

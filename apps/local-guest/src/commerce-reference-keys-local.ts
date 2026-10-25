import type { PaymentReferenceKeys } from "../../../domains/commerce/src/index.js";

/**
 * TEST ONLY. A synthetic payment reference key for test runs and for the walkthrough fixture. The id and the value both say
 * so, and it is never a deployment secret (ADR 0075).
 */
export const LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS: PaymentReferenceKeys = {
  currentKeyId: "test-only-k1",
  currentKey: "TEST-ONLY-synthetic-commerce-reference-key-not-a-secret",
};

/** The explicit opt-in for the test-only key. NODE_ENV=test alone is not enough (final review F1). */
const TEST_KEY_OPT_IN = "COMMERCE_REFERENCE_TEST_KEY";

/**
 * The local guest's payment reference keys (user decision 18 Oct 2026). The environment variables win. Without them, the
 * test-only key is used only when BOTH the explicit opt-in COMMERCE_REFERENCE_TEST_KEY=allow and NODE_ENV=test are set.
 * Otherwise the start fails and names the variables, never their values. A caller that passes keys explicitly bypasses this.
 */
export function commerceReferenceKeysFromProcessEnv(env: Readonly<Record<string, string | undefined>>, nodeEnv: string | undefined): PaymentReferenceKeys {
  const key = env.COMMERCE_REFERENCE_HMAC_KEY;
  const keyId = env.COMMERCE_REFERENCE_HMAC_KEY_ID;
  if (key && keyId) return { currentKeyId: keyId, currentKey: key };
  if (env[TEST_KEY_OPT_IN] === "allow" && nodeEnv === "test") return LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS;
  throw new Error(
    "COMMERCE_REFERENCE_HMAC_KEY and COMMERCE_REFERENCE_HMAC_KEY_ID must be set to start the local guest (ADR 0075). " +
      "The test-only key is used only under the test runner (NODE_ENV=test with COMMERCE_REFERENCE_TEST_KEY=allow).",
  );
}

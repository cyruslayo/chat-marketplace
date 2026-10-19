import type { PaymentReferenceKeys } from "../../../domains/commerce/src/index.js";

/**
 * TEST ONLY. A synthetic payment reference key for NODE_ENV=test and for the walkthrough fixture. The id and the value both
 * say so, and it is never a deployment secret (ADR 0075).
 */
export const LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS: PaymentReferenceKeys = {
  currentKeyId: "test-only-k1",
  currentKey: "TEST-ONLY-synthetic-commerce-reference-key-not-a-secret",
};

/**
 * The local guest's payment reference keys (user decision 18 Oct 2026). The variables are the same two the Worker uses. When
 * they are unset, the test-only key is used only under NODE_ENV=test; otherwise the start fails and names the variables
 * (never their values). A caller that passes keys explicitly bypasses this function.
 */
export function commerceReferenceKeysFromProcessEnv(env: Readonly<Record<string, string | undefined>>, nodeEnv: string | undefined): PaymentReferenceKeys {
  const key = env.COMMERCE_REFERENCE_HMAC_KEY;
  const keyId = env.COMMERCE_REFERENCE_HMAC_KEY_ID;
  if (key && keyId) return { currentKeyId: keyId, currentKey: key };
  if (nodeEnv === "test") return LOCAL_TEST_ONLY_COMMERCE_REFERENCE_KEYS;
  throw new Error("COMMERCE_REFERENCE_HMAC_KEY and COMMERCE_REFERENCE_HMAC_KEY_ID must be set to start the local guest (ADR 0075)");
}

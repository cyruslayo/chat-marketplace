import type { PaymentReferenceKeys } from "../../../domains/commerce/src/index.js";
import { COMMERCE_ENABLED_VARIABLE, commerceEnabledFromEnv } from "../../../domains/commerce/src/commerce-switch.js";

/**
 * The merchant back office starts only when commerce is ON (ADR 0104), and then needs the payment reference key pair
 * (ADR 0075). Fails closed. Every message names variables only, never a value.
 */
export function merchantPaymentReferenceKeysFromEnv(env: Readonly<Record<string, string | undefined>>): PaymentReferenceKeys {
  if (!commerceEnabledFromEnv(env)) {
    throw new Error(
      `The merchant back office does not start while commerce is off. Set ${COMMERCE_ENABLED_VARIABLE}=true to run it (ADR 0104).`,
    );
  }
  const currentKey = env.COMMERCE_REFERENCE_HMAC_KEY;
  const currentKeyId = env.COMMERCE_REFERENCE_HMAC_KEY_ID;
  if (!currentKey || !currentKeyId) {
    throw new Error("COMMERCE_REFERENCE_HMAC_KEY and COMMERCE_REFERENCE_HMAC_KEY_ID must be set to start the merchant back office (ADR 0075).");
  }
  return { currentKeyId, currentKey };
}

import { assertPaymentReferenceKeys, type PaymentReferenceKeys } from "../../../domains/commerce/src/index.js";

/** Fixed code for a missing or unusable payment reference key. Logged or returned alone; the key is never included. */
export const COMMERCE_REFERENCE_KEY_INVALID = "COMMERCE_REFERENCE_KEY_INVALID";

export class CommerceReferenceKeyError extends Error {
  readonly code = COMMERCE_REFERENCE_KEY_INVALID;
  constructor() {
    super("The commerce payment reference key is missing or unusable");
  }
}

/** The Worker's bindings for the payment reference key (ADR 0075): a secret for the key, a plain var for its id. */
export interface CommerceReferenceKeyEnv {
  readonly COMMERCE_REFERENCE_HMAC_KEY?: string;
  readonly COMMERCE_REFERENCE_HMAC_KEY_ID?: string;
}

/**
 * Reads the current payment reference key from the Worker environment. Fails closed: a missing or malformed id, a missing key
 * or a key shorter than the minimum throws CommerceReferenceKeyError, which names no value. The domain's own rules
 * (assertPaymentReferenceKeys) decide what is valid, so the id pattern and the minimum live in one place.
 */
export function paymentReferenceKeysFromEnv(env: CommerceReferenceKeyEnv): PaymentReferenceKeys {
  const secret = env.COMMERCE_REFERENCE_HMAC_KEY;
  const keyId = env.COMMERCE_REFERENCE_HMAC_KEY_ID;
  if (typeof secret !== "string" || typeof keyId !== "string" || keyId.trim() === "") throw new CommerceReferenceKeyError();
  const keys: PaymentReferenceKeys = { currentKeyId: keyId.trim(), currentKey: secret };
  try {
    assertPaymentReferenceKeys(keys);
  } catch {
    throw new CommerceReferenceKeyError();
  }
  return keys;
}

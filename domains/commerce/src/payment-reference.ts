import { createHmac } from "node:crypto";

/**
 * Payment reference keys (user decision 18 Oct 2026, ADR 0075). A payment reference is a bearer credential, and Shortlet
 * references are predictable (`psp_ref_<4 random chars>_<timestamp>`), so a plain SHA-256 could be brute-forced from the
 * export. The stored value is `<keyId>:<HMAC-SHA-256 hex>` over the trimmed reference. The domain never reads the
 * environment: the composition root injects the keys. Secrets are never logged or returned (ADR 0075).
 */
export const PAYMENT_REFERENCE_KEY_MIN_BYTES = 32;

/** A key id is lowercase letters, digits and hyphens, at most 32 characters. It is stored in clear, so it cannot hold a secret. */
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface PaymentReferenceKeys {
  /** The key id stored with every new hash. */
  readonly currentKeyId: string;
  /** The current secret, at least PAYMENT_REFERENCE_KEY_MIN_BYTES bytes. */
  readonly currentKey: string;
  /** Earlier keys, by id, so rows written before a rotation are still found. Optional. */
  readonly previousKeys?: Readonly<Record<string, string>>;
}

/** Throws at construction when the keys are missing, short or malformed. The message never includes a key. */
export function assertPaymentReferenceKeys(keys: PaymentReferenceKeys | undefined): void {
  if (keys === undefined || keys === null) throw new Error("A payment reference key is required");
  assertKey(keys.currentKeyId, keys.currentKey);
  for (const [id, secret] of Object.entries(keys.previousKeys ?? {})) {
    if (id === keys.currentKeyId) throw new Error("A previous payment reference key id must differ from the current key id");
    assertKey(id, secret);
  }
}

function assertKey(id: string, secret: string): void {
  if (typeof id !== "string" || !KEY_ID.test(id)) throw new Error("A payment reference key id must be lowercase letters, digits and hyphens");
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < PAYMENT_REFERENCE_KEY_MIN_BYTES) {
    throw new Error(`A payment reference key must be at least ${PAYMENT_REFERENCE_KEY_MIN_BYTES} bytes`);
  }
}

/** The stored hash of `reference` under one key: `<keyId>:<64 lowercase hex>`. */
function hashWith(id: string, secret: string, reference: string): string {
  return `${id}:${createHmac("sha256", secret).update(reference.trim(), "utf8").digest("hex")}`;
}

/** The hash to store for a new order: the current key. */
export function paymentReferenceHash(keys: PaymentReferenceKeys, reference: string): string {
  return hashWith(keys.currentKeyId, keys.currentKey, reference);
}

/** Every hash an order may be stored under: the current key first, then each previous key. Lookup tries all of them. */
export function paymentReferenceHashCandidates(keys: PaymentReferenceKeys, reference: string): readonly string[] {
  return [
    hashWith(keys.currentKeyId, keys.currentKey, reference),
    ...Object.entries(keys.previousKeys ?? {}).map(([id, secret]) => hashWith(id, secret, reference)),
  ];
}

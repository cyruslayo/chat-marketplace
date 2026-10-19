import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack, parseCreateOrderInput } from "../domains/commerce/src/index.js";
import { paymentReferenceHash, type PaymentReferenceKeys } from "../domains/commerce/src/payment-reference.js";
import { assertPaymentReferenceHashes } from "../apps/cloudflare/src/commerce-schema-guard.js";
import { COMMERCE_REFERENCE_KEY_INVALID, paymentReferenceKeysFromEnv } from "../apps/cloudflare/src/commerce-reference-keys.js";
import { COMMERCE_TEST_CLOCK as CLOCK, COMMERCE_TEST_REFERENCE_KEYS as KEYS, migrateCommerceDatabase } from "./helpers/commerce-database.js";

/** User decision 18 Oct 2026: payment references use a keyed HMAC-SHA-256, stored as `<keyId>:<64 lowercase hex>`. */

const OTHER_KEY = "another-test-only-commerce-reference-key-32b";

function orderFixture(keys: PaymentReferenceKeys) {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  const pack = createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: keys });
  pack.directory.createMerchant({ id: "m", name: "M", status: "verified" });
  pack.directory.createStore({ id: "s", merchantId: "m", slug: "s", name: "S", status: "active" });
  pack.catalogue.createProduct({ id: "p", name: "P", category: "C" });
  pack.catalogue.createOffer({ id: "o", productId: "p", storeId: "s", priceKobo: 1000, stock: 5 });
  pack.catalogue.createDeliveryZone({ id: "z", storeId: "s", city: "Lagos", name: "Z", provider: "Bolt", feeKobo: 0, isActive: true, sortOrder: 0 });
  const input = (paymentReference: string) => parseCreateOrderInput({
    storeId: "s", deliveryZoneId: "z", customerName: "Ada", customerPhone: "08031234567", shippingAddress: { address: "1" },
    items: [{ offerId: "o", quantity: 1 }], submittedTotalKobo: 1000, paymentReference,
  });
  return { database, orders: pack.orders, input };
}

test("decision 18: the same reference with the same key returns the same order", () => {
  const { database, orders, input } = orderFixture(KEYS);
  const first = orders.createOrder(input("ref-same"));
  assert.equal(orders.createOrder(input("ref-same")).id, first.id);
  database.close();
});

test("decision 18: a different key gives a different stored hash for the same reference", () => {
  assert.notEqual(paymentReferenceHash(KEYS, "ref-1"), paymentReferenceHash({ currentKeyId: "k2", currentKey: OTHER_KEY }, "ref-1"));
  assert.notEqual(paymentReferenceHash(KEYS, "ref-1"), paymentReferenceHash({ currentKeyId: KEYS.currentKeyId, currentKey: OTHER_KEY }, "ref-1"));
});

test("decision 18: the stored value is keyId:HMAC-SHA-256 of the trimmed reference, and never the plain SHA-256", () => {
  const expectedHex = createHmac("sha256", KEYS.currentKey).update("ref-trim").digest("hex");
  assert.equal(paymentReferenceHash(KEYS, "  ref-trim  "), `${KEYS.currentKeyId}:${expectedHex}`);
  const { database, orders, input } = orderFixture(KEYS);
  orders.createOrder(input("  ref-trim  "));
  const stored = String(database.prepare("SELECT payment_reference_hash AS hash FROM merchant_orders").get()?.hash);
  assert.equal(stored, `${KEYS.currentKeyId}:${expectedHex}`);
  database.close();
});

test("decision 18: a missing current key throws at construction (fail closed)", () => {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  assert.throws(() => createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: { currentKeyId: "k1", currentKey: "" } }), /key/i);
  assert.throws(() => createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: { currentKeyId: "k1", currentKey: "short" } }), /32/);
  assert.throws(() => createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: undefined as unknown as PaymentReferenceKeys }), /key/i);
  database.close();
});

test("decision 18: a key id outside lowercase letters, digits and hyphens is refused at construction", () => {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  assert.throws(() => createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: { currentKeyId: "K1:bad", currentKey: OTHER_KEY } }), /key id/i);
  database.close();
});

test("decision 18: an order stored under a previous key is still found after rotation", () => {
  const before = orderFixture(KEYS);
  const first = before.orders.createOrder(before.input("ref-rotated"));
  const rawRow = String(before.database.prepare("SELECT payment_reference_hash AS hash FROM merchant_orders").get()?.hash);
  assert.ok(rawRow.startsWith(`${KEYS.currentKeyId}:`));
  // Rotate: the new key becomes current and the old key moves to previousKeys. The stored row is copied to the new database.
  const rotated: PaymentReferenceKeys = { currentKeyId: "k2", currentKey: OTHER_KEY, previousKeys: { [KEYS.currentKeyId]: KEYS.currentKey } };
  const after = orderFixture(rotated);
  after.database.prepare("DELETE FROM merchant_orders").run();
  after.database.prepare(
    `INSERT INTO merchant_orders (id, store_id, public_code, customer_name, customer_phone, items_json, subtotal_kobo, shipping_fee_kobo, total_kobo, status, shipping_address_json, delivery_zone_id, payment_reference_hash, created_at, updated_at)
     VALUES ($id, 's', $code, 'Ada', '08031234567', '[{"offerId":"o","productId":"p","name":"P","category":"C","priceKobo":1000,"quantity":1}]', 1000, 0, 1000, 'Pending Verification', '{"address":"1"}', 'z', $hash, $at, $at)`,
  ).run({ $id: first.id, $code: first.publicCode, $hash: rawRow, $at: CLOCK().toISOString() });
  assert.equal(after.orders.createOrder(after.input("ref-rotated")).id, first.id);
  assert.equal(String(after.database.prepare("SELECT COUNT(*) AS n FROM merchant_orders").get()?.n), "1");
  before.database.close();
  after.database.close();
});

test("decision 18: restore validates the keyed format and refuses a plain 64-hex value", () => {
  const plain = "a".repeat(64);
  assert.throws(() => assertPaymentReferenceHashes([{ payment_reference_hash: plain }]), /payment_reference_hash/);
  assert.doesNotThrow(() => assertPaymentReferenceHashes([{ payment_reference_hash: `k1:${"a".repeat(64)}` }]));
  assert.doesNotThrow(() => assertPaymentReferenceHashes([{ payment_reference_hash: `rotated-2:${"0".repeat(63)}9` }]));
  for (const bad of [`K1:${"a".repeat(64)}`, `k1:${"A".repeat(64)}`, `k1:${"a".repeat(63)}`, `:${"a".repeat(64)}`, `k1 ${"a".repeat(64)}`]) {
    assert.throws(() => assertPaymentReferenceHashes([{ payment_reference_hash: bad }]), /payment_reference_hash/, bad);
  }
});

test("decision 18: the Worker reads the keys from its secret and id; a missing or short key throws without echoing it", () => {
  const secret = "x".repeat(32);
  assert.deepEqual(paymentReferenceKeysFromEnv({ COMMERCE_REFERENCE_HMAC_KEY: secret, COMMERCE_REFERENCE_HMAC_KEY_ID: "k1" }), { currentKeyId: "k1", currentKey: secret });
  const short = "short-secret-value";
  assert.throws(() => paymentReferenceKeysFromEnv({ COMMERCE_REFERENCE_HMAC_KEY: short, COMMERCE_REFERENCE_HMAC_KEY_ID: "k1" }), (error: unknown) => {
    const failure = error as { code?: string; message: string };
    return failure.code === COMMERCE_REFERENCE_KEY_INVALID && !failure.message.includes(short);
  });
  assert.throws(() => paymentReferenceKeysFromEnv({ COMMERCE_REFERENCE_HMAC_KEY_ID: "k1" } as never), (error: unknown) => (error as { code?: string }).code === COMMERCE_REFERENCE_KEY_INVALID);
  assert.throws(() => paymentReferenceKeysFromEnv({ COMMERCE_REFERENCE_HMAC_KEY: secret } as never), (error: unknown) => (error as { code?: string }).code === COMMERCE_REFERENCE_KEY_INVALID);
});

test("final review F4: the Worker key reader refuses a malformed key id with COMMERCE_REFERENCE_KEY_INVALID, without echoing the key", () => {
  const secret = "x".repeat(32);
  for (const badId of ["K1", "k 1", "-k1", "k1:", "a".repeat(33)]) {
    assert.throws(() => paymentReferenceKeysFromEnv({ COMMERCE_REFERENCE_HMAC_KEY: secret, COMMERCE_REFERENCE_HMAC_KEY_ID: badId }), (error: unknown) => {
      const failure = error as { code?: string; message: string };
      return failure.code === COMMERCE_REFERENCE_KEY_INVALID && !failure.message.includes(secret) && !failure.message.includes(badId);
    }, badId);
  }
});

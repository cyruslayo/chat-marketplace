import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../domains/commerce/src/index.js";
import { applySchemaMigrations, schemaVersion } from "../packages/platform-core/src/schema-migrations.js";
import { TRACKING_ATTEMPT_SCHEMA } from "../domains/commerce/src/commerce-schema.js";
import { normalizePhone } from "../domains/commerce/src/order.js";
import { createCommerceFixture } from "./helpers/commerce-fixture.js";

/** Slice 21: Merchant Order — port of instastore create_store_order / set_order_status. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  return new NodeSqliteDatabase(":memory:");
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ database, clock: CLOCK });
}

function setupStore(database: NodeSqliteDatabase, merchantId: string, storeId: string) {
  const { directory } = pack(database);
  directory.createMerchant({ id: merchantId, name: `Merchant ${merchantId}`, status: "verified" });
  directory.createStore({ id: storeId, merchantId, slug: storeId, name: `Store ${storeId}`, status: "active" });
}

function addOffer(database: NodeSqliteDatabase, storeId: string, offerId: string, priceKobo: number, stock: number) {
  const { catalogue } = pack(database);
  catalogue.createProduct({ id: `product-${offerId}`, name: `Product ${offerId}`, category: "Category" });
  catalogue.createOffer({ id: offerId, productId: `product-${offerId}`, storeId, priceKobo, stock });
}

function addZone(database: NodeSqliteDatabase, storeId: string, zoneId: string, feeKobo: number, isActive = true) {
  const { catalogue } = pack(database);
  catalogue.createDeliveryZone({ id: zoneId, storeId, city: "Lagos", name: "Mainland", provider: "Bolt", feeKobo, isActive, sortOrder: 0 });
}

function baseInput(storeId: string, zoneId: string, overrides: Record<string, unknown> = {}) {
  return {
    storeId,
    deliveryZoneId: zoneId,
    customerName: "Ada Obi",
    customerPhone: "0803 123 4567",
    shippingAddress: { address: "1 Test Street", city: "Lagos" },
    items: [{ offerId: "offer", quantity: 1 }],
    submittedTotalKobo: 10000,
    paymentReference: "ref-1",
    ...overrides,
  };
}

test("AC1: an order for an inactive store, or with a delivery zone of another store or inactive, is rejected", () => {
  const database = memory();
  const { orders, directory } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 2000);
  addZone(database, "store", "zone-inactive", 2000, false);
  setupStore(database, "merchant-b", "store-b");
  addZone(database, "store-b", "zone-b", 3000);

  directory.updateStoreStatus("store", "suspended");
  assert.throws(() => orders.createOrder(baseInput("store", "zone", { submittedTotalKobo: 12000 })), /store/i);
  directory.updateStoreStatus("store", "active");

  assert.throws(() => orders.createOrder(baseInput("store", "zone-b", { submittedTotalKobo: 13000 })), /belong/i);
  assert.throws(() => orders.createOrder(baseInput("store", "zone-inactive", { submittedTotalKobo: 12000 })), /zone/i);
  database.close();
});

test("AC2: the order total is recomputed server-side and a tampered submitted total is rejected", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 2000);

  assert.throws(() => orders.createOrder(baseInput("store", "zone", { submittedTotalKobo: 1 })), /total/i);

  const order = orders.createOrder(baseInput("store", "zone", { submittedTotalKobo: 12000 }));
  assert.equal(order.subtotalKobo, 10000);
  assert.equal(order.shippingFeeKobo, 2000);
  assert.equal(order.totalKobo, 12000);
  database.close();
});

test("AC3: stock is decremented atomically and an oversell is rejected", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 2);
  addZone(database, "store", "zone", 0);

  assert.throws(() => orders.createOrder(baseInput("store", "zone", { items: [{ offerId: "offer", quantity: 3 }], submittedTotalKobo: 30000 })), /stock/i);

  const order = orders.createOrder(baseInput("store", "zone", { items: [{ offerId: "offer", quantity: 2 }], submittedTotalKobo: 20000 }));
  assert.equal(order.status, "Pending Verification");

  assert.throws(() => orders.createOrder(baseInput("store", "zone", { paymentReference: "ref-2", items: [{ offerId: "offer", quantity: 1 }], submittedTotalKobo: 10000 })), /stock/i);
  database.close();
});

test("AC4: a retried creation with the same payment reference returns the same order", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);

  const input = baseInput("store", "zone", { submittedTotalKobo: 10000, items: [{ offerId: "offer", quantity: 1 }] });
  const first = orders.createOrder(input);
  const second = orders.createOrder(input);
  assert.equal(second.id, first.id);
  assert.equal(second.publicCode, first.publicCode);

  assert.throws(() => orders.createOrder({ ...input, customerPhone: "0809 999 9999" }), /already/i);
  database.close();
});

test("AC5: only allowed status transitions succeed and the first move to Processing records the payment-verified fact once", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);

  const order = orders.createOrder(baseInput("store", "zone", { submittedTotalKobo: 10000, items: [{ offerId: "offer", quantity: 1 }] }));

  assert.throws(() => orders.transitionStatus(order.id, "Shipped"), /transition/i);

  const processing = orders.transitionStatus(order.id, "Processing");
  assert.equal(processing.status, "Processing");
  assert.ok(processing.paymentVerifiedAt);
  assert.ok(processing.paymentEventId);

  const again = orders.transitionStatus(order.id, "Processing");
  assert.equal(again.paymentVerifiedAt, processing.paymentVerifiedAt);
  assert.equal(again.paymentEventId, processing.paymentEventId);

  assert.equal(orders.transitionStatus(order.id, "Shipped").status, "Shipped");
  assert.equal(orders.transitionStatus(order.id, "Fulfilled").status, "Fulfilled");
  assert.throws(() => orders.transitionStatus(order.id, "Cancelled"), /transition/i);
  database.close();
});

/** Issue 27 (user decision, 18 Oct 2026): Nigerian local and international phone forms share one canonical value. */
test("Phone normalisation: a Nigerian mobile number has one canonical value", () => {
  assert.equal(normalizePhone("07031234567"), "+2347031234567");
  for (const form of ["0801 234 5678", "08012345678", "+2348012345678", "2348012345678", "+234 801 234 5678", "+234 0801 234 5678", "00234 801 234 5678"]) {
    assert.equal(normalizePhone(form), "+2348012345678", form);
  }
});

test("Phone normalisation keeps non-Nigerian numbers as digits and plus", () => {
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("(020) 7946-0958"), "02079460958");
  // A UK mobile has the same shape as a Nigerian local number but not a Nigerian mobile prefix, so it is left alone.
  assert.equal(normalizePhone("07911123456"), "07911123456");
  assert.equal(normalizePhone("no digits here"), "");
});

/** Issue 27 (user decision, 18 Oct 2026): tracking attempts are limited per public code within a fifteen-minute window. */
const START = Date.parse("2026-10-18T10:00:00.000Z");
const MINUTE = 60_000;
const WRONG_PHONE = "0800 000 0000";
const RIGHT_PHONE = "+234 801 234 5678";

function trackingFixture(now: () => number, policy: { maxFailedAttempts?: number; windowMs?: number } = {}) {
  return createCommerceFixture({
    clock: () => new Date(now()),
    trackingPolicy: policy,
    storeSlug: "store",
    storeName: "Store",
    merchantName: "Merchant",
    productName: "Product",
    priceKobo: 10000,
    stock: 50,
    feeKobo: 0,
    zoneName: "Mainland",
    provider: "Bolt",
    customerPhone: RIGHT_PHONE,
    submittedTotalKobo: 10000,
    paymentReference: "ref-track-1",
  });
}

test("AC2 tracking: the sixth attempt with the correct phone inside the window is still refused", () => {
  let now = START;
  const { database, commerce, order } = trackingFixture(() => now);
  try {
    for (let attempt = 0; attempt < 5; attempt++) assert.equal(commerce.orders.trackOrder(order.publicCode, WRONG_PHONE), null);
    now = START + 14 * MINUTE;
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE), null);
  } finally {
    database.close();
  }
});

test("AC2 tracking: the lock expires when the fifteen-minute window ends", () => {
  let now = START;
  const { database, commerce, order } = trackingFixture(() => now);
  try {
    for (let attempt = 0; attempt < 5; attempt++) commerce.orders.trackOrder(order.publicCode, WRONG_PHONE);
    now = START + 15 * MINUTE - 1;
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE), null);
    now = START + 15 * MINUTE;
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE)?.publicCode, order.publicCode);
  } finally {
    database.close();
  }
});

test("AC2 tracking: a correct phone before the limit clears only that code's failures", () => {
  let now = START;
  const { database, commerce, order } = trackingFixture(() => now);
  try {
    const second = commerce.orders.createOrder(baseInput("store", "zone", { customerPhone: "+234 803 111 2222", submittedTotalKobo: 10000, paymentReference: "ref-track-2" }));
    for (let round = 0; round < 2; round++) {
      for (let attempt = 0; attempt < 4; attempt++) assert.equal(commerce.orders.trackOrder(order.publicCode, WRONG_PHONE), null);
      assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE)?.publicCode, order.publicCode, `round ${round}`);
    }
    for (let attempt = 0; attempt < 5; attempt++) commerce.orders.trackOrder(second.publicCode, WRONG_PHONE);
    assert.equal(commerce.orders.trackOrder(second.publicCode, "+234 803 111 2222"), null);
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE)?.publicCode, order.publicCode);
  } finally {
    database.close();
  }
});

test("AC2 tracking: unknown codes create no attempt rows", () => {
  const { database, commerce } = trackingFixture(() => START);
  try {
    for (let attempt = 0; attempt < 50; attempt++) assert.equal(commerce.orders.trackOrder(`ORD-UNKNOWN-${attempt}`, WRONG_PHONE), null);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM merchant_order_tracking_attempts").get()?.count), 0);
  } finally {
    database.close();
  }
});

test("AC2 tracking: the attempt limit and window are configurable options", () => {
  let now = START;
  const { database, commerce, order } = trackingFixture(() => now, { maxFailedAttempts: 2, windowMs: MINUTE });
  try {
    commerce.orders.trackOrder(order.publicCode, WRONG_PHONE);
    commerce.orders.trackOrder(order.publicCode, WRONG_PHONE);
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE), null);
    now = START + MINUTE;
    assert.equal(commerce.orders.trackOrder(order.publicCode, RIGHT_PHONE)?.publicCode, order.publicCode);
  } finally {
    database.close();
  }
});

test("Options: the tracking limits must be positive integers, and bad values fail closed", () => {
  for (const policy of [{ maxFailedAttempts: 0 }, { maxFailedAttempts: -1 }, { maxFailedAttempts: 2.5 }, { maxFailedAttempts: Number.NaN }, { windowMs: 0 }, { windowMs: -60_000 }, { windowMs: Number.NaN }, { windowMs: 1.5 }]) {
    const database = memory();
    try {
      assert.throws(() => createCommercePack({ database, clock: CLOCK, trackingPolicy: policy }), RangeError, JSON.stringify(policy));
    } finally {
      database.close();
    }
  }
});

test("Migrations are the only source of the tracking-attempts table", () => {
  const database = memory();
  try {
    createCommercePack({ database, clock: CLOCK });
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'merchant_order_tracking_attempts'").get(), undefined);
    applySchemaMigrations(database, createCommercePack({ database, clock: CLOCK }).migrations, CLOCK().toISOString());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'merchant_order_tracking_attempts'").get());
  } finally {
    database.close();
  }
});

test("Idempotency: the same payment reference with a differently written, same canonical phone returns the existing order", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);
  try {
    const first = orders.createOrder(baseInput("store", "zone", { customerPhone: "0803 123 4567", submittedTotalKobo: 10000, paymentReference: "ref-canonical" }));
    const second = orders.createOrder(baseInput("store", "zone", { customerPhone: "+234 803 123 4567", submittedTotalKobo: 10000, paymentReference: "ref-canonical" }));
    assert.equal(second.id, first.id);
    assert.equal(second.customerPhone, "+2348031234567");
  } finally {
    database.close();
  }
});

test("Invalid phone: order creation rejects a phone number below the minimum length", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);
  try {
    assert.throws(() => orders.createOrder(baseInput("store", "zone", { customerPhone: "12345", submittedTotalKobo: 10000, paymentReference: "ref-short-phone" })), /valid phone number is required/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM merchant_orders").get()?.count, 0);
  } finally {
    database.close();
  }
});

test("Upgrade: a pre-change attempts table and its rows survive the migration, and the ledger reaches version 5", () => {
  const database = memory();
  const commerce = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);
  try {
    const order = commerce.orders.createOrder(baseInput("store", "zone", { customerPhone: "+234 801 234 5678", submittedTotalKobo: 10000, paymentReference: "ref-upgrade" }));
    // The pre-change database: the table exists from the earlier constructor, and the migration ledger has no rows.
    database.exec(TRACKING_ATTEMPT_SCHEMA);
    database.prepare("INSERT INTO merchant_order_tracking_attempts (public_code, failed_attempts, window_started_at) VALUES ($publicCode, $failedAttempts, $windowStartedAt)").run({ $publicCode: order.publicCode, $failedAttempts: 3, $windowStartedAt: CLOCK().toISOString() });
    assert.equal(schemaVersion(database), 0);

    applySchemaMigrations(database, commerce.migrations, CLOCK().toISOString());

    assert.equal(schemaVersion(database), 5);
    const rows = database.prepare("SELECT public_code, failed_attempts FROM merchant_order_tracking_attempts").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.public_code, order.publicCode);
    assert.equal(Number(rows[0]?.failed_attempts), 3);
  } finally {
    database.close();
  }
});

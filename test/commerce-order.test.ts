import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations, schemaVersion } from "../packages/platform-core/src/schema-migrations.js";
import { createCommercePack, parseCreateOrderInput } from "../domains/commerce/src/index.js";
import { normalizePhone } from "../domains/commerce/src/order.js";
import { commerceMigrationsWithCutover } from "../apps/cloudflare/src/schema.js";
import { paymentReferenceHash, type PaymentReferenceKeys } from "../domains/commerce/src/payment-reference.js";
import { createCommerceFixture } from "./helpers/commerce-fixture.js";
import { COMMERCE_TEST_CLOCK as CLOCK, COMMERCE_TEST_REFERENCE_KEYS, commerceMigrations, migrateCommerceDatabase } from "./helpers/commerce-database.js";

/** Slice 21: Merchant Order — port of instastore create_store_order / set_order_status. */

/** A migrated database: the ledger creates the order and attempt tables, not the order service (issue 24 review 3). */
function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS });
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
      assert.throws(() => createCommercePack({ database, clock: CLOCK, paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, trackingPolicy: policy }), RangeError, JSON.stringify(policy));
    } finally {
      database.close();
    }
  }
});

test("Migrations are the only source of the tracking-attempts table and of merchant_orders", () => {
  const database = new NodeSqliteDatabase(":memory:");
  pack(database);
  const tableNames = () => database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => String(row.name));
  assert.equal(tableNames().includes("merchant_order_tracking_attempts"), false);
  assert.equal(tableNames().includes("merchant_orders"), false);
  migrateCommerceDatabase(database);
  assert.equal(tableNames().includes("merchant_order_tracking_attempts"), true);
  assert.equal(tableNames().includes("merchant_orders"), true);
  database.close();
});

test("issue 24 review 3: the order service creates no merchant_orders table; only the migration ledger does", () => {
  const database = new NodeSqliteDatabase(":memory:");
  pack(database);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'merchant_orders'").get(), undefined);
  database.close();
});

/** Index of the first migration whose statements contain `marker`, so tests follow the ledger instead of hard-coded numbers. */
function versionWith(migrations: ReturnType<typeof commerceMigrations>, marker: string): number {
  return migrations.find(migration => migration.statements.some(statement => statement.includes(marker)))!.version;
}

/** A version-5 database (raw payment reference column and the tracking table, before the keyed hash), with the given parents. */
function versionFiveDatabase() {
  const database = new NodeSqliteDatabase(":memory:");
  const migrations = commerceMigrations(database);
  const keyedVersion = versionWith(migrations, "payment_reference_hash");
  applySchemaMigrations(database, migrations.slice(0, keyedVersion - 1), CLOCK().toISOString());
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 1000, 5);
  addZone(database, "store", "zone", 0);
  return { database, migrations, keyedVersion };
}

function insertLegacyOrder(database: NodeSqliteDatabase, publicCode: string, paymentReference: string): void {
  database.prepare(
    `INSERT INTO merchant_orders (id, store_id, public_code, customer_name, customer_phone, items_json, subtotal_kobo, shipping_fee_kobo, total_kobo, status, shipping_address_json, payment_reference, created_at, updated_at)
     VALUES ($id, 'store', $publicCode, 'Ada', '+2348031234567', '[{"offerId":"offer","productId":"product-offer","name":"Product offer","category":"Category","priceKobo":1000,"quantity":1}]', 1000, 0, 1000, 'Pending Verification', '{"address":"1"}', $paymentReference, $at, $at)`,
  ).run({ $id: `legacy-${publicCode}`, $publicCode: publicCode, $paymentReference: paymentReference, $at: CLOCK().toISOString() });
}

function insertAttempt(database: NodeSqliteDatabase, publicCode: string, failedAttempts: number): void {
  database.prepare("INSERT INTO merchant_order_tracking_attempts (public_code, failed_attempts, window_started_at) VALUES ($publicCode, $failedAttempts, $windowStartedAt)")
    .run({ $publicCode: publicCode, $failedAttempts: failedAttempts, $windowStartedAt: CLOCK().toISOString() });
}

test("Upgrade: a version-5 database with an order and tracking attempts is refused by the keyed-hash migration, and nothing is lost", () => {
  const { database, migrations, keyedVersion } = versionFiveDatabase();
  insertLegacyOrder(database, "ORD-LEGACY", "legacy-raw-reference");
  insertAttempt(database, "ORD-LEGACY", 3);

  assert.throws(() => applySchemaMigrations(database, migrations, CLOCK().toISOString()), /constraint|check/i);
  assert.equal(schemaVersion(database), keyedVersion - 1);
  const attempts = database.prepare("SELECT public_code, failed_attempts FROM merchant_order_tracking_attempts").all();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.public_code, "ORD-LEGACY");
  assert.equal(Number(attempts[0]?.failed_attempts), 3);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS n FROM merchant_orders WHERE payment_reference = 'legacy-raw-reference'").get()?.n), 1);
  database.close();
});

test("Upgrade: a version-5 database with no orders applies the keyed-hash rebuild and the cutover flag, and the tracking table keeps its foreign key", () => {
  const { database, migrations } = versionFiveDatabase();
  const withCutover = commerceMigrationsWithCutover(migrations);
  applySchemaMigrations(database, withCutover, CLOCK().toISOString());

  assert.equal(schemaVersion(database), withCutover.length);
  assert.equal(withCutover.length, migrations.length + 1);
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(merchant_order_tracking_attempts)").all();
  assert.equal(foreignKeys.some(key => key.table === "merchant_orders" && key.to === "public_code"), true);
  const orderColumns = database.prepare("PRAGMA table_info(merchant_orders)").all().map(column => column.name);
  assert.equal(orderColumns.includes("payment_reference_hash"), true);
  assert.equal(orderColumns.includes("payment_reference"), false);
  database.close();
});

test("Fresh database: the ledger reaches its final version and creates the keyed order shape and the attempts table with its foreign key", () => {
  const database = memory();
  const migrations = commerceMigrations(database);
  assert.equal(schemaVersion(database), migrations.length);
  assert.equal(versionWith(migrations, "payment_reference_hash"), migrations.length);
  assert.equal(versionWith(migrations, "merchant_order_tracking_attempts"), migrations.length - 1);
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(merchant_order_tracking_attempts)").all();
  assert.equal(foreignKeys.some(key => key.table === "merchant_orders"), true);
  database.close();
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

/** Issue 24 decision 7 and user decision 18 Oct 2026: the stored hash is the keyed HMAC of the trimmed reference. */
const keyedHash = (value: string) => paymentReferenceHash(COMMERCE_TEST_REFERENCE_KEYS, value);

/** Every row of every table, serialised, so a test can search the whole database for a value. */
function dumpAllRows(database: NodeSqliteDatabase): string {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name));
  return tables.map(table => JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all())).join("\n");
}

test("issue 24 decision 7: the raw payment reference never reaches the database or a returned order, and a retry finds the order by its hash", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 10000, 5);
  addZone(database, "store", "zone", 0);

  const input = baseInput("store", "zone", { paymentReference: "  raw-ref-secret  ", submittedTotalKobo: 10000, items: [{ offerId: "offer", quantity: 1 }] });
  const order = orders.createOrder(input);

  const dump = dumpAllRows(database);
  assert.equal(dump.includes("raw-ref-secret"), false);
  assert.equal(dump.includes(keyedHash("raw-ref-secret")), true);
  const returned = JSON.stringify([order, orders.orderById(order.id), orders.orderByPublicCode(order.publicCode)]);
  assert.equal(returned.includes("raw-ref-secret"), false);
  assert.equal(returned.includes(keyedHash("raw-ref-secret")), false);

  assert.equal(orders.createOrder(input).id, order.id);
  database.close();
});

test("issue 24 decision 11: an order for a store whose merchant is not verified is refused (ADR 0100), for createOrder and the checkout quote", () => {
  const database = memory();
  const { orders, directory } = pack(database);
  directory.createMerchant({ id: "merchant-pending", name: "Pending", status: "pending" });
  directory.createStore({ id: "store-pending", merchantId: "merchant-pending", slug: "store-pending", name: "Pending store", status: "active" });
  const { catalogue } = pack(database);
  catalogue.createProduct({ id: "product-pending", name: "Pending product", category: "Category" });
  catalogue.createOffer({ id: "offer-pending", productId: "product-pending", storeId: "store-pending", priceKobo: 10000, stock: 5 });
  addZone(database, "store-pending", "zone-pending", 0);
  const input = baseInput("store-pending", "zone-pending", { items: [{ offerId: "offer-pending", quantity: 1 }], submittedTotalKobo: 10000 });

  assert.throws(() => orders.createOrder(input), /unavailable/i);
  assert.throws(() => orders.quoteCheckout(input), /unavailable/i);

  directory.updateMerchantStatus("merchant-pending", "suspended");
  assert.throws(() => orders.createOrder(input), /unavailable/i);

  directory.updateMerchantStatus("merchant-pending", "verified");
  assert.equal(orders.createOrder(input).status, "Pending Verification");
  database.close();
});

test("issue 24 decision 13: an oversell on item 2 refuses the order and leaves item 1's stock unchanged", () => {
  const database = memory();
  const { orders } = pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer-a", 1000, 5);
  addOffer(database, "store", "offer-b", 2000, 1);
  addZone(database, "store", "zone", 0);
  const stockOf = (offerId: string) => Number(database.prepare("SELECT stock FROM merchant_offers WHERE id = $id").get({ $id: offerId })?.stock);

  const input = baseInput("store", "zone", {
    items: [{ offerId: "offer-a", quantity: 2 }, { offerId: "offer-b", quantity: 3 }],
    submittedTotalKobo: 8000,
  });
  assert.throws(() => orders.createOrder(input), /stock/i);
  assert.equal(stockOf("offer-a"), 5);
  assert.equal(stockOf("offer-b"), 1);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS n FROM merchant_orders").get()?.n), 0);
  database.close();
});

test("issue 24 decision 7: the keyed-hash migration replaces the raw payment_reference column with a NOT NULL UNIQUE hash, and refuses to rebuild over legacy orders", () => {
  const database = new NodeSqliteDatabase(":memory:");
  const migrations = commerceMigrations(database);
  // The hash migration is found by its content, so the test follows the ledger when later migrations are added.
  const hashVersion = migrations.find(migration => migration.statements.some(statement => statement.includes("payment_reference_hash")))!.version;
  applySchemaMigrations(database, migrations.slice(0, hashVersion - 1), CLOCK().toISOString());
  pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 1000, 5);
  addZone(database, "store", "zone", 0);
  database.prepare(
    `INSERT INTO merchant_orders (id, store_id, public_code, customer_name, customer_phone, items_json, subtotal_kobo, shipping_fee_kobo, total_kobo, status, shipping_address_json, payment_reference, created_at, updated_at)
     VALUES ('legacy', 'store', 'ORD-LEGACY', 'Ada', '08031234567', '[]', 1000, 0, 1000, 'Pending Verification', '{}', 'legacy-raw-ref', '2026-10-16', '2026-10-16')`,
  ).run();

  assert.throws(() => applySchemaMigrations(database, migrations, CLOCK().toISOString()), /constraint|check/i);
  assert.equal(schemaVersion(database), hashVersion - 1);

  database.prepare("DELETE FROM merchant_orders").run();
  applySchemaMigrations(database, migrations, CLOCK().toISOString());
  const columns = database.prepare("PRAGMA table_info(merchant_orders)").all();
  assert.equal(columns.some(column => column.name === "payment_reference"), false);
  const hash = columns.find(column => column.name === "payment_reference_hash");
  assert.ok(hash);
  assert.equal(Number(hash.notnull), 1);
  const unique = database.prepare("PRAGMA index_list(merchant_orders)").all().filter(index => Number(index.unique) === 1);
  assert.equal(unique.length >= 2, true, "payment_reference_hash and public_code are both UNIQUE");
  database.close();
});

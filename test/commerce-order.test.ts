import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations, schemaVersion } from "../packages/platform-core/src/schema-migrations.js";
import { createCommercePack } from "../domains/commerce/src/index.js";

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

/** Issue 24 decision 7: the stored hash of a payment reference is SHA-256 over its trimmed value. */
const sha256 = (value: string) => createHash("sha256").update(value.trim()).digest("hex");

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
  assert.equal(dump.includes(sha256("raw-ref-secret")), true);
  const returned = JSON.stringify([order, orders.orderById(order.id), orders.orderByPublicCode(order.publicCode)]);
  assert.equal(returned.includes("raw-ref-secret"), false);
  assert.equal(returned.includes(sha256("raw-ref-secret")), false);

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

test("issue 24 decision 7: migration 5 replaces the raw payment_reference column with a NOT NULL UNIQUE hash, and refuses to rebuild over legacy orders", () => {
  const migrations = createCommercePack({ database: memory(), clock: CLOCK }).migrations;
  const database = memory();
  applySchemaMigrations(database, migrations.slice(0, 4), CLOCK().toISOString());
  pack(database);
  setupStore(database, "merchant", "store");
  addOffer(database, "store", "offer", 1000, 5);
  addZone(database, "store", "zone", 0);
  database.prepare(
    `INSERT INTO merchant_orders (id, store_id, public_code, customer_name, customer_phone, items_json, subtotal_kobo, shipping_fee_kobo, total_kobo, status, shipping_address_json, payment_reference, created_at, updated_at)
     VALUES ('legacy', 'store', 'ORD-LEGACY', 'Ada', '08031234567', '[]', 1000, 0, 1000, 'Pending Verification', '{}', 'legacy-raw-ref', '2026-10-16', '2026-10-16')`,
  ).run();

  assert.throws(() => applySchemaMigrations(database, migrations, CLOCK().toISOString()), /constraint|check/i);
  assert.equal(schemaVersion(database), 4);

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

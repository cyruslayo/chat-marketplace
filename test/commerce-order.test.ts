import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
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

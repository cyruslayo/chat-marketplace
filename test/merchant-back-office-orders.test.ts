import { COMMERCE_TEST_REFERENCE_KEYS } from "./helpers/commerce-database.js";
import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../domains/commerce/src/index.js";

/** Slice 25b: merchant back office — delivery zones and order fulfilment. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: CLOCK });
}

function setupStoreWithOrder(database: NodeSqliteDatabase, merchantId: string, storeId: string) {
  const { directory, catalogue, orders } = pack(database);
  directory.createMerchant({ id: merchantId, name: merchantId, status: "verified" });
  directory.createStore({ id: storeId, merchantId, slug: storeId, name: storeId, status: "active" });
  catalogue.createProduct({ id: `product-${storeId}`, name: `Product ${storeId}`, category: "Category" });
  catalogue.createOffer({ id: `offer-${storeId}`, productId: `product-${storeId}`, storeId, priceKobo: 10000, stock: 5 });
  catalogue.createDeliveryZone({ id: `zone-${storeId}`, storeId, city: "Lagos", name: "Mainland", provider: "Bolt", feeKobo: 2000, isActive: true, sortOrder: 0 });
  return orders.createOrder({
    storeId,
    deliveryZoneId: `zone-${storeId}`,
    customerName: "Ada Obi",
    customerPhone: "0803 123 4567",
    shippingAddress: { address: "1 Test Street", city: "Lagos" },
    items: [{ offerId: `offer-${storeId}`, quantity: 1 }],
    submittedTotalKobo: 12000,
    paymentReference: `ref-${storeId}`,
  });
}

const merchant = (id: string) => ({ id, role: "merchant" as const });

test("AC1: a merchant can only act on their own orders", () => {
  const database = memory();
  const { backOffice } = pack(database);
  const orderA = setupStoreWithOrder(database, "merchant-a", "store-a");
  const orderB = setupStoreWithOrder(database, "merchant-b", "store-b");

  assert.throws(() => backOffice.transitionOrder(merchant("merchant-a"), orderB.id, "Processing"), /not found for this merchant/);

  const updated = backOffice.transitionOrder(merchant("merchant-a"), orderA.id, "Processing");
  assert.equal(updated.status, "Processing");
  database.close();
});

test("AC2: only allowed status transitions are offered and accepted", () => {
  const database = memory();
  const { backOffice } = pack(database);

  assert.deepEqual(backOffice.nextOrderStatuses("Shipped"), ["Fulfilled"]);
  assert.deepEqual(backOffice.nextOrderStatuses("Fulfilled"), []);

  const order = setupStoreWithOrder(database, "merchant", "store");
  assert.throws(() => backOffice.transitionOrder(merchant("merchant"), order.id, "Shipped"), /transition/);
  database.close();
});

test("AC3: the consumer's order status reflects the change", () => {
  const database = memory();
  const { orders, backOffice } = pack(database);
  const order = setupStoreWithOrder(database, "merchant", "store");

  assert.equal(orders.orderByPublicCode(order.publicCode)!.status, "Pending Verification");
  backOffice.transitionOrder(merchant("merchant"), order.id, "Processing");
  assert.equal(orders.orderByPublicCode(order.publicCode)!.status, "Processing");
  database.close();
});

import { COMMERCE_TEST_REFERENCE_KEYS } from "./helpers/commerce-database.js";
import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../domains/commerce/src/index.js";

/** Slice 19: commerce catalogue — Product, Merchant Offer, Variant, delivery zones, gated search. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: CLOCK });
}

function verifiedActiveStore(database: NodeSqliteDatabase, merchantId: string, storeId: string) {
  const { directory } = pack(database);
  directory.createMerchant({ id: merchantId, name: "Verified Merchant", status: "verified" });
  directory.createStore({ id: storeId, merchantId, slug: storeId, name: "Active Store", status: "active" });
}

test("AC1: search returns only in-stock offers from active stores of verified merchants", () => {
  const database = memory();
  const { directory, catalogue } = pack(database);

  directory.createMerchant({ id: "merchant-verified", name: "Verified Merchant", status: "verified" });
  directory.createStore({ id: "store-active", merchantId: "merchant-verified", slug: "active-store", name: "Active Store", status: "active" });

  catalogue.createProduct({ id: "product", name: "Running Shoes", category: "Footwear", description: "Lightweight runners", imageKeys: ["shoe-1"] });
  catalogue.createOffer({ id: "offer-in-stock", productId: "product", storeId: "store-active", priceKobo: 15000, stock: 5 });
  catalogue.createOffer({ id: "offer-out-of-stock", productId: "product", storeId: "store-active", priceKobo: 15000, stock: 0 });

  directory.createMerchant({ id: "merchant-pending", name: "Pending Merchant", status: "pending" });
  directory.createStore({ id: "store-pending", merchantId: "merchant-pending", slug: "pending-store", name: "Pending Store", status: "active" });
  catalogue.createOffer({ id: "offer-pending-merchant", productId: "product", storeId: "store-pending", priceKobo: 15000, stock: 5 });

  directory.createStore({ id: "store-suspended", merchantId: "merchant-verified", slug: "suspended-store", name: "Suspended Store", status: "suspended" });
  catalogue.createOffer({ id: "offer-suspended-store", productId: "product", storeId: "store-suspended", priceKobo: 15000, stock: 5 });

  assert.deepEqual(catalogue.searchOffers().map((result) => result.offerId), ["offer-in-stock"]);
  database.close();
});

test("AC2: a variant has its own stock and an out-of-stock variant cannot be selected", () => {
  const database = memory();
  const { catalogue } = pack(database);
  verifiedActiveStore(database, "merchant", "store");

  catalogue.createProduct({ id: "product", name: "T-Shirt", category: "Clothing" });
  catalogue.createOffer({ id: "offer", productId: "product", storeId: "store", priceKobo: 5000, stock: 10 });
  catalogue.createVariant({ id: "variant-in-stock", offerId: "offer", name: "Large", stock: 3 });
  catalogue.createVariant({ id: "variant-out-of-stock", offerId: "offer", name: "Small", stock: 0 });

  const selected = catalogue.selectVariant("offer", "variant-in-stock");
  assert.equal(selected.id, "variant-in-stock");
  assert.equal(selected.stock, 3);

  assert.throws(() => catalogue.selectVariant("offer", "variant-out-of-stock"), /out of stock/);
  database.close();
});

test("AC3: a delivery quote uses only an active zone belonging to the offer's store", () => {
  const database = memory();
  const { catalogue } = pack(database);
  verifiedActiveStore(database, "merchant-a", "store-a");
  verifiedActiveStore(database, "merchant-b", "store-b");

  catalogue.createDeliveryZone({ id: "zone-a-active", storeId: "store-a", city: "Lagos", name: "Mainland", provider: "Bolt", feeKobo: 2000, isActive: true, sortOrder: 0 });
  catalogue.createDeliveryZone({ id: "zone-a-inactive", storeId: "store-a", city: "Abuja", name: "Wuse", provider: "Bolt", feeKobo: 3000, isActive: false, sortOrder: 0 });
  catalogue.createDeliveryZone({ id: "zone-b", storeId: "store-b", city: "Lagos", name: "Island", provider: "Bolt", feeKobo: 4000, isActive: true, sortOrder: 0 });

  assert.deepEqual(catalogue.activeDeliveryZones("store-a").map((zone) => zone.id), ["zone-a-active"]);
  database.close();
});

test("AC4: prices are integer kobo, never floats", () => {
  const database = memory();
  const { catalogue } = pack(database);
  verifiedActiveStore(database, "merchant", "store");

  catalogue.createProduct({ id: "product", name: "Item", category: "Category" });
  const offer = catalogue.createOffer({ id: "offer", productId: "product", storeId: "store", priceKobo: 1500, stock: 1 });
  assert.equal(offer.priceKobo, 1500);
  assert.equal(Number.isInteger(offer.priceKobo), true);

  assert.throws(() => catalogue.createOffer({ id: "offer-float", productId: "product", storeId: "store", priceKobo: 15.5, stock: 1 }), /integer/);
  database.close();
});

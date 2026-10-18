import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../domains/commerce/src/index.js";

/** Slice 25a: merchant back office — onboarding and catalogue management. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ database, clock: CLOCK });
}

function setupMerchantStore(database: NodeSqliteDatabase, merchantId: string, storeId: string, status: "verified" | "pending" = "verified") {
  const { directory } = pack(database);
  directory.createMerchant({ id: merchantId, name: merchantId, status });
  directory.createStore({ id: storeId, merchantId, slug: storeId, name: storeId, status: "active" });
}

const merchant = (id: string) => ({ id, role: "merchant" as const });
const operator = (id: string) => ({ id, role: "operator" as const });

test("AC1: a merchant can only see and edit their own stores' catalogue", () => {
  const database = memory();
  const { catalogue, backOffice } = pack(database);
  setupMerchantStore(database, "merchant-a", "store-a");
  setupMerchantStore(database, "merchant-b", "store-b");
  catalogue.createProduct({ id: "product-a", name: "A", category: "Category" });
  catalogue.createProduct({ id: "product-b", name: "B", category: "Category" });
  catalogue.createOffer({ id: "offer-a", productId: "product-a", storeId: "store-a", priceKobo: 1000, stock: 5 });
  catalogue.createOffer({ id: "offer-b", productId: "product-b", storeId: "store-b", priceKobo: 2000, stock: 5 });

  assert.deepEqual(backOffice.merchantCatalogue(merchant("merchant-a"), "store-a").map((offer) => offer.offerId), ["offer-a"]);
  assert.throws(() => backOffice.merchantCatalogue(merchant("merchant-a"), "store-b"), /not found for this merchant/);

  backOffice.updateOfferPrice(merchant("merchant-a"), "store-a", "offer-a", 1500);
  assert.equal(catalogue.offersForStore("store-a")[0]!.priceKobo, 1500);
  assert.throws(() => backOffice.updateOfferPrice(merchant("merchant-a"), "store-b", "offer-b", 2500), /not found for this merchant/);
  database.close();
});

test("AC2: only an operator can mark a merchant verified", () => {
  const database = memory();
  const { directory, backOffice } = pack(database);
  setupMerchantStore(database, "merchant", "store", "pending");

  assert.deepEqual(directory.consumerStores(), []);
  assert.throws(() => backOffice.markMerchantVerified(merchant("merchant"), "merchant"), /operator/);
  backOffice.markMerchantVerified(operator("operator-1"), "merchant");
  assert.deepEqual(directory.consumerStores().map((store) => store.id), ["store"]);
  database.close();
});

test("AC3: product edits are visible to the agent search immediately", () => {
  const database = memory();
  const { catalogue, backOffice } = pack(database);
  setupMerchantStore(database, "merchant", "store");
  catalogue.createProduct({ id: "product", name: "Running Shoes", category: "Footwear" });
  catalogue.createOffer({ id: "offer", productId: "product", storeId: "store", priceKobo: 1000, stock: 5 });

  assert.equal(catalogue.searchOffers()[0]!.priceKobo, 1000);
  backOffice.updateOfferPrice(merchant("merchant"), "store", "offer", 1500);
  assert.equal(catalogue.searchOffers()[0]!.priceKobo, 1500);
  database.close();
});

import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createCommercePack } from "../domains/commerce/src/index.js";

/** Slice 20: Marketplace Cart and Store Carts, server-side per task. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

function pack(database: NodeSqliteDatabase) {
  return createCommercePack({ database, clock: CLOCK });
}

function addOffer(database: NodeSqliteDatabase, merchantId: string, storeId: string, offerId: string, stock: number, priceKobo = 10000) {
  const { directory, catalogue } = pack(database);
  directory.createMerchant({ id: merchantId, name: `Merchant ${merchantId}`, status: "verified" });
  directory.createStore({ id: storeId, merchantId, slug: storeId, name: `Store ${storeId}`, status: "active" });
  catalogue.createProduct({ id: `product-${offerId}`, name: `Product ${offerId}`, category: "Category" });
  catalogue.createOffer({ id: offerId, productId: `product-${offerId}`, storeId, priceKobo, stock });
}

test("AC1: items from two stores form two Store Carts", () => {
  const database = memory();
  const { cart } = pack(database);
  addOffer(database, "merchant-a", "store-a", "offer-a", 5);
  addOffer(database, "merchant-b", "store-b", "offer-b", 5);

  cart.addLine({ taskId: "task-1", offerId: "offer-a", quantity: 1 });
  cart.addLine({ taskId: "task-1", offerId: "offer-b", quantity: 2 });

  const result = cart.cart("task-1");
  assert.equal(result.storeCarts.length, 2);
  assert.deepEqual(result.storeCarts.map((storeCart) => storeCart.storeId).sort(), ["store-a", "store-b"]);
  database.close();
});

test("AC2: a cart line whose offer price changed shows the current price", () => {
  const database = memory();
  const { cart, catalogue } = pack(database);
  addOffer(database, "merchant", "store", "offer", 5, 10000);

  cart.addLine({ taskId: "task-1", offerId: "offer", quantity: 1 });
  catalogue.updateOfferPrice("offer", 12000);

  const line = cart.cart("task-1").storeCarts[0]!.lines[0]!;
  assert.equal(line.priceKobo, 12000);
  database.close();
});

test("AC3: adding more than available stock is rejected", () => {
  const database = memory();
  const { cart } = pack(database);
  addOffer(database, "merchant", "store", "offer", 2);

  assert.throws(() => cart.addLine({ taskId: "task-1", offerId: "offer", quantity: 3 }), /stock/);
  cart.addLine({ taskId: "task-1", offerId: "offer", quantity: 2 });
  assert.throws(() => cart.addLine({ taskId: "task-1", offerId: "offer", quantity: 1 }), /stock/);
  database.close();
});

test("AC4: a cart line for a suspended store or unverified merchant is marked unavailable", () => {
  const database = memory();
  const { cart, directory } = pack(database);
  addOffer(database, "merchant", "store", "offer", 5);

  cart.addLine({ taskId: "task-1", offerId: "offer", quantity: 1 });

  directory.updateStoreStatus("store", "suspended");
  assert.equal(cart.cart("task-1").storeCarts[0]!.lines[0]!.available, false);

  directory.updateStoreStatus("store", "active");
  directory.updateMerchantStatus("merchant", "pending");
  assert.equal(cart.cart("task-1").storeCarts[0]!.lines[0]!.available, false);
  database.close();
});

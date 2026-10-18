import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { MerchantEnvironment } from "../apps/local-merchant/src/merchant-environment.js";

test("the merchant environment composes the commerce pack and seeds its store", () => {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  const environment = new MerchantEnvironment({}, database);

  assert.equal(environment.merchantPrincipal().role, "merchant");
  assert.equal(environment.merchantPrincipal().id, "merchant-lagos-001");
  assert.equal(environment.pack.directory.storeById("store-lagos-001")?.merchantId, "merchant-lagos-001");
  assert.equal(environment.pack.backOffice.merchantStores(environment.merchantPrincipal()).length, 1);
  database.close();
});

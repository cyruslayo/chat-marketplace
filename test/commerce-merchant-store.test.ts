import { COMMERCE_TEST_REFERENCE_KEYS } from "./helpers/commerce-database.js";
import { migrateCommerceDatabase } from "./helpers/commerce-database.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import {
  AssistantPackRegistry,
  type AssistantDomainPack,
} from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createCommercePack } from "../domains/commerce/src/index.js";
import * as commerceIndex from "../domains/commerce/src/index.js";

/** Slice 18: commerce pack scaffold — registration, Merchant/Store migrations, verification gating. */

const CLOCK = () => new Date("2026-10-16T00:00:00.000Z");

function memory(): NodeSqliteDatabase {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  return database;
}

test("AC1: the commerce pack registers through the same registry as shortlet with no special case", () => {
  const database = memory();
  const pack: AssistantDomainPack = createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: CLOCK });
  const registry = new AssistantPackRegistry();
  registry.register(pack);

  assert.equal(registry.size, 1);
  assert.equal(registry.packFor("commerce")?.id, "commerce");
  database.close();
});

test("AC2: a store whose merchant is not verified is never returned to consumers", () => {
  const database = memory();
  const { directory } = createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: CLOCK });

  directory.createMerchant({ id: "merchant-pending", name: "Pending Merchant", status: "pending" });
  directory.createStore({ id: "store-pending", merchantId: "merchant-pending", slug: "pending-store", name: "Pending Store", status: "active" });

  directory.createMerchant({ id: "merchant-suspended", name: "Suspended Merchant", status: "suspended" });
  directory.createStore({ id: "store-suspended-merchant", merchantId: "merchant-suspended", slug: "suspended-merchant-store", name: "Suspended Merchant Store", status: "active" });

  assert.deepEqual(directory.consumerStores(), []);
  database.close();
});

test("AC3: a suspended store is never returned to consumers", () => {
  const database = memory();
  const { directory } = createCommercePack({ paymentReferenceKeys: COMMERCE_TEST_REFERENCE_KEYS, database, clock: CLOCK });

  directory.createMerchant({ id: "merchant-verified", name: "Verified Merchant", status: "verified" });
  directory.createStore({ id: "store-suspended", merchantId: "merchant-verified", slug: "suspended-store", name: "Suspended Store", status: "suspended" });
  directory.createStore({ id: "store-active", merchantId: "merchant-verified", slug: "active-store", name: "Active Store", status: "active" });

  const visible = directory.consumerStores();
  assert.equal(visible.length, 1);
  assert.equal(visible[0]!.id, "store-active");
  database.close();
});

test("AC4: the boundary test covers domains/commerce", () => {
  // The façade runtime exports: the pack factory, the untrusted-checkout parser, and the payment reference key minimum (ADR 0099).
  assert.deepEqual(Object.keys(commerceIndex).sort(), ["PAYMENT_REFERENCE_KEY_MIN_BYTES", "createCommercePack", "parseCreateOrderInput"]);

  const allowlist = JSON.parse(
    readFileSync(new URL("./fixtures/domain-boundary-allowlist.json", import.meta.url), "utf8"),
  ) as [string, string][];
  assert.equal(allowlist.some(([, module]) => module.startsWith("domains/commerce/")), false);
});

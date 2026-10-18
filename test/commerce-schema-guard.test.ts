import assert from "node:assert/strict";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { assertMerchantOrdersShape, assertPaymentReferenceHashes, COMMERCE_SCHEMA_SHAPE_INVALID } from "../apps/cloudflare/src/commerce-schema-guard.js";
import { commerceMigrations, migrateCommerceDatabase } from "./helpers/commerce-database.js";

/** Issue 24 review 2 (shape after migrations) and review 10 (payment_reference_hash format on import). */

test("issue 24 review 2: a migrated merchant_orders table passes the shape check", () => {
  const database = new NodeSqliteDatabase(":memory:");
  migrateCommerceDatabase(database);
  assert.doesNotThrow(() => assertMerchantOrdersShape(database));
  database.close();
});

test("issue 24 review 2: a legacy merchant_orders table with a raw payment_reference column fails closed with a fixed code", () => {
  const database = new NodeSqliteDatabase(":memory:");
  const migrations = commerceMigrations(database);
  const hashVersion = migrations.find(migration => migration.statements.some(statement => statement.includes("payment_reference_hash")))!.version;
  applySchemaMigrations(database, migrations.slice(0, hashVersion - 1), "2026-10-16T00:00:00.000Z");
  assert.throws(() => assertMerchantOrdersShape(database), (error: unknown) => (error as { code?: string }).code === COMMERCE_SCHEMA_SHAPE_INVALID);
  database.close();
});

test("issue 24 review 2: a database with no merchant_orders table fails the shape check", () => {
  const database = new NodeSqliteDatabase(":memory:");
  assert.throws(() => assertMerchantOrdersShape(database), (error: unknown) => (error as { code?: string }).code === COMMERCE_SCHEMA_SHAPE_INVALID);
  database.close();
});

const VALID_HASH = "a".repeat(64);

test("issue 24 review 10: an import row with a 64-character lowercase hex payment_reference_hash is accepted", () => {
  assert.doesNotThrow(() => assertPaymentReferenceHashes([{ id: "order", payment_reference_hash: VALID_HASH }]));
});

test("issue 24 review 10: an import row whose payment_reference_hash is not 64 lowercase hex is refused", () => {
  const refused: unknown[] = [
    [{ id: "order", payment_reference_hash: "raw-payment-reference" }],
    [{ id: "order", payment_reference_hash: "A".repeat(64) }],
    [{ id: "order", payment_reference_hash: "a".repeat(63) }],
    [{ id: "order", payment_reference_hash: "a".repeat(65) }],
    [{ id: "order", payment_reference_hash: 12345 }],
    [{ id: "order" }],
    [{ id: "order", payment_reference: "raw-payment-reference" }],
  ];
  for (const rows of refused) {
    assert.throws(() => assertPaymentReferenceHashes(rows as unknown[]), /payment_reference_hash/);
  }
});

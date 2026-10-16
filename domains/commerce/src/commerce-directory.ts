import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";
import { parseMerchantRecord, type Merchant, type MerchantStatus } from "./merchant.js";
import { parseStoreRecord, type Store, type StoreStatus } from "./store.js";

/** Table DDL, applied by the migrations and by this directory's constructor (IF NOT EXISTS, so both are idempotent). */
export const MERCHANT_SCHEMA = `CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const STORE_SCHEMA = `CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/** The commerce domain's ordered schema. Version 1 is the baseline: Merchant and Store. */
export const COMMERCE_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "commerce baseline: merchants and stores", statements: [MERCHANT_SCHEMA, STORE_SCHEMA] },
];

export interface MerchantInput {
  readonly id: string;
  readonly name: string;
  readonly status: MerchantStatus;
}

export interface StoreInput {
  readonly id: string;
  readonly merchantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: StoreStatus;
}

function readMerchant(row: SqlRow): Merchant {
  return parseMerchantRecord(
    { id: row.id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at },
    "Stored Merchant",
  );
}

function readStore(row: SqlRow): Store {
  return parseStoreRecord(
    { id: row.id, merchantId: row.merchant_id, slug: row.slug, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at },
    "Stored Store",
  );
}

/** The read/write repository for Merchants and Stores, including the consumer-visibility rule. */
export class CommerceDirectory {
  constructor(private readonly database: SqlDatabase, private readonly clock: () => Date) {
    database.exec(MERCHANT_SCHEMA);
    database.exec(STORE_SCHEMA);
  }

  createMerchant(input: MerchantInput): Merchant {
    const now = this.clock().toISOString();
    const merchant = parseMerchantRecord({ ...input, createdAt: now, updatedAt: now }, "Merchant");
    this.database
      .prepare("INSERT INTO merchants (id, name, status, created_at, updated_at) VALUES ($id, $name, $status, $createdAt, $updatedAt)")
      .run({ $id: merchant.id, $name: merchant.name, $status: merchant.status, $createdAt: merchant.createdAt, $updatedAt: merchant.updatedAt });
    return merchant;
  }

  createStore(input: StoreInput): Store {
    const now = this.clock().toISOString();
    const store = parseStoreRecord({ ...input, createdAt: now, updatedAt: now }, "Store");
    this.database
      .prepare("INSERT INTO stores (id, merchant_id, slug, name, status, created_at, updated_at) VALUES ($id, $merchantId, $slug, $name, $status, $createdAt, $updatedAt)")
      .run({ $id: store.id, $merchantId: store.merchantId, $slug: store.slug, $name: store.name, $status: store.status, $createdAt: store.createdAt, $updatedAt: store.updatedAt });
    return store;
  }

  /** Stores a Consumer may see: active stores of verified merchants only (ADR 0100). */
  consumerStores(): readonly Store[] {
    return this.database
      .prepare(
        `SELECT s.id, s.merchant_id, s.slug, s.name, s.status, s.created_at, s.updated_at
         FROM stores s
         JOIN merchants m ON m.id = s.merchant_id
         WHERE m.status = 'verified' AND s.status = 'active'
         ORDER BY s.slug`,
      )
      .all()
      .map(readStore);
  }
}

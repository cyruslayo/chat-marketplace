import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { MERCHANT_SCHEMA, STORE_SCHEMA } from "./commerce-schema.js";
import { parseMerchantRecord, type Merchant, type MerchantStatus } from "./merchant.js";
import { parseStoreRecord, type Store, type StoreStatus } from "./store.js";

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

  storeById(storeId: string): Store | null {
    const row = this.database
      .prepare("SELECT id, merchant_id, slug, name, status, created_at, updated_at FROM stores WHERE id = $id")
      .get({ $id: storeId });
    return row ? readStore(row) : null;
  }

  merchantById(merchantId: string): Merchant | null {
    const row = this.database
      .prepare("SELECT id, name, status, created_at, updated_at FROM merchants WHERE id = $id")
      .get({ $id: merchantId });
    return row ? readMerchant(row) : null;
  }

  storesOfMerchant(merchantId: string): readonly Store[] {
    return this.database
      .prepare("SELECT id, merchant_id, slug, name, status, created_at, updated_at FROM stores WHERE merchant_id = $merchantId ORDER BY slug")
      .all({ $merchantId: merchantId })
      .map(readStore);
  }

  updateMerchantStatus(merchantId: string, status: MerchantStatus): void {
    const result = this.database
      .prepare("UPDATE merchants SET status = $status, updated_at = $updatedAt WHERE id = $id")
      .run({ $status: status, $updatedAt: this.clock().toISOString(), $id: merchantId });
    if (result.changes === 0) throw new Error("The merchant does not exist.");
  }

  updateStoreStatus(storeId: string, status: StoreStatus): void {
    const result = this.database
      .prepare("UPDATE stores SET status = $status, updated_at = $updatedAt WHERE id = $id")
      .run({ $status: status, $updatedAt: this.clock().toISOString(), $id: storeId });
    if (result.changes === 0) throw new Error("The store does not exist.");
  }
}

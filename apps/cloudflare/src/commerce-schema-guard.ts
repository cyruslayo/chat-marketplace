import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";

/** Fixed codes for the commerce object (issue 24 reviews 2, 5 and 10). They are logged or returned alone, never with a payload. */
export const COMMERCE_SCHEMA_SHAPE_INVALID = "COMMERCE_SCHEMA_SHAPE_INVALID";
export const COMMERCE_MIGRATION_FAILED = "COMMERCE_MIGRATION_FAILED";
export const INVALID_PAYMENT_REFERENCE_HASH = "INVALID_PAYMENT_REFERENCE_HASH";

/** The shape the migration ledger must leave merchant_orders in: the hash column present, the raw reference column absent. */
export class CommerceSchemaShapeError extends Error {
  readonly code = COMMERCE_SCHEMA_SHAPE_INVALID;
  constructor() {
    super("merchant_orders does not match the expected payment reference shape");
  }
}

/** Throws unless merchant_orders has `payment_reference_hash` and no `payment_reference` column (issue 24 review 2). */
export function assertMerchantOrdersShape(database: SqlDatabase): void {
  const columns = new Set(database.prepare("PRAGMA table_info(merchant_orders)").all().map(row => String(row.name)));
  if (!columns.has("payment_reference_hash") || columns.has("payment_reference")) throw new CommerceSchemaShapeError();
}

/** A payment_reference_hash is the lowercase hex SHA-256 of a reference: exactly 64 lowercase hex characters (issue 24 review 10). */
const PAYMENT_REFERENCE_HASH = /^[0-9a-f]{64}$/;

/** Throws when any imported merchant_orders row lacks a well-formed payment_reference_hash. The values are never echoed. */
export function assertPaymentReferenceHashes(rows: readonly unknown[]): void {
  for (const row of rows) {
    const hash = typeof row === "object" && row !== null ? (row as Record<string, unknown>).payment_reference_hash : undefined;
    if (typeof hash !== "string" || !PAYMENT_REFERENCE_HASH.test(hash)) {
      throw new Error("payment_reference_hash must be 64 lowercase hex characters");
    }
  }
}

import type { SqlDatabase } from "../sql-database.js";

export interface ReceiptBlob {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Where receipt bytes live (ADR 0090). The port is async because the Cloudflare implementation is R2; the Node
 * implementation keeps the bytes in SQLite. Keys are opaque and random, never derived from a booking reference or
 * guest data (ADR 0075). Callers must never await inside a SQL transaction: put before it, delete after it.
 */
export interface ReceiptBlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<ReceiptBlob | null>;
  /** Idempotent: deleting a missing key does not throw. */
  delete(key: string): Promise<void>;
}

/** A fresh opaque object key (ADR 0075). */
export function newReceiptObjectKey(): string {
  return crypto.randomUUID();
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const RECEIPT_BLOB_SCHEMA = "CREATE TABLE IF NOT EXISTS receipt_blobs (object_key TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes BLOB NOT NULL)";

/** Today's behaviour for Node and local use: the bytes sit in the shared SQLite file. */
export class SqliteReceiptBlobStore implements ReceiptBlobStore {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
    database.exec(
      RECEIPT_BLOB_SCHEMA,
    );
  }
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.#database
      .prepare(
        "INSERT INTO receipt_blobs (object_key, content_type, bytes) VALUES ($key, $type, $bytes) ON CONFLICT(object_key) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes",
      )
      .run({ $key: key, $type: contentType, $bytes: bytes });
  }
  async get(key: string): Promise<ReceiptBlob | null> {
    const row = this.#database
      .prepare("SELECT content_type, bytes FROM receipt_blobs WHERE object_key = $key")
      .get({ $key: key });
    if (!row || typeof row.content_type !== "string" || !(row.bytes instanceof Uint8Array)) return null;
    return { bytes: Uint8Array.from(row.bytes), contentType: row.content_type };
  }
  async delete(key: string): Promise<void> {
    this.#database.prepare("DELETE FROM receipt_blobs WHERE object_key = $key").run({ $key: key });
  }
}

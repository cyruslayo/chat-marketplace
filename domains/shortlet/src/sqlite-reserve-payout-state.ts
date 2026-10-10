import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import type {
  ExecutedReserveCommand,
  ReservePayoutRecordCollection,
  ReservePayoutStateStore,
} from "./reserve-payout-state.js";
import type { AdminHoldRecord, ReserveTranche } from "./reserve-payout-trust.js";

type CollectionName = "tranches" | "admin_holds" | "executed_commands";

class SqliteCollection<T> implements ReservePayoutRecordCollection<T> {
  constructor(
    private readonly database: SqlDatabase,
    private readonly name: CollectionName,
  ) {}
  get(key: string): T | undefined {
    const row = this.database
      .prepare("SELECT record_json FROM reserve_payout_records WHERE collection = $name AND record_key = $key")
      .get({ $name: this.name, $key: key });
    // Written only by set() below from a typed value, so the shape is the manager's own.
    return row && typeof row.record_json === "string" ? (JSON.parse(row.record_json) as T) : undefined;
  }
  set(key: string, value: T): void {
    this.database
      .prepare(
        "INSERT INTO reserve_payout_records (collection, record_key, record_json) VALUES ($name, $key, $json) ON CONFLICT(collection, record_key) DO UPDATE SET record_json = excluded.record_json",
      )
      .run({ $name: this.name, $key: key, $json: JSON.stringify(value) });
  }
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const RESERVE_PAYOUT_SCHEMA = `
      CREATE TABLE IF NOT EXISTS reserve_payout_records (
        collection TEXT NOT NULL,
        record_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (collection, record_key)
      );
    `;

/**
 * Reserve tranches, admin payout holds and executed commands on the shared handle (ADR 0004, ADR 0095). Records hold
 * ids, amounts and human reasons only, never credentials (ADR 0075).
 */
export class SqliteReservePayoutStateStore implements ReservePayoutStateStore {
  readonly tranches: ReservePayoutRecordCollection<ReserveTranche>;
  readonly adminHolds: ReservePayoutRecordCollection<AdminHoldRecord>;
  readonly executedCommands: ReservePayoutRecordCollection<ExecutedReserveCommand>;
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
    database.exec(RESERVE_PAYOUT_SCHEMA);
    this.tranches = new SqliteCollection(database, "tranches");
    this.adminHolds = new SqliteCollection(database, "admin_holds");
    this.executedCommands = new SqliteCollection(database, "executed_commands");
  }

  transaction<T>(fn: () => T): T {
    return this.#database.transaction(fn);
  }
}

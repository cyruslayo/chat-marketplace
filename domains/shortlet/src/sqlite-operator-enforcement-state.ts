import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import type {
  EnforcementAppealRecord,
  EnforcementNoticeRecord,
  FinalizedEnforcementRecord,
  IncidentRecordInput,
  ProtectiveActionRecord,
} from "./operator-enforcement.js";
import type {
  EnforcementRecordCollection,
  OperatorEnforcementStateStore,
  RestorationDisposition,
} from "./operator-enforcement-state.js";

type CollectionName =
  | "incidents"
  | "protective_actions"
  | "finalized_enforcements"
  | "notices"
  | "appeals"
  | "restored_units"
  | "restoration_dispositions"
  | "initial_decision_makers";

class SqliteCollection<T> implements EnforcementRecordCollection<T> {
  constructor(
    private readonly database: SqlDatabase,
    private readonly name: CollectionName,
  ) {}
  get(key: string): T | undefined {
    const row = this.database
      .prepare("SELECT record_json FROM operator_enforcement_records WHERE collection = $name AND record_key = $key")
      .get({ $name: this.name, $key: key });
    return row && typeof row.record_json === "string" ? this.#parse(row.record_json) : undefined;
  }
  has(key: string): boolean {
    return (
      this.database
        .prepare("SELECT 1 AS present FROM operator_enforcement_records WHERE collection = $name AND record_key = $key")
        .get({ $name: this.name, $key: key }) !== undefined
    );
  }
  set(key: string, value: T): void {
    // The upsert keeps the row's position, so values() stays in first-insertion order like a Map.
    this.database
      .prepare(
        "INSERT INTO operator_enforcement_records (collection, record_key, record_json) VALUES ($name, $key, $json) ON CONFLICT(collection, record_key) DO UPDATE SET record_json = excluded.record_json",
      )
      .run({ $name: this.name, $key: key, $json: JSON.stringify(value) });
  }
  delete(key: string): void {
    this.database
      .prepare("DELETE FROM operator_enforcement_records WHERE collection = $name AND record_key = $key")
      .run({ $name: this.name, $key: key });
  }
  values(): T[] {
    return this.database
      .prepare("SELECT record_json FROM operator_enforcement_records WHERE collection = $name ORDER BY rowid")
      .all({ $name: this.name })
      .flatMap((row) => (typeof row.record_json === "string" ? [this.#parse(row.record_json)] : []));
  }
  #parse(json: string): T {
    // Written only by set() above from a typed value, so the shape is the manager's own.
    return JSON.parse(json) as T;
  }
}

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const OPERATOR_ENFORCEMENT_SCHEMA = `
      CREATE TABLE IF NOT EXISTS operator_enforcement_records (
        collection TEXT NOT NULL,
        record_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (collection, record_key)
      );
      CREATE TABLE IF NOT EXISTS operator_enforcement_sequence (
        sequence_name TEXT PRIMARY KEY,
        last_value INTEGER NOT NULL
      );
    `;

/**
 * Operator enforcement state on the shared handle (ADR 0064, ADR 0004). Enforcement decisions are records of human
 * decisions, appeals and notices; they hold no credentials (ADR 0075), so they are stored as written.
 */
export class SqliteOperatorEnforcementStateStore implements OperatorEnforcementStateStore {
  readonly incidents: EnforcementRecordCollection<IncidentRecordInput>;
  readonly protectiveActions: EnforcementRecordCollection<ProtectiveActionRecord>;
  readonly finalizedEnforcements: EnforcementRecordCollection<FinalizedEnforcementRecord>;
  readonly notices: EnforcementRecordCollection<EnforcementNoticeRecord>;
  readonly appeals: EnforcementRecordCollection<EnforcementAppealRecord>;
  readonly restoredUnits: EnforcementRecordCollection<true>;
  readonly restorationDispositions: EnforcementRecordCollection<RestorationDisposition>;
  readonly initialDecisionMakers: EnforcementRecordCollection<string>;
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
    database.exec(OPERATOR_ENFORCEMENT_SCHEMA);
    this.incidents = new SqliteCollection(database, "incidents");
    this.protectiveActions = new SqliteCollection(database, "protective_actions");
    this.finalizedEnforcements = new SqliteCollection(database, "finalized_enforcements");
    this.notices = new SqliteCollection(database, "notices");
    this.appeals = new SqliteCollection(database, "appeals");
    this.restoredUnits = new SqliteCollection(database, "restored_units");
    this.restorationDispositions = new SqliteCollection(database, "restoration_dispositions");
    this.initialDecisionMakers = new SqliteCollection(database, "initial_decision_makers");
  }

  nextSequence(): number {
    return this.#database.transaction(() => {
      this.#database
        .prepare(
          "INSERT INTO operator_enforcement_sequence (sequence_name, last_value) VALUES ('enforcement', 1) ON CONFLICT(sequence_name) DO UPDATE SET last_value = last_value + 1",
        )
        .run();
      const row = this.#database
        .prepare("SELECT last_value FROM operator_enforcement_sequence WHERE sequence_name = 'enforcement'")
        .get();
      const value = Number(row?.last_value);
      if (!Number.isSafeInteger(value)) throw new TypeError("Enforcement sequence is not an integer");
      return value;
    });
  }

  transaction<T>(fn: () => T): T {
    return this.#database.transaction(fn);
  }
}

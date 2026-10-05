import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges, type StatementSync } from "node:sqlite";
import type { SqlDatabase, SqlParams, SqlRow, SqlStatement, SqlValue } from "./sql-database.js";

const BUSY_TIMEOUT_MS = 5_000;

function isSqlValue(value: unknown): value is SqlValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSqlRow(value: unknown): SqlRow {
  if (!isRecord(value)) {
    throw new TypeError("SQLite returned a row that is not an object");
  }

  const row: SqlRow = {};
  for (const key of Object.keys(value)) {
    const cell = value[key];
    if (!isSqlValue(cell)) {
      throw new TypeError(`SQLite returned an unsupported value for column ${key}`);
    }
    row[key] = cell;
  }
  return row;
}

function isPositionalParams(params: SqlParams): params is readonly SqlValue[] {
  return Array.isArray(params);
}

function toNodeValue(value: SqlValue): SQLInputValue {
  return value instanceof Uint8Array ? Uint8Array.from(value) : value;
}

function toNamedParameters(params: Record<string, SqlValue>): Record<string, SQLInputValue> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, toNodeValue(value)]));
}

function changesToNumber(result: StatementResultingChanges): number {
  const changes = result.changes;
  const numeric = typeof changes === "bigint" ? Number(changes) : changes;
  if (!Number.isSafeInteger(numeric)) throw new RangeError("SQLite change count exceeds the safe integer range");
  return numeric;
}

class NodeSqliteStatement implements SqlStatement {
  constructor(private readonly statement: StatementSync) {}

  get(params?: SqlParams): SqlRow | undefined {
    const row = params === undefined
      ? this.statement.get()
      : isPositionalParams(params)
        ? this.statement.get(...params.map(toNodeValue))
        : this.statement.get(toNamedParameters(params));
    return row === undefined ? undefined : toSqlRow(row);
  }

  all(params?: SqlParams): SqlRow[] {
    const rows = params === undefined
      ? this.statement.all()
      : isPositionalParams(params)
        ? this.statement.all(...params.map(toNodeValue))
        : this.statement.all(toNamedParameters(params));
    return rows.map(toSqlRow);
  }

  run(params?: SqlParams): { changes: number } {
    const result = params === undefined
      ? this.statement.run()
      : isPositionalParams(params)
        ? this.statement.run(...params.map(toNodeValue))
        : this.statement.run(toNamedParameters(params));
    return { changes: changesToNumber(result) };
  }
}

export class NodeSqliteDatabase implements SqlDatabase {
  readonly #database: DatabaseSync;
  readonly #ownsDatabase: boolean;
  #transactionDepth = 0;

  /** An existing handle is borrowed: no pragmas are changed and close() does not close it. */
  constructor(pathOrDatabase: string | DatabaseSync) {
    this.#ownsDatabase = typeof pathOrDatabase === "string";
    if (typeof pathOrDatabase !== "string") {
      this.#database = pathOrDatabase;
      return;
    }
    mkdirSync(dirname(pathOrDatabase), { recursive: true });
    this.#database = new DatabaseSync(pathOrDatabase);
    // Preserve the existing 5-second timeout used by availability-store.ts,
    // guest-interaction-store.ts, and apps/local-guest/src/fixture.ts.
    this.#database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string): SqlStatement {
    return new NodeSqliteStatement(this.#database.prepare(sql));
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    const depth = this.#transactionDepth;
    const savepoint = `__sql_transaction_${depth}`;
    // ADR 0095: retain nested rollback boundaries, including transactions started by unconverted Node callers.
    const ownsTransaction = depth === 0 && !this.#database.isTransaction;
    if (ownsTransaction) this.#database.exec("BEGIN IMMEDIATE");
    else this.#database.exec(`SAVEPOINT ${savepoint}`);
    this.#transactionDepth = depth + 1;
    try {
      const result = fn();
      if (isThenable(result)) throw new TypeError("SQL transaction callbacks must be synchronous");
      if (ownsTransaction) this.#database.exec("COMMIT");
      else this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (ownsTransaction) this.#database.exec("ROLLBACK");
      else {
        this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    } finally {
      this.#transactionDepth = depth;
    }
  }

  close(): void {
    if (this.#ownsDatabase) this.#database.close();
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  return "then" in value && typeof value.then === "function";
}

export function openNodeSqliteDatabase(path: string): NodeSqliteDatabase {
  return new NodeSqliteDatabase(path);
}

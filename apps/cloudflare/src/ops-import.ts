import type { SqlDatabase, SqlRow, SqlValue } from "../../../packages/platform-core/src/sql-database.js";
import {
  MAX_STATEMENT_PARAMETERS,
  applicationTableNames,
  canonicalTableContent,
  contentSha256,
  cutoverCompletedAt,
  decodeValue,
  migrationBatchRows,
  quoteIdentifier,
} from "../../../packages/platform-core/src/data-migration.js";
import { schemaVersion } from "../../../packages/platform-core/src/schema-migrations.js";

/**
 * Slice 16: idempotent, batched import into the tenant's Durable Object, shared by `POST /_ops/import`, the verify and
 * export routes and the Node-side import. The target schema is the source of truth: a table or column the target does
 * not have is refused, never created.
 *
 * D1/D3: an import first checks that the schema is at the version the release expects, and that the one-way cutover flag
 * is not set. Both checks run before any write, so a refusal creates and writes nothing.
 */
export type ImportRefusalCode =
  | "UNKNOWN_TABLE"
  | "UNKNOWN_COLUMN"
  | "NO_PRIMARY_KEY"
  | "MALFORMED_ROW"
  | "BATCH_REJECTED"
  | "SCHEMA_NOT_READY"
  | "CUTOVER_COMPLETE";

/**
 * Refuses unless the schema is exactly `requiredVersion`. The import never runs migrations itself: a missing or older
 * schema is a deployment fault to fix by migrating, not something an import should repair (D3).
 */
export function assertSchemaCurrent(database: SqlDatabase, requiredVersion: number): void {
  if (schemaVersion(database) !== requiredVersion) {
    throw new ImportRefusedError("SCHEMA_NOT_READY", "The schema is not at the version this release expects, so nothing was written; run the migrations first");
  }
}

/**
 * Refuses once the one-way cutover flag is set (D1). Nothing in this module or in the import routes clears it.
 */
export function assertMigrationOpen(database: SqlDatabase): void {
  if (cutoverCompletedAt(database) !== null) {
    throw new ImportRefusedError("CUTOVER_COMPLETE", "The cutover is complete, so this object no longer accepts migration imports");
  }
}

/** Both checks, in order: schema first, then the cutover flag. */
export function assertImportAllowed(database: SqlDatabase, requiredVersion: number): void {
  assertSchemaCurrent(database, requiredVersion);
  assertMigrationOpen(database);
}

/** Messages name tables, columns and row positions only, never row values (ADR 0075). */
export class ImportRefusedError extends Error {
  readonly code: ImportRefusalCode;

  constructor(code: ImportRefusalCode, message: string) {
    super(message);
    this.name = "ImportRefusedError";
    this.code = code;
  }
}

export interface ImportBatchResult {
  readonly table: string;
  readonly received: number;
  /** How many statements the batch was split into. */
  readonly statements: number;
  /** The largest number of parameters bound by any one statement. */
  readonly maxParameters: number;
}

interface TableShape {
  readonly columns: readonly string[];
  readonly primaryKey: readonly string[];
}

function tableShape(database: SqlDatabase, table: string): TableShape {
  if (!applicationTableNames(database).includes(table)) {
    throw new ImportRefusedError("UNKNOWN_TABLE", "The table is not part of this deployment's schema");
  }
  const info = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  const columns = info.map((column) => String(column.name));
  const primaryKey = info
    .filter((column) => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((column) => String(column.name));
  if (primaryKey.length === 0) {
    throw new ImportRefusedError("NO_PRIMARY_KEY", "A table without a primary key cannot be imported idempotently");
  }
  return { columns, primaryKey };
}

function preparedRow(raw: unknown, shape: TableShape, position: number): Record<string, SqlValue> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ImportRefusedError("MALFORMED_ROW", `Row ${position + 1} is not a JSON object`);
  }
  const values: Record<string, SqlValue> = {};
  for (const [column, value] of Object.entries(raw)) {
    if (!shape.columns.includes(column)) {
      throw new ImportRefusedError("UNKNOWN_COLUMN", `Row ${position + 1} has a column that is not in the table`);
    }
    try {
      values[column] = decodeValue(value);
    } catch {
      throw new ImportRefusedError("MALFORMED_ROW", `Row ${position + 1} has a value that cannot be imported`);
    }
  }
  for (const column of shape.primaryKey) {
    if (values[column] === undefined || values[column] === null) {
      throw new ImportRefusedError("MALFORMED_ROW", `Row ${position + 1} is missing its primary key`);
    }
  }
  return values;
}

/**
 * One multi-row INSERT. Each row is upserted on its primary key, so importing the same row again changes nothing
 * new. A table whose every column is part of the key has nothing to update, so it does nothing on a repeat.
 */
function insertStatement(table: string, columns: readonly string[], primaryKey: readonly string[], rowCount: number): string {
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const updates = columns
    .filter((column) => !primaryKey.includes(column))
    .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`);
  const conflict = updates.length === 0 ? "DO NOTHING" : `DO UPDATE SET ${updates.join(", ")}`;
  return [
    `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})`,
    `VALUES ${Array.from({ length: rowCount }, () => tuple).join(", ")}`,
    `ON CONFLICT (${primaryKey.map(quoteIdentifier).join(", ")}) ${conflict}`,
  ].join(" ");
}

/**
 * Imports one batch in a single transaction. Rows are validated before anything is written, and a statement that
 * fails (for example a missing NOT NULL value) rolls back the whole batch, so nothing from it is kept.
 */
export function importBatch(database: SqlDatabase, table: string, rows: readonly unknown[], requiredVersion: number): ImportBatchResult {
  assertImportAllowed(database, requiredVersion);
  const shape = tableShape(database, table);
  const prepared = rows.map((raw, position) => preparedRow(raw, shape, position));

  // Rows that bind the same columns share statements, and each statement stays within the parameter limit.
  const groups = new Map<string, Record<string, SqlValue>[]>();
  for (const row of prepared) {
    const columns = shape.columns.filter((column) => Object.hasOwn(row, column));
    const signature = columns.join("\u001f");
    const group = groups.get(signature) ?? [];
    group.push(row);
    groups.set(signature, group);
  }

  const statements: Array<{ readonly sql: string; readonly params: SqlValue[] }> = [];
  for (const [signature, group] of groups) {
    const columns = signature === "" ? [] : signature.split("\u001f");
    if (columns.length === 0 || columns.length > MAX_STATEMENT_PARAMETERS) {
      throw new ImportRefusedError("MALFORMED_ROW", "A row has no usable columns");
    }
    const rowsPerStatement = migrationBatchRows(columns.length);
    for (let start = 0; start < group.length; start += rowsPerStatement) {
      const chunk = group.slice(start, start + rowsPerStatement);
      statements.push({
        sql: insertStatement(table, columns, shape.primaryKey, chunk.length),
        params: chunk.flatMap((row) => columns.map((column) => row[column] as SqlValue)),
      });
    }
  }

  try {
    database.transaction(() => {
      for (const statement of statements) database.prepare(statement.sql).run(statement.params);
    });
  } catch {
    // The reason is not returned: a constraint message could echo a value from the batch.
    throw new ImportRefusedError("BATCH_REJECTED", "The batch was rejected and nothing from it was written");
  }

  return {
    table,
    received: rows.length,
    statements: statements.length,
    maxParameters: statements.reduce((largest, statement) => Math.max(largest, statement.params.length), 0),
  };
}

/** The canonical content and checksum of one table, for the reverse export (rollback). */
export async function exportTable(database: SqlDatabase, table: string): Promise<{ table: string; rowCount: number; sha256: string; content: string }> {
  if (!applicationTableNames(database).includes(table)) {
    throw new ImportRefusedError("UNKNOWN_TABLE", "The table is not part of this deployment's schema");
  }
  const rows: SqlRow[] = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  const { content, rowCount } = canonicalTableContent(rows);
  return { table, rowCount, sha256: await contentSha256(content), content };
}

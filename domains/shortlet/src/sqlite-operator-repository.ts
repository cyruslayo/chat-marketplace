import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { OperatorConflictError, validateOperatorRecord, type OperatorRecord, type OperatorRepository } from "./operator.js";

function readOperator(row: SqlRow): OperatorRecord {
  if (typeof row.operator_json !== "string") throw new TypeError("Stored Operator must be JSON text");
  const value: unknown = JSON.parse(row.operator_json);
  return validateOperatorRecord(value);
}

export class SqliteOperatorRepository implements OperatorRepository {
  readonly #clock: () => Date;
  constructor(private readonly database: SqlDatabase, options: { readonly clock?: () => Date } = {}) {
    this.#clock = options.clock ?? (() => new Date());
    database.exec("CREATE TABLE IF NOT EXISTS operators (id TEXT PRIMARY KEY, operator_json TEXT NOT NULL)");
  }
  create(operator: OperatorRecord): OperatorRecord {
    const candidate = validateOperatorRecord(operator);
    return this.database.transaction(() => {
      if (this.findById(candidate.id)) throw new OperatorConflictError(`Operator ${candidate.id} already exists`);
      this.database.prepare("INSERT INTO operators (id, operator_json) VALUES ($id, $json)").run({ $id: candidate.id, $json: JSON.stringify(candidate) });
      return structuredClone(candidate);
    });
  }
  findAll(): OperatorRecord[] { return this.database.prepare("SELECT operator_json FROM operators ORDER BY rowid").all().map(readOperator); }
  findById(id: string): OperatorRecord | null {
    const row = this.database.prepare("SELECT operator_json FROM operators WHERE id = $id").get({ $id: id });
    return row ? readOperator(row) : null;
  }
  update(id: string, metadata: { readonly name?: string }): OperatorRecord {
    return this.database.transaction(() => {
      const current = this.findById(id);
      if (!current) throw new Error(`Operator ${id} was not found`);
      const now = this.#clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Operator update clock is invalid");
      const updated = validateOperatorRecord({ ...current, name: metadata.name ?? current.name, updatedAt: now.toISOString() });
      this.database.prepare("UPDATE operators SET operator_json = $json WHERE id = $id").run({ $id: id, $json: JSON.stringify(updated) });
      return updated;
    });
  }
}

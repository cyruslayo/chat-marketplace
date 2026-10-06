import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { UnitRepository, parseUnitRecord, type Unit, type UnitSaveInput, type UnitRepositoryContract } from "./browse.js";

function readUnit(row: SqlRow): Unit {
  if (typeof row.unit_json !== "string") throw new TypeError("Stored Unit must be JSON text");
  const value: unknown = JSON.parse(row.unit_json);
  return parseUnitRecord(value, "Stored Unit");
}

export class SqliteUnitRepository implements UnitRepositoryContract {
  constructor(private readonly database: SqlDatabase) {
    database.exec("CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, unit_json TEXT NOT NULL)");
  }
  save(unit: UnitSaveInput): void {
    this.database.transaction(() => {
      // Reuse canonical partial-save validation/normalization; retain raw evidence dates (ADRs 0009/0056).
      const staged = new UnitRepository();
      const current = unit.id ? this.findById(unit.id) : null;
      if (current) staged.save(current);
      staged.save(unit);
      const normalized = staged.findAll()[0]!;
      // Match JSON repository ordering: a save moves the Unit to the end, atomically.
      this.database.prepare("DELETE FROM units WHERE id = $id").run({ $id: normalized.id });
      this.database.prepare("INSERT INTO units (id, unit_json) VALUES ($id, $json)")
        .run({ $id: normalized.id, $json: JSON.stringify(normalized) });
    });
  }
  findAll(): Unit[] { return this.database.prepare("SELECT unit_json FROM units ORDER BY rowid").all().map(readUnit); }
  findById(id: string): Unit | null {
    const row = this.database.prepare("SELECT unit_json FROM units WHERE id = $id").get({ $id: id });
    return row ? readUnit(row) : null;
  }
}

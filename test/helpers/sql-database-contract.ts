import type { SqlDatabase } from "../../packages/platform-core/src/sql-database.js";

export type TestRegistrar = (name: string, run: () => void | Promise<void>) => void;

export function runSqlDatabaseContract(name: string, open: () => SqlDatabase, register: TestRegistrar): void {
  register(`${name}: named parameters and literal parameter-like text`, () => {
    const database = open();
    try {
      const row = database.prepare("SELECT $value AS value, '$x' AS literal").get({ $value: "bound" });
      assert(row?.value === "bound", "named parameter was not returned");
      assert(row.literal === "$x", "parameter-like text inside a string literal was changed");
    } finally {
      database.close();
    }
  });

  register(`${name}: get, all, and run changes`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_rows (id INTEGER PRIMARY KEY, value TEXT)");
      const insert = database.prepare("INSERT INTO contract_rows (id, value) VALUES ($id, $value)");
      assert(insert.run({ $id: 1, $value: "first" }).changes === 1, "insert changes should be one");
      assert(insert.run({ $id: 2, $value: "second" }).changes === 1, "second insert changes should be one");
      assert(database.prepare("SELECT value FROM contract_rows WHERE id = $id").get({ $id: 1 })?.value === "first", "get did not return the row");
      assert(database.prepare("SELECT value FROM contract_rows ORDER BY id").all().length === 2, "all did not return both rows");
      assert(database.prepare("UPDATE contract_rows SET value = $value WHERE id = $id").run({ $value: "updated", $id: 2 }).changes === 1, "update changes should be one");
      assert(database.prepare("UPDATE contract_rows SET value = $value WHERE id = $id").run({ $value: "missing", $id: 99 }).changes === 0, "unmatched update changes should be zero");
    } finally {
      database.close();
    }
  });

  register(`${name}: BLOB round trip as Uint8Array`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_blobs (id INTEGER PRIMARY KEY, value BLOB)");
      const bytes = new Uint8Array([0, 1, 127, 255]);
      database.prepare("INSERT INTO contract_blobs (id, value) VALUES ($id, $value)").run({ $id: 1, $value: bytes });
      const value = database.prepare("SELECT value FROM contract_blobs WHERE id = $id").get({ $id: 1 })?.value;
      assert(value instanceof Uint8Array, "BLOB should be returned as Uint8Array");
      assert(value.length === bytes.length && bytes.every((byte, index) => value[index] === byte), "BLOB bytes did not round trip");
    } finally {
      database.close();
    }
  });

  register(`${name}: rollback on throw`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_rollback (id INTEGER PRIMARY KEY)");
      let threw = false;
      try {
        database.transaction(() => {
          database.prepare("INSERT INTO contract_rollback (id) VALUES ($id)").run({ $id: 1 });
          throw new Error("rollback sentinel");
        });
      } catch (error) {
        threw = error instanceof Error && error.message === "rollback sentinel";
      }
      assert(threw, "transaction should rethrow the callback error");
      assert(database.prepare("SELECT id FROM contract_rollback").all().length === 0, "rolled-back row remained visible");
    } finally {
      database.close();
    }
  });

  register(`${name}: nested transactions preserve savepoint rollback boundaries`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_nested (id INTEGER PRIMARY KEY)");
      try {
        database.transaction(() => {
          database.prepare("INSERT INTO contract_nested (id) VALUES ($id)").run({ $id: 1 });
          database.transaction(() => {
            database.prepare("INSERT INTO contract_nested (id) VALUES ($id)").run({ $id: 2 });
          });
          throw new Error("outer rollback sentinel");
        });
      } catch (error) {
        assert(error instanceof Error && error.message === "outer rollback sentinel", "outer callback error was not rethrown");
      }
      assert(database.prepare("SELECT id FROM contract_nested").all().length === 0, "outer rollback left successful nested work visible");

      database.transaction(() => {
        database.prepare("INSERT INTO contract_nested (id) VALUES ($id)").run({ $id: 3 });
        try {
          database.transaction(() => {
            database.prepare("INSERT INTO contract_nested (id) VALUES ($id)").run({ $id: 4 });
            throw new Error("nested rollback sentinel");
          });
        } catch (error) {
          assert(error instanceof Error && error.message === "nested rollback sentinel", "nested callback error was not rethrown");
        }
        database.prepare("INSERT INTO contract_nested (id) VALUES ($id)").run({ $id: 5 });
      });
      const rows = database.prepare("SELECT id FROM contract_nested ORDER BY id").all();
      assert(rows.length === 2 && rows[0]?.id === 3 && rows[1]?.id === 5, "nested rollback boundary did not match Durable Object SQL");
    } finally {
      database.close();
    }
  });

  register(`${name}: reject a thenable-returning transaction callback and roll back`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_thenable (id INTEGER PRIMARY KEY)");
      let threw = false;
      try {
        database.transaction(() => {
          database.prepare("INSERT INTO contract_thenable (id) VALUES ($id)").run({ $id: 1 });
          return Promise.resolve("not synchronous");
        });
      } catch (error) {
        threw = error instanceof TypeError && error.message.includes("synchronous");
      }
      assert(threw, "thenable-returning callback should throw");
      assert(database.prepare("SELECT id FROM contract_thenable").all().length === 0, "thenable transaction did not roll back");
    } finally {
      database.close();
    }
  });

  register(`${name}: exec accepts multiple statements`, () => {
    const database = open();
    try {
      database.exec("CREATE TABLE contract_multi (id INTEGER PRIMARY KEY); CREATE INDEX contract_multi_idx ON contract_multi (id)");
      assert(database.prepare("SELECT name FROM sqlite_master WHERE name = $name").get({ $name: "contract_multi_idx" }) !== undefined, "second statement was not executed");
    } finally {
      database.close();
    }
  });

  register(`${name}: competing read-then-write transactions allow one hold`, async () => {
    const first = open();
    const second = open();
    try {
      first.exec("CREATE TABLE contract_holds (unit_id TEXT PRIMARY KEY, holder TEXT NOT NULL)");
      const attempt = (database: SqlDatabase, holder: string): Promise<boolean> => Promise.resolve().then(() => {
        try {
          return database.transaction(() => {
            const current = database.prepare("SELECT holder FROM contract_holds WHERE unit_id = $unit").get({ $unit: "unit-1" });
            if (current !== undefined) throw new Error("unit already held");
            database.prepare("INSERT INTO contract_holds (unit_id, holder) VALUES ($unit, $holder)").run({ $unit: "unit-1", $holder: holder });
            return true;
          });
        } catch {
          return false;
        }
      });

      const outcomes = await Promise.all([attempt(first, "first"), attempt(second, "second")]);
      assert(outcomes.filter(Boolean).length === 1, "exactly one competing hold should succeed");
      const winner = first.prepare("SELECT holder FROM contract_holds WHERE unit_id = $unit").get({ $unit: "unit-1" })?.holder;
      assert(winner === "first" || winner === "second", "winning hold should be visible");
      const loser = winner === "first" ? "second" : "first";
      assert(first.prepare("SELECT holder FROM contract_holds WHERE holder = $holder").get({ $holder: loser }) === undefined, "losing transaction write should not be visible");
    } finally {
      first.close();
      second.close();
    }
  });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

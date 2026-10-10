import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { SqlDatabase, SqlParams, SqlValue } from "../packages/platform-core/src/sql-database.js";
import { runSqlDatabaseContract } from "./helpers/sql-database-contract.js";

function withDatabase(run: (database: NodeSqliteDatabase) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "sql-database-contract-"));
  const database = new NodeSqliteDatabase(join(directory, "nested", "database.sqlite"));
  try {
    run(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("AC1: The port types compile with no any and no as casts", () => {
  withDatabase((database) => {
    const typedDatabase: SqlDatabase = database;
    const params: SqlParams = { $value: "typed" };
    const value: SqlValue | undefined = typedDatabase.prepare("SELECT $value AS value").get(params)?.value;
    assert.equal(value, "typed");
  });
});

test("AC2: NodeSqliteDatabase passes every SQL database contract case", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "sql-database-contract-suite-"));
  try {
    const contractTests: Promise<void>[] = [];
    runSqlDatabaseContract("NodeSqliteDatabase", () => new NodeSqliteDatabase(join(directory, "contract.sqlite")), (name, run) => {
      contractTests.push(context.test(name, run));
    });
    await Promise.all(contractTests);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC3: A transaction callback that returns a Promise is rolled back and throws", () => {
  withDatabase((database) => {
    database.exec("CREATE TABLE promise_guard (id INTEGER PRIMARY KEY)");
    assert.throws(() => database.transaction(() => {
      database.prepare("INSERT INTO promise_guard (id) VALUES (1)").run();
      return Promise.resolve();
    }), /must be synchronous/);
    assert.equal(database.prepare("SELECT id FROM promise_guard").all().length, 0);
  });
});

test("AC4: The Node adapter alone imports node:sqlite and the port imports no node modules", () => {
  const adapter = readFileSync(new URL("../packages/platform-core/src/node-sqlite-database.ts", import.meta.url), "utf8");
  const port = readFileSync(new URL("../packages/platform-core/src/sql-database.ts", import.meta.url), "utf8");
  assert.match(adapter, /from ["']node:sqlite["']/);
  assert.doesNotMatch(port, /from ["']node:/);
});

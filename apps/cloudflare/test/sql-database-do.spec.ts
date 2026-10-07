import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { runSqlDatabaseContract } from "../../../test/helpers/sql-database-contract.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";

let storage: DurableObjectStorage;
runSqlDatabaseContract("DurableObjectSqlDatabase", () => new DurableObjectSqlDatabase(storage), (name, run) => {
  test(`AC1: ${name}`, async () => {
    const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName(name));
    await runInDurableObject(stub, async (_instance, ctx) => {
      storage = ctx.storage;
      await run();
    });
  });
});

async function withDatabase(run: (database: DurableObjectSqlDatabase, storage: DurableObjectStorage) => void): Promise<void> {
  const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName(crypto.randomUUID()));
  await runInDurableObject(stub, (_instance, ctx) => run(new DurableObjectSqlDatabase(ctx.storage), ctx.storage));
}

test("AC3: A transaction that throws rolls back fully and competing holds allow only one writer", async () => {
  const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName("dedicated-rollback-and-hold"));
  await runInDurableObject(stub, async (_instance, ctx) => {
    const checks: (() => void | Promise<void>)[] = [];
    runSqlDatabaseContract("AC3", () => new DurableObjectSqlDatabase(ctx.storage), (name, run) => {
      if (name.endsWith("rollback on throw") || name.endsWith("competing read-then-write transactions allow one hold")) checks.push(run);
    });
    expect(checks).toHaveLength(2);
    for (const check of checks) await check();
  });
});

test("AC2: Named parameters inside literals, identifiers and comments are not translated; unbound names throw", async () => {
  await withDatabase((database) => {
    expect(database.prepare(`SELECT '$notparam' AS "$identifier", '$it''s' AS escaped, $value AS value /* $comment */ -- $line\n`).get({ $value: "bound" })).toEqual({ $identifier: "$notparam", escaped: "$it's", value: "bound" });
    expect(database.prepare("SELECT $x AS first, $x AS again").get({ $x: 2 })).toEqual({ first: 2, again: 2 });
    expect(() => database.prepare("SELECT $missing").get({})).toThrow(/Unbound SQL parameter/);
    expect(() => database.prepare("SELECT $missing").get()).toThrow(/Unbound SQL parameter/);
    expect(() => database.prepare("SELECT $toString").get({})).toThrow(/Unbound SQL parameter/);
  });
});

test("AC4: More than 100 bound parameters or a value over 2 MiB is refused before execution", async () => {
  await withDatabase((database, storage) => {
    database.exec("CREATE TABLE limits (value BLOB)");
    const before = storage.sql.exec("SELECT COUNT(*) AS count FROM limits").one();
    const parameters = Array.from({ length: 101 }, () => 0);
    expect(() => database.prepare(`SELECT ${parameters.map(() => "?").join(",")}`).get(parameters)).toThrow(/100/);
    expect(() => database.prepare("INSERT INTO limits VALUES (?)").run([new Uint8Array(2 * 1024 * 1024 + 1)])).toThrow(/2 MiB/);
    expect(() => database.prepare("INSERT INTO limits VALUES (?)").run(["é".repeat(1024 * 1024 + 1)])).toThrow(/2 MiB/);
    expect(storage.sql.exec("SELECT COUNT(*) AS count FROM limits").one()).toEqual(before);
    expect(database.prepare(`SELECT ${parameters.slice(1).map((_, i) => `? AS c${i}`).join(",")}`).get(parameters.slice(1))?.c99).toBe(0);
    database.prepare("INSERT INTO limits VALUES (?)").run([new Uint8Array(2 * 1024 * 1024)]);
  });
});

test("AC5: Adapter remains Worker-compatible and does not own storage", async () => {
  await withDatabase((database) => {
    database.close();
    expect(database.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
  });
});

test("Trigger writes do not inflate run changes; known unsupported PRAGMAs are no-ops", async () => {
  await withDatabase((database) => {
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE TABLE counter (id INTEGER PRIMARY KEY); CREATE TABLE changes_audit (id INTEGER); CREATE TRIGGER changes_trigger AFTER INSERT ON counter BEGIN INSERT INTO changes_audit VALUES (NEW.id); END;");
    expect(database.prepare("INSERT INTO counter VALUES (?)").run([1]).changes).toBe(1);
    expect(database.prepare("INSERT OR IGNORE INTO counter VALUES (?)").run([1]).changes).toBe(0);
    expect(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(() => database.exec("PRAGMA made_up_pragma = 1")).toThrow();
  });
});

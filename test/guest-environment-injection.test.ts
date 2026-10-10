import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { UnitRepository } from "../domains/shortlet/src/index.js";

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "guest-injection-"));
  return { directory, missing: join(directory, "must-not-exist"), [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) };
}

function inMemoryDependencies(seedDemoUnits = false) {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  return { database, unitRepository: new UnitRepository(), seedDemoUnits };
}

test("04a AC1: Constructed with injected deps, the environment does no filesystem access", async () => {
  await using paths = await scratch();
  const config = { databasePath: join(paths.missing, "guest.sqlite"), inventoryPath: join(paths.missing, "inventory.json") };
  const environment = new LocalGuestEnvironment(config, inMemoryDependencies());
  assert.equal(existsSync(paths.missing), false, "the constructor created a directory or file");
  environment.close();
  // Failure path: the Node composition, given the same paths, is what touches the filesystem.
  const node = LocalGuestEnvironment.openNode({ databasePath: join(paths.missing, "guest.sqlite") });
  try {
    assert.equal(existsSync(paths.missing), true);
  } finally {
    node.close();
  }
});

test("04a AC1: injected database and unit repository are the ones the environment uses", () => {
  const dependencies = inMemoryDependencies(true);
  const environment = new LocalGuestEnvironment({ databasePath: "never-opened.sqlite" }, dependencies);
  try {
    assert.equal(environment.database, dependencies.database);
    assert.equal(environment.unitRepository, dependencies.unitRepository);
    assert.ok(dependencies.unitRepository.findAll().length > 0, "seedDemoUnits seeds the injected repository");
    const withoutSeed = inMemoryDependencies(false);
    const quiet = new LocalGuestEnvironment({ databasePath: "never-opened.sqlite" }, withoutSeed);
    assert.deepEqual(withoutSeed.unitRepository.findAll(), []);
    quiet.close();
  } finally {
    environment.close();
  }
});

test("04a AC2: close() on an environment built with an injected database leaves that database usable", () => {
  const dependencies = inMemoryDependencies();
  const environment = new LocalGuestEnvironment({ databasePath: "never-opened.sqlite" }, dependencies);
  environment.close();
  environment.close();
  assert.deepEqual(dependencies.database.prepare("SELECT 1 AS one").get(), { one: 1 });
  dependencies.database.close();
});

test("04a AC3: close() on a factory-built environment closes its own database", async () => {
  await using paths = await scratch();
  const environment = LocalGuestEnvironment.openNode({ databasePath: join(paths.directory, "guest.sqlite") });
  const database = environment.database;
  assert.deepEqual(database.prepare("SELECT 1 AS one").get(), { one: 1 });
  environment.close();
  assert.throws(() => database.prepare("SELECT 1"), /not open/i);
  environment.close();
});

test("04a AC3: a factory-built environment whose construction fails releases its handle", async () => {
  await using paths = await scratch();
  const databasePath = join(paths.directory, "guest.sqlite");
  assert.throws(() => LocalGuestEnvironment.openNode({ databasePath, production: true }), /requires Paystack/);
  // An open handle would keep the file locked on Windows.
  rmSync(databasePath);
  assert.equal(existsSync(databasePath), false);
});

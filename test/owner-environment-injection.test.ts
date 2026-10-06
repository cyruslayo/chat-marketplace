import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { JsonOperatorRepository, UnitRepository } from "../domains/shortlet/src/index.js";

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "owner-injection-"));
  return { directory, missing: join(directory, "must-not-exist"), [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) };
}

function inMemoryDependencies() {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  return { database, unitRepository: new UnitRepository(), operatorRepository: null };
}

test("04b AC1: Constructed with injected deps, the environment does no filesystem access", async () => {
  await using paths = await scratch();
  const config = {
    databasePath: join(paths.missing, "owner.sqlite"),
    inventoryPath: join(paths.missing, "inventory.json"),
    operatorsPath: join(paths.missing, "operators.json"),
  };
  const environment = new LocalApartmentOwnerEnvironment({ ...config, seedFixture: false }, inMemoryDependencies());
  assert.equal(existsSync(paths.missing), false, "the constructor created a directory or file");
  environment.close();
  // Failure path: the Node composition, given the same paths, is what touches the filesystem.
  const node = LocalApartmentOwnerEnvironment.openNode(config);
  try {
    assert.equal(existsSync(paths.missing), true);
  } finally {
    node.close();
  }
});

test("04b AC1: the injected database and repositories are the ones the environment uses", async () => {
  await using paths = await scratch();
  const operatorRepository = new JsonOperatorRepository(join(paths.directory, "operators.json"));
  const dependencies = { ...inMemoryDependencies(), operatorRepository };
  const environment = new LocalApartmentOwnerEnvironment({ seedFixture: false }, dependencies);
  try {
    assert.equal(environment.database, dependencies.database);
    assert.equal(environment.unitRepository, dependencies.unitRepository);
    assert.equal(environment.operatorRepository, operatorRepository);
  } finally {
    environment.close();
  }
});

test("04b AC2: close() leaves an injected database open", () => {
  const dependencies = inMemoryDependencies();
  const environment = new LocalApartmentOwnerEnvironment({ seedFixture: false }, dependencies);
  environment.close();
  environment.close();
  assert.deepEqual(dependencies.database.prepare("SELECT 1 AS one").get(), { one: 1 });
  dependencies.database.close();
});

test("04b AC3: A factory-built environment owns and closes its database", async () => {
  await using paths = await scratch();
  const environment = LocalApartmentOwnerEnvironment.openNode({ databasePath: join(paths.directory, "owner.sqlite"), seedFixture: false });
  const database = environment.database;
  assert.deepEqual(database.prepare("SELECT 1 AS one").get(), { one: 1 });
  environment.close();
  assert.throws(() => database.prepare("SELECT 1"), /not open/i);
  environment.close();
});

test("04b AC3: a factory-built environment whose construction fails releases its handle", async () => {
  await using paths = await scratch();
  const databasePath = join(paths.directory, "owner.sqlite");
  // An operator directory whose parent is a file makes construction throw after the handle is open.
  const blocker = join(paths.directory, "blocker");
  writeFileSync(blocker, "not a directory", "utf8");
  const operatorsPath = join(blocker, "operators.json");
  assert.throws(() => LocalApartmentOwnerEnvironment.openNode({ databasePath, operatorsPath, seedFixture: false }));
  // An open handle would keep the file locked on Windows.
  rmSync(databasePath);
  assert.equal(existsSync(databasePath), false);
});

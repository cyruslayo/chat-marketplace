import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { InMemoryAuditLog, InMemoryTelemetry } from "../packages/platform-core/src/index.js";
import { JsonUnitRepository, UnitDiscoveryQuery, seedIssue01Units } from "../domains/shortlet/src/browse.js";
import { JsonOperatorRepository, OperatorConflictError, bootstrapOperatorsFromUnitRepository, createProvisionedOperator } from "../domains/shortlet/src/operator.js";
import { importInventoryCsv } from "../domains/shortlet/src/inventory-import.js";
import { SqliteUnitRepository } from "../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteOperatorRepository } from "../domains/shortlet/src/sqlite-operator-repository.js";
import { checkUnitRepositoryContract } from "./helpers/unit-repository-contract.js";

const now = new Date("2026-07-22T00:00:00Z");
test("05b AC1: SqliteUnitRepository passes the same behaviour tests as the JSON repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-repositories-"));
  const db = openNodeSqliteDatabase(":memory:");
  try {
    checkUnitRepositoryContract(new JsonUnitRepository(join(dir, "units.json")));
    checkUnitRepositoryContract(new SqliteUnitRepository(db));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("05b AC2: Advancing the clock past inspection expiry removes a loaded unit from discovery without reload", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const repository = new SqliteUnitRepository(db);
    seedIssue01Units(repository);
    const unit = repository.findById("unit-lagos-001")!;
    repository.save({ ...unit, inspection: { ...unit.inspection, inspectedAt: "2025-07-23", expiresAt: "2026-07-23" } });
    let clock = now;
    const query = new UnitDiscoveryQuery({ repository, audit: new InMemoryAuditLog(), telemetry: new InMemoryTelemetry(), clock: () => clock });
    assert.equal(query.search({ location: "Lagos" }).facts.results.length, 1);
    clock = new Date("2026-07-24T00:00:00Z");
    assert.equal(query.search({ location: "Lagos" }).facts.results.length, 0);
    assert.equal(repository.findById(unit.id)?.published, true);
  } finally { db.close(); }
});

test("05b AC3: Duplicate operator raises OperatorConflictError and leaves the table unchanged", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const repository = new SqliteOperatorRepository(db, { clock: () => now });
    const operator = createProvisionedOperator({ id: "operator", tenantId: "tenant", name: "Original", now });
    repository.create(operator);
    assert.throws(() => repository.create({ ...operator, name: "Duplicate" }), OperatorConflictError);
    assert.deepEqual(repository.findAll(), [operator]);
    assert.equal(repository.update(operator.id, { name: " Updated " }).name, "Updated");
    assert.throws(() => repository.update("missing", { name: "Name" }), /not found/);
    assert.throws(() => repository.update(operator.id, { name: " " }), /required/);
  } finally { db.close(); }
});

test("05b AC4: CSV import then operator bootstrap gives the same units and operators as the JSON path", () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-csv-parity-"));
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const sqliteUnits = new SqliteUnitRepository(db);
    const jsonUnits = new JsonUnitRepository(join(dir, "units.json"));
    const sqliteOperators = new SqliteOperatorRepository(db);
    const jsonOperators = new JsonOperatorRepository(join(dir, "operators.json"));
    const contents = readFileSync(new URL("../docs/pilot-inventory-template.csv", import.meta.url), "utf8");
    const anchor = new JsonUnitRepository(join(dir, "anchor.json"));
    seedIssue01Units(anchor);
    const operator = { ...anchor.findAll()[0]!.operator, id: "operator-existing-001", tenantId: "tenant", createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const options = { tenantId: "tenant", clock: () => now, operatorResolver: { findById: (id: string) => id === operator.id ? operator : null } };
    const sqliteResult = importInventoryCsv(contents, { ...options, repository: sqliteUnits });
    const jsonResult = importInventoryCsv(contents, { ...options, repository: jsonUnits });
    assert.equal(sqliteResult.inserted, 2);
    assert.deepEqual(sqliteResult, jsonResult);
    assert.deepEqual(sqliteUnits.findAll(), jsonUnits.findAll());
    bootstrapOperatorsFromUnitRepository({ units: sqliteUnits, operators: sqliteOperators, tenantId: "tenant", now });
    bootstrapOperatorsFromUnitRepository({ units: jsonUnits, operators: jsonOperators, tenantId: "tenant", now });
    assert.deepEqual(sqliteOperators.findAll(), jsonOperators.findAll());
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("05b AC5: Unit and operator data survives reopening the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-repository-restart-"));
  const path = join(dir, "repositories.sqlite");
  let db = openNodeSqliteDatabase(path);
  try {
    seedIssue01Units(new SqliteUnitRepository(db));
    const operator = createProvisionedOperator({ id: "operator", tenantId: "tenant", name: "Name", now });
    new SqliteOperatorRepository(db).create(operator);
    const units = new SqliteUnitRepository(db).findAll();
    db.close(); db = openNodeSqliteDatabase(path);
    assert.deepEqual(new SqliteUnitRepository(db).findAll(), units);
    assert.deepEqual(new SqliteOperatorRepository(db).findById(operator.id), operator);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

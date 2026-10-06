import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonUnitRepository, UnitRepository, type UnitRepositoryContract } from "../domains/shortlet/src/index.js";

test("AC1: browse.ts unit repositories contain no any and the project typechecks", () => {
  const inMemory = new UnitRepository();
  const typed: UnitRepositoryContract = inMemory;
  assert.deepEqual(typed.findAll(), []);
});

test("AC2: Both existing unit repository implementations satisfy the interface", () => {
  const directory = mkdtempSync(join(tmpdir(), "unit-repository-contract-"));
  try {
    const inMemory: UnitRepositoryContract = new UnitRepository();
    const json: UnitRepositoryContract = new JsonUnitRepository(join(directory, "inventory.json"));
    assert.deepEqual(inMemory.findAll(), []);
    assert.deepEqual(json.findAll(), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AC3: The JSON repository rejects a malformed inventory file with a clear error when an id is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "unit-repository-malformed-"));
  const inventoryPath = join(directory, "inventory.json");
  try {
    writeFileSync(inventoryPath, JSON.stringify([{ propertyId: "property-1", title: "Missing identifier" }]), "utf8");
    const repository = new JsonUnitRepository(inventoryPath);
    assert.throws(() => repository.findAll(), /Unit repository entry 0 must include a string id/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

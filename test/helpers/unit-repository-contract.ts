import assert from "node:assert/strict";
import { seedIssue01Units, type UnitRepositoryContract } from "../../domains/shortlet/src/browse.js";

/** Shared behaviour, not adapter-specific fixture setup. */
export function checkUnitRepositoryContract(repository: UnitRepositoryContract): void {
  assert.deepEqual(repository.findAll(), []);
  assert.equal(repository.findById("missing"), null);
  assert.throws(() => repository.save({ title: "missing id" }), /id/i);
  assert.throws(() => repository.save({ id: "incomplete" }), /complete/i);
  seedIssue01Units(repository);
  assert.equal(repository.findAll().length, 2);
  const original = repository.findAll()[0]!;
  repository.save({ id: original.id, title: "updated title" });
  assert.equal(repository.findById(original.id)?.title, "updated title");
  assert.equal(repository.findAll().length, 2);
  assert.equal(repository.findAll().at(-1)?.id, original.id);
  const read = repository.findById(original.id)!;
  read.title = "caller mutation";
  read.amenities.push("caller mutation");
  assert.equal(repository.findById(original.id)?.title, "updated title");
  assert.ok(!repository.findById(original.id)?.amenities.includes("caller mutation"));
  assert.throws(() => repository.save({ id: original.id, capacity: "invalid" } as unknown as Parameters<UnitRepositoryContract["save"]>[0]), /valid Unit/);
  assert.equal(repository.findById(original.id)?.capacity, original.capacity);
}

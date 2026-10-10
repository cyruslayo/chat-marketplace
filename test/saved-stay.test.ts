import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  InMemorySavedStayStore,
  SAVED_STAY_LIMIT,
  SavedStayManager,
  SqliteSavedStayStore,
  type SavedStayStore,
} from "../domains/shortlet/src/index.js";
import { InMemoryAuditLog, createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";

const TENANT = "tenant-lagos";

function guest(id: string, tenantId: string | null = TENANT): CommandPrincipal {
  return tenantId === null ? { id, role: "guest" } : { id, role: "guest", tenantId };
}

function save(manager: SavedStayManager, principal: CommandPrincipal, unitId: string) {
  return manager.saveStay(createPlatformCommandEnvelope({ commandName: "favourite.save", principal, payload: { unitId } }));
}

function remove(manager: SavedStayManager, principal: CommandPrincipal, unitId: string) {
  return manager.removeStay(createPlatformCommandEnvelope({ commandName: "favourite.remove", principal, payload: { unitId } }));
}

/** A clock that moves one minute per call, so "newest first" is well defined. */
function steppingClock(start = "2026-10-03T09:00:00.000Z"): () => Date {
  let at = Date.parse(start);
  return () => new Date((at += 60_000));
}

function stores(): Array<{ name: string; store: SavedStayStore; close(): void }> {
  const database = new DatabaseSync(":memory:");
  return [
    { name: "in-memory", store: new InMemorySavedStayStore(), close: () => undefined },
    { name: "sqlite", store: new SqliteSavedStayStore(database), close: () => database.close() },
  ];
}

test("AC1 — Saving and removing a unit work and survive a restart; saving the same unit twice leaves one entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "saved-stay-"));
  const path = join(dir, "guest.sqlite");
  try {
    let database = new DatabaseSync(path);
    let manager = new SavedStayManager({ store: new SqliteSavedStayStore(database), clock: steppingClock() });
    assert.equal(save(manager, guest("ga-1"), "unit-ikoyi-1").outcome, "saved");
    assert.equal(save(manager, guest("ga-1"), "unit-ikoyi-1").outcome, "already_saved");
    save(manager, guest("ga-1"), "unit-lekki-2");
    database.close();

    database = new DatabaseSync(path);
    manager = new SavedStayManager({ store: new SqliteSavedStayStore(database), clock: steppingClock() });
    assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId), ["unit-lekki-2", "unit-ikoyi-1"]);
    assert.equal(remove(manager, guest("ga-1"), "unit-ikoyi-1").removed, true);
    assert.equal(remove(manager, guest("ga-1"), "unit-ikoyi-1").removed, false);
    database.close();

    database = new DatabaseSync(path);
    manager = new SavedStayManager({ store: new SqliteSavedStayStore(database) });
    assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId), ["unit-lekki-2"]);
    database.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — Saving over the cap is refused and the list is unchanged", () => {
  assert.equal(SAVED_STAY_LIMIT, 100);
  for (const { name, store, close } of stores()) {
    try {
      const manager = new SavedStayManager({ store, clock: steppingClock(), maxSavedStays: 2 });
      save(manager, guest("ga-1"), "unit-1");
      save(manager, guest("ga-1"), "unit-2");
      assert.throws(() => save(manager, guest("ga-1"), "unit-3"), /SAVED_STAY_LIMIT_REACHED/, name);
      assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId), ["unit-2", "unit-1"], name);
      // Re-saving something already saved is not a new entry, so it is not refused at the cap.
      assert.equal(save(manager, guest("ga-1"), "unit-1").outcome, "already_saved", name);
    } finally {
      close();
    }
  }
});

test("AC3 — Saves made by a principal before sign-in appear in the account after sign-in, without duplicates", () => {
  for (const { name, store, close } of stores()) {
    try {
      const manager = new SavedStayManager({ store, clock: steppingClock() });
      save(manager, guest("ga-1"), "unit-shared");
      save(manager, guest("guest-device"), "unit-shared");
      save(manager, guest("guest-device"), "unit-device-only");

      const result = manager.moveSavesToOwner({ fromOwnerId: "guest-device", toOwnerId: "ga-1", tenantId: TENANT });

      assert.deepEqual(result, { moved: ["unit-device-only"], alreadySaved: ["unit-shared"], skipped: [] }, name);
      assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId).sort(), ["unit-device-only", "unit-shared"], name);
      assert.deepEqual(manager.listSavedStays("guest-device", TENANT), [], name);
    } finally {
      close();
    }
  }
});

test("AC4 — An account never sees another account's saves; a missing tenant fails closed", () => {
  for (const { name, store, close } of stores()) {
    try {
      const manager = new SavedStayManager({ store, clock: steppingClock() });
      save(manager, guest("ga-1"), "unit-1");
      save(manager, guest("ga-1", "tenant-abuja"), "unit-abuja");

      assert.deepEqual(manager.listSavedStays("ga-2", TENANT), [], name);
      assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId), ["unit-1"], name);
      assert.equal(remove(manager, guest("ga-2"), "unit-1").removed, false, name);
      assert.equal(manager.listSavedStays("ga-1", TENANT).length, 1, name);

      assert.throws(() => save(manager, guest("ga-1", null), "unit-2"), /tenant/i, name);
      assert.throws(() => remove(manager, guest("ga-1", null), "unit-1"), /tenant/i, name);
      assert.throws(() => manager.listSavedStays("ga-1", ""), /tenant/i, name);
      assert.throws(() => manager.moveSavesToOwner({ fromOwnerId: "guest-device", toOwnerId: "ga-1", tenantId: "" }), /tenant/i, name);
      assert.throws(
        () => manager.saveStay(createPlatformCommandEnvelope({ commandName: "favourite.save", principal: { id: "op-1", role: "operator", tenantId: TENANT }, payload: { unitId: "unit-1" } })),
        /Guest/,
        name,
      );
      assert.throws(
        () => manager.saveStay(createPlatformCommandEnvelope({ commandName: "favourite.remove", principal: guest("ga-1"), payload: { unitId: "unit-1" } })),
        /favourite\.save/,
        name,
      );
      assert.throws(() => save(manager, guest("ga-1"), " "), /Unit/, name);
    } finally {
      close();
    }
  }
});

test("AC5 — A sign-in merge that would exceed the cap keeps every account save, adds device saves newest first up to the cap, and reports the rest as skipped", () => {
  for (const { name, store, close } of stores()) {
    try {
      const manager = new SavedStayManager({ store, clock: steppingClock(), maxSavedStays: 3 });
      save(manager, guest("ga-1"), "unit-account-a");
      save(manager, guest("ga-1"), "unit-account-b");
      save(manager, guest("guest-device"), "unit-device-old");
      save(manager, guest("guest-device"), "unit-device-new");

      const result = manager.moveSavesToOwner({ fromOwnerId: "guest-device", toOwnerId: "ga-1", tenantId: TENANT });

      assert.deepEqual(result, { moved: ["unit-device-new"], alreadySaved: [], skipped: ["unit-device-old"] }, name);
      assert.deepEqual(manager.listSavedStays("ga-1", TENANT).map((stay) => stay.unitId).sort(), ["unit-account-a", "unit-account-b", "unit-device-new"], name);
      assert.deepEqual(manager.listSavedStays("guest-device", TENANT), [], name);
    } finally {
      close();
    }
  }
});

test("Saved Stay audit entries carry only safe identifiers", () => {
  const audit = new InMemoryAuditLog();
  const manager = new SavedStayManager({ store: new InMemorySavedStayStore(), clock: steppingClock(), audit });
  save(manager, guest("ga-1"), "unit-1");
  remove(manager, guest("ga-1"), "unit-1");
  manager.moveSavesToOwner({ fromOwnerId: "guest-device", toOwnerId: "ga-1", tenantId: TENANT });
  const entries: Array<Record<string, unknown>> = audit.entries();
  assert.deepEqual(entries.map((entry) => entry.type), ["favourite.saved", "favourite.removed", "favourite.moved"]);
  const allowed = ["type", "ownerId", "fromOwnerId", "toOwnerId", "tenantId", "unitId", "commandId", "moved", "alreadySaved", "skipped", "recordedAt"];
  for (const entry of entries) assert.deepEqual(Object.keys(entry).filter((key) => !allowed.includes(key)), []);
});

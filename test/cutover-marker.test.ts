import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { cutoverCompletedAt } from "../packages/platform-core/src/data-migration.js";
import {
  CUTOVER_MARKER_PREFIX,
  CutoverMarkerUnavailableError,
  completeCutoverWithMarker,
  createCutoverMarkerStore,
  cutoverMarkerKey,
  cutoverStatus,
  reconcileCutover,
  type CutoverMarkerStore,
} from "../apps/cloudflare/src/cutover-marker.js";
import { ImportRefusedError, assertCutoverOpenForImport, importBatch } from "../apps/cloudflare/src/ops-import.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";

/**
 * Issue 16 A (decided by the parent agent, 10 Oct 2026): the cutover flag also lives in a marker in the private EXPORTS
 * bucket, outside the object's storage, so a point-in-time restore cannot clear it. These tests use an in-memory marker
 * store and a migrated Node SQLite file, so the ordering, the fail-closed paths and the restore simulation run without a
 * Worker. The workerd spec (apps/cloudflare/test/data-migration.spec.ts) runs the same routes against real R2.
 */

const OBJECT = "object-under-test";
const AT = "2031-10-10T08:00:00.000Z";
const LATER = "2031-10-11T09:00:00.000Z";

/** An R2-shaped marker store held in memory. `events` records the order of reads and writes. */
function memoryStore(options: { failWrites?: boolean; failReads?: boolean } = {}) {
  const stored = new Map<string, string>();
  const events: string[] = [];
  const store = {
    events,
    stored,
    async read() {
      events.push("read");
      if (options.failReads) throw new CutoverMarkerUnavailableError("read failed");
      const raw = stored.get(cutoverMarkerKey(OBJECT));
      return raw === undefined ? null : { completedAt: (JSON.parse(raw) as { completedAt: string }).completedAt };
    },
    async createIfAbsent(completedAt: string) {
      events.push("marker");
      if (options.failWrites) throw new CutoverMarkerUnavailableError("write failed");
      const key = cutoverMarkerKey(OBJECT);
      if (!stored.has(key)) stored.set(key, JSON.stringify({ completedAt }));
      return { completedAt: (JSON.parse(stored.get(key)!) as { completedAt: string }).completedAt };
    },
  };
  return store satisfies CutoverMarkerStore & { events: string[]; stored: Map<string, string> };
}

async function withMigratedDatabase(run: (database: NodeSqliteDatabase) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "shortlet-cutover-marker-"));
  const database = new NodeSqliteDatabase(join(dir, "object.sqlite"));
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, new Date().toISOString());
    await run(database);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function refusalCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ImportRefusedError ? error.code : `not an import refusal: ${String(error)}`;
  }
}

test("16 A: completing the cutover writes the marker before the database flag, and a second completion keeps the first timestamp", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore();
    const flagAtMarkerWrite: Array<string | null> = [];
    const recording: CutoverMarkerStore = {
      read: () => store.read(),
      createIfAbsent: async (completedAt) => {
        flagAtMarkerWrite.push(cutoverCompletedAt(database));
        return store.createIfAbsent(completedAt);
      },
    };
    const first = await completeCutoverWithMarker(database, recording, AT);
    assert.equal(first, AT);
    assert.deepEqual(flagAtMarkerWrite, [null], "the marker is written while the database flag is still unset");
    assert.equal(cutoverCompletedAt(database), AT);

    const second = await completeCutoverWithMarker(database, recording, LATER);
    assert.equal(second, AT, "a second completion returns the first timestamp, from the marker");
  });
});

test("16 A: a failed marker write leaves the database flag unset and the cutover refused (fail closed)", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore({ failWrites: true });
    await assert.rejects(completeCutoverWithMarker(database, store, AT), CutoverMarkerUnavailableError);
    assert.equal(cutoverCompletedAt(database), null, "no database flag without a marker");
    // Nothing was cut over, so imports stay open: a failed cutover is not a silent partial one.
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), null);
  });
});

test("16 A: a restore that deletes the database flag still refuses import with CUTOVER_COMPLETE, and re-asserts the flag", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore();
    await completeCutoverWithMarker(database, store, AT);
    // A point-in-time restore rewinds the object's storage: simulated by removing the flag row.
    database.prepare("DELETE FROM migration_state").run();
    assert.equal(cutoverCompletedAt(database), null);

    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), "CUTOVER_COMPLETE");
    assert.equal(cutoverCompletedAt(database), AT, "the import path re-asserts the database flag from the marker");
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), "CUTOVER_COMPLETE", "and keeps refusing");
  });
});

test("16 A: an import with the marker binding unavailable fails closed with CUTOVER_MARKER_UNAVAILABLE and writes no row", async () => {
  await withMigratedDatabase(async (database) => {
    const unavailable = createCutoverMarkerStore(undefined, OBJECT);
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, unavailable)), "CUTOVER_MARKER_UNAVAILABLE");
    const rows = database.prepare("SELECT COUNT(*) AS n FROM operators").get();
    assert.equal(Number(rows?.n), 0);
    assert.equal(cutoverCompletedAt(database), null);
  });
});

test("16 A: a marker that cannot be read is refused, never read as not cut over", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore({ failReads: true });
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), "CUTOVER_MARKER_UNAVAILABLE");
    const status = await cutoverStatus(database, store);
    assert.equal(status.marker, "unavailable");
  });
});

test("16 A: a database flag without a marker is repaired from the flag, and the import is then refused", async () => {
  await withMigratedDatabase(async (database) => {
    // Set the flag directly, as a pre-marker object would have it.
    database.prepare("INSERT INTO migration_state (state_key, state_value) VALUES ('cutover_completed_at', $at)").run({ $at: AT });
    const store = memoryStore();
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), "CUTOVER_COMPLETE");
    assert.equal(store.stored.get(cutoverMarkerKey(OBJECT)), JSON.stringify({ completedAt: AT }));
  });
});

test("16 A: the status reports the effective cutover time and the marker state, and an absent marker is not a cutover", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore();
    assert.deepEqual(await cutoverStatus(database, store), { completedAt: null, marker: "absent" });
    await completeCutoverWithMarker(database, store, AT);
    database.prepare("DELETE FROM migration_state").run();
    assert.deepEqual(await cutoverStatus(database, store), { completedAt: AT, marker: "present" });
  });
});

test("16 A: a damaged marker object is refused, not read as absent", async () => {
  await withMigratedDatabase(async (database) => {
    // The real R2 store, over a bucket whose marker object holds damaged bytes.
    const damaged = { get: async () => ({ text: async () => "not json" }), put: async () => null };
    const store = createCutoverMarkerStore(damaged as unknown as Parameters<typeof createCutoverMarkerStore>[0], OBJECT);
    assert.equal(await refusalCode(assertCutoverOpenForImport(database, store)), "CUTOVER_MARKER_UNAVAILABLE");
    assert.equal(cutoverCompletedAt(database), null);
  });
});

test("16 A: the marker key sits under the reserved _ops prefix, which no export day can match", () => {
  const key = cutoverMarkerKey(OBJECT);
  assert.ok(key.startsWith(CUTOVER_MARKER_PREFIX));
  assert.ok(key.startsWith("_ops/"));
  assert.equal(/^\d{4}-\d{2}-\d{2}\//.test(key), false, "the marker is never a dated export object");
});

test("16 A: the R2 marker store creates the marker only when absent, and a failed write is refused", async () => {
  const objects = new Map<string, string>();
  const bucket = {
    get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
    put: async (key: string, body: string, options: { onlyIf?: { etagDoesNotMatch?: string } }) => {
      if (options.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) return null;
      objects.set(key, body);
      return { key };
    },
  };
  const store = createCutoverMarkerStore(bucket as unknown as Parameters<typeof createCutoverMarkerStore>[0], OBJECT);
  assert.equal((await store.createIfAbsent(AT)).completedAt, AT);
  assert.equal((await store.createIfAbsent(LATER)).completedAt, AT, "an existing marker keeps its timestamp");

  const failing = createCutoverMarkerStore({ ...bucket, put: async () => { throw new Error("r2 down"); } } as unknown as Parameters<typeof createCutoverMarkerStore>[0], "other");
  await assert.rejects(failing.createIfAbsent(AT), CutoverMarkerUnavailableError);
});

test("16 A: reconcileCutover with no flag and no marker writes nothing and reports not cut over", async () => {
  await withMigratedDatabase(async (database) => {
    const store = memoryStore();
    assert.equal(await reconcileCutover(database, store), null);
    assert.deepEqual(store.events, ["read"]);
    assert.equal(SHORTLET_SCHEMA_VERSION, SHORTLET_SCHEMA_MIGRATIONS.length);
  });
});

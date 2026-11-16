import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { laneEventFor, laneThreadRecord, readLaneRows } from "./helpers/lane-event-fixtures.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteGuestInteractionStore, parseDurableLaneEvents } from "../domains/shortlet/src/guest-interaction-store.js";
import { COMMERCE_EXPORT_TABLES, PLATFORM_EXPORT_TABLES, SHORTLET_EXPORT_TABLES } from "../apps/cloudflare/src/do-export.js";

// Issue 03e (ADR 0107 decision 11, owner decision O4, ADR 0075, ADR 0096, ADR 0101). The store-level criteria: the write is
// idempotent per event_id, rolls back as a whole, redacts before insert, refuses roles outside the closed set, has one export
// owner, and is never read by application code.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TABLE = "guest_thread_lane_events";

function openStore(databasePath: string) {
  const database = openNodeSqliteDatabase(databasePath);
  return { store: new SqliteGuestInteractionStore(database), close: () => database.close() };
}

test("AC2: Replaying the same event_id with the same content writes no second row; with different content the transaction rolls back and no row is written", () => {
  const path = temporaryDatabasePath("lane-events-ac2.sqlite");
  const { store, close } = openStore(path);
  try {
    const first = laneEventFor({ seq: 1, text: "Two bedrooms in Lekki" });
    store.saveThread(laneThreadRecord("g-lane-ac2", [first], "{\"version\":1,\"step\":\"one\"}"));
    assert.equal(readLaneRows(path, "g-lane-ac2").length, 1, "the first write stores one row");

    // Same event_id (same thread, task and sequence), same content: ignored, no second row, no error.
    store.saveThread(laneThreadRecord("g-lane-ac2", [first], "{\"version\":1,\"step\":\"two\"}"));
    assert.equal(readLaneRows(path, "g-lane-ac2").length, 1, "a replay with the same content writes no second row");

    // A new event and a same event_id with different content in one save: the whole transaction is refused.
    const fresh = laneEventFor({ seq: 2, text: "Shortlet reply" });
    const changed = laneEventFor({ seq: 1, text: "Different text under the same event id" });
    assert.throws(() => store.saveThread(laneThreadRecord("g-lane-ac2", [fresh, changed], "{\"version\":1,\"step\":\"three\"}")));
    const rows = readLaneRows(path, "g-lane-ac2");
    assert.equal(rows.length, 1, "the transaction rolled back: no row for the new event");
    assert.equal(rows[0]?.textRedacted, "Two bedrooms in Lekki", "the stored row keeps its original content");
    assert.equal(store.findThread("g-lane-ac2")?.threadJson, "{\"version\":1,\"step\":\"two\"}", "the thread projection rolled back with the rows");
  } finally {
    close();
  }
});

test("AC4: The table name appears in exactly one of SHORTLET_EXPORT_TABLES, PLATFORM_EXPORT_TABLES and COMMERCE_EXPORT_TABLES, and it is the platform list (O4)", () => {
  const owners = [SHORTLET_EXPORT_TABLES, PLATFORM_EXPORT_TABLES, COMMERCE_EXPORT_TABLES].filter((list) => (list as readonly string[]).includes(TABLE));
  assert.equal(owners.length, 1, "exactly one export list names the lane table");
  assert.equal(owners[0], PLATFORM_EXPORT_TABLES, "the owner is the platform list, beside guest_threads");
});

test("AC6: Only user, assistant and receipt timeline entries are written; a model-text or tool-result payload is refused, not written", () => {
  const path = temporaryDatabasePath("lane-events-ac6.sqlite");
  const { store, close } = openStore(path);
  try {
    assert.ok(parseDurableLaneEvents([laneEventFor({ role: "user" }), laneEventFor({ seq: 2, role: "assistant" }), laneEventFor({ seq: 3, role: "receipt" })]), "the three timeline roles parse");
    for (const role of ["model", "model_text", "tool_result", "a2ui", ""]) {
      assert.equal(parseDurableLaneEvents([laneEventFor({ role: role as unknown as "user" })]), null, `the role "${role}" is refused by the parser`);
    }
    const refused = laneEventFor({ seq: 1, role: "tool_result" as unknown as "user", text: "{\"tool\":\"search_stays\"}" });
    assert.throws(() => store.saveThread(laneThreadRecord("g-lane-ac6", [refused])), "the store refuses the row");
    assert.equal(readLaneRows(path, "g-lane-ac6").length, 0, "no row is written for a refused role");
    assert.equal(store.findThread("g-lane-ac6"), null, "the thread is not saved with a refused row");
  } finally {
    close();
  }
});

test("AC3: A timeline entry containing a synthetic phone number, email and token-shaped string is stored in its redacted form", () => {
  const path = temporaryDatabasePath("lane-events-ac3.sqlite");
  const { store, close } = openStore(path);
  try {
    const text = "Call +234 801 234 5678 or write guest@example.test about the flat, token Bearer abc123.def456-tokenvalue";
    store.saveThread(laneThreadRecord("g-lane-ac3", [laneEventFor({ text })]));
    const [row] = readLaneRows(path, "g-lane-ac3");
    assert.ok(row, "the row is stored");
    assert.equal(row.textRedacted.includes("801 234 5678"), false, "the phone number is not stored");
    assert.equal(row.textRedacted.includes("guest@example.test"), false, "the email address is not stored");
    assert.equal(row.textRedacted.includes("abc123.def456"), false, "the token is not stored");
    assert.ok(row.textRedacted.includes("[REDACTED]"), "the redaction marker is stored");
    assert.equal(store.findThread("g-lane-ac3")?.threadJson, "{\"version\":1}", "the thread projection is not rewritten by lane-row masking");
  } finally {
    close();
  }
});

test("AC7: No code path in apps/ or domains/ reads the table (a grep-based test)", () => {
  const offenders: string[] = [];
  const mentions: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      if (name === "node_modules" || name === "dist" || name === ".cloudflare" || name === "public" || name === "test") continue;
      const full = join(directory, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(name)) continue;
      const source = readFileSync(full, "utf8");
      const file = relative(REPO_ROOT, full).replaceAll("\\", "/");
      if (source.includes(TABLE)) mentions.push(file);
      if (new RegExp(`\\b(FROM|JOIN)\\s+${TABLE}\\b`, "i").test(source)) offenders.push(file);
    }
  };
  walk(join(REPO_ROOT, "apps"));
  walk(join(REPO_ROOT, "domains"));
  assert.deepEqual(offenders, [], "no statement selects from the lane table");
  assert.deepEqual(
    mentions.sort(),
    ["apps/cloudflare/src/do-export.ts", "domains/shortlet/src/guest-interaction-store.ts"],
    "the table name is spelled only in the store (DDL and writer) and the platform export list",
  );
});

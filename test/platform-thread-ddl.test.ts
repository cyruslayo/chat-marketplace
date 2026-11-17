import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { PLATFORM_SCHEMA_MIGRATIONS, PLATFORM_SCHEMA_VERSION, SHORTLET_SCHEMA_MIGRATIONS } from "../apps/cloudflare/src/schema.js";

// Issue 03m (ADR 0101, ADR 0107 decision 11, ADR 0096). The thread-store DDL (guest_threads, guest_thread_lane_events and
// guest_session_bindings) is owned by the platform module, not by the shortlet store. These tests pin that the move changed no
// schema: the platform schema version, the migration lists (hashed on the base commit ccd04f3) and the table shapes.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLATFORM_MODULE = "packages/platform-core/src/thread-schema.ts";

// Hashes of JSON.stringify(list) on the base commit ccd04f3, before the move. A change here is a schema change, not a refactor.
const PLATFORM_MIGRATIONS_SHA256 = "028d0183668adb08c9dc2aa4372c6c65ee2c75184c5778aecb94b1179c4906f0";
const SHORTLET_MIGRATIONS_SHA256 = "0f9f6bc21fb505b388a32f17d1a21887a291c19695680a5cfa8c8fa7def3fb86";

const THREAD_TABLE_DEFINITION = /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(guest_threads|guest_thread_lane_events|guest_session_bindings)\b/i;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Every production source file under apps/, domains/, packages/ and scripts/. Test directories are excluded: the legacy fixtures there
 * build old single-object databases on purpose. */
function productionSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      if (name === "node_modules" || name === "dist" || name === "test" || name === "public" || name.startsWith(".")) continue;
      const full = join(directory, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(relative(REPO_ROOT, full).replaceAll("\\", "/"));
    }
  };
  for (const root of ["apps", "domains", "packages", "scripts"]) walk(join(REPO_ROOT, root));
  return files;
}

test("AC1: No CREATE TABLE for guest_threads, guest_thread_lane_events or guest_session_bindings exists outside the platform module (a grep-based test)", () => {
  const offenders: string[] = [];
  let platformDefinitions = 0;
  for (const file of productionSourceFiles()) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    const matches = source.split(/\r?\n/).filter((line) => THREAD_TABLE_DEFINITION.test(line)).length;
    if (matches === 0) continue;
    if (file === PLATFORM_MODULE) platformDefinitions += matches;
    else offenders.push(file);
  }
  assert.deepEqual(offenders, [], "the thread-store DDL must be defined only in the platform module");
  assert.equal(platformDefinitions, 3, "the platform module defines the three tables once each");
});

test("AC2: PLATFORM_SCHEMA_VERSION stays 5 and the platform migration list is byte-identical to the pinned hash", () => {
  assert.equal(PLATFORM_SCHEMA_VERSION, 5);
  assert.equal(PLATFORM_SCHEMA_MIGRATIONS.length, 5);
  assert.equal(sha256(PLATFORM_SCHEMA_MIGRATIONS), PLATFORM_MIGRATIONS_SHA256);
});

test("AC2: The shortlet migration list is byte-identical to the pinned hash (the shortlet ledger is not touched)", () => {
  assert.equal(sha256(SHORTLET_SCHEMA_MIGRATIONS), SHORTLET_MIGRATIONS_SHA256);
});

test("AC2: A fresh platform object gains guest_threads, guest_thread_lane_events and guest_session_bindings with the pinned columns", () => {
  const database = new NodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, PLATFORM_SCHEMA_MIGRATIONS, "2026-10-27T00:00:00.000Z");
    const columns = (table: string): string[] =>
      database.prepare(`PRAGMA table_info(${table})`).all().map((row) => `${String(row.name)}:${String(row.type)}:${String(row.notnull)}:${String(row.pk)}`);
    assert.deepEqual(columns("guest_threads"), ["thread_id:TEXT:0:1", "principal_id:TEXT:1:0", "tenant_id:TEXT:1:0", "thread_json:TEXT:1:0"]);
    assert.deepEqual(columns("guest_session_bindings"), [
      "session_id:TEXT:0:1",
      "session_secret_hash:TEXT:1:0",
      "principal_id:TEXT:1:0",
      "tenant_id:TEXT:1:0",
    ]);
    assert.deepEqual(columns("guest_thread_lane_events").map((entry) => entry.split(":")[0]), [
      "event_id",
      "thread_id",
      "tenant_id",
      "task_id",
      "domain",
      "seq",
      "role",
      "text_redacted",
      "created_at",
    ]);
  } finally {
    database.close();
  }
});

test("Guard: platform-core imports nothing from domains/ or apps/ (the dependency direction runs one way)", () => {
  const offenders: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.ts$/.test(name)) continue;
      const source = readFileSync(full, "utf8");
      if (/from\s+["'][^"']*(domains|apps)\//.test(source)) offenders.push(relative(REPO_ROOT, full).replaceAll("\\", "/"));
    }
  };
  walk(join(REPO_ROOT, "packages", "platform-core", "src"));
  assert.deepEqual(offenders, []);
});

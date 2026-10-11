import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_ID_PREFIXES_BY_KEY } from "../packages/platform-core/src/redaction.js";
import { AUDIT_LOG_SCHEMA } from "../packages/platform-core/src/sqlite-audit-log.js";
import { TELEMETRY_SCHEMA } from "../packages/platform-core/src/sqlite-telemetry.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { platformIdMaskedRowsSql } from "./helpers/platform-id-fixtures.js";

// ADR 0075 & Issue 50. Rows written before the fix hold masked ids. The detection query must find them for every key in
// the exemption table, in audit_log and telemetry_events, and must not flag clean ids. The label is stored in
// recorded_at so each hit can be compared by name.

const root = fileURLToPath(new URL("..", import.meta.url));
const issuePath = join(root, ".scratch/shortlet-concierge-launch/issues/50-keep-platform-ids-intact-under-card-redaction.md");

function legacyPayloads(): Array<{ label: string; payload: Record<string, unknown>; hit: boolean }> {
  const rows = Object.entries(PLATFORM_ID_PREFIXES_BY_KEY).map(([key, prefixes]) => ({
    label: `legacy-${key}`,
    payload: { type: "legacy.masked", [key]: `${prefixes[0]!}-[REDACTED]-bea8-8d50c54c0c30` },
    hit: true
  }));
  rows.push({
    label: "legacy-threadId-guest",
    payload: { type: "handoff.requested", threadId: "g-[REDACTED]-9c2e-4a1b-8d50-0c54c0c30000" },
    hit: true
  });
  rows.push({
    label: "clean-requestId",
    payload: { type: "booking_request.disclosed", requestId: `req-${randomUUID()}` },
    hit: false
  });
  rows.push({
    label: "masked-outside-table",
    payload: { type: "legacy.masked", unitId: "unit-[REDACTED]-bea8-8d50c54c0c30" },
    hit: false
  });
  rows.push({
    label: "masked-free-text",
    payload: { type: "legacy.masked", note: "card [REDACTED] on file" },
    hit: false
  });
  return rows;
}

function openLegacyDatabase(table: "audit_log" | "telemetry_events") {
  const database = openNodeSqliteDatabase(":memory:");
  database.exec(AUDIT_LOG_SCHEMA);
  database.exec(TELEMETRY_SCHEMA);
  for (const row of legacyPayloads()) {
    const json = JSON.stringify({ ...row.payload, recordedAt: row.label });
    if (table === "audit_log") {
      database.prepare("INSERT INTO audit_log (recorded_at, payload_json) VALUES (?, ?)").run([row.label, json]);
    } else {
      database.prepare("INSERT INTO telemetry_events (transition_key, recorded_at, payload_json) VALUES (?, ?, ?)").run([null, row.label, json]);
    }
  }
  return database;
}

function hitLabels(table: "audit_log" | "telemetry_events"): string[] {
  const database = openLegacyDatabase(table);
  try {
    return database.prepare(platformIdMaskedRowsSql(table)).all().map((row) => String(row.recorded_at)).sort();
  } finally {
    database.close();
  }
}

test("The detection query finds legacy masked rows for every platform-id key in audit_log and telemetry_events, including guest threadId ids", () => {
  const expected = legacyPayloads().filter((row) => row.hit).map((row) => row.label).sort();
  assert.deepEqual(hitLabels("audit_log"), expected);
  assert.deepEqual(hitLabels("telemetry_events"), expected);
  const sql = platformIdMaskedRowsSql("audit_log");
  for (const key of Object.keys(PLATFORM_ID_PREFIXES_BY_KEY)) assert.match(sql, new RegExp(`'\\$\\.${key}'`));
});

test("The detection query returns no rows for clean platform ids, masked free text or masked keys outside the exemption table", () => {
  const hits = new Set([...hitLabels("audit_log"), ...hitLabels("telemetry_events")]);
  assert.ok(!hits.has("clean-requestId"));
  assert.ok(!hits.has("masked-free-text"));
  assert.ok(!hits.has("masked-outside-table"));
});

test("The issue file shows the full detection query for audit_log and telemetry_events, generated from the exemption table", () => {
  const blocks = [...readFileSync(issuePath, "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]!.trim());
  assert.deepEqual(blocks, [
    platformIdMaskedRowsSql("audit_log").trim(),
    platformIdMaskedRowsSql("telemetry_events").trim()
  ]);
});

test("The detection query matches flat, exact-case top-level keys only: a nested or differently cased id is not found (documented limitation)", () => {
  const database = openNodeSqliteDatabase(":memory:");
  database.exec(AUDIT_LOG_SCHEMA);
  try {
    const rows = [
      { label: "nested", payload: { type: "legacy.masked", payload: { requestId: "req-[REDACTED]-bea8-8d50c54c0c30" } } },
      { label: "cased", payload: { type: "legacy.masked", RequestId: "req-[REDACTED]-bea8-8d50c54c0c30" } }
    ];
    for (const row of rows) {
      database.prepare("INSERT INTO audit_log (recorded_at, payload_json) VALUES (?, ?)").run([row.label, JSON.stringify(row.payload)]);
    }
    assert.deepEqual(database.prepare(platformIdMaskedRowsSql("audit_log")).all().map((row) => String(row.recorded_at)), []);
  } finally {
    database.close();
  }
});

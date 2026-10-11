import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_ID_PREFIXES_BY_KEY, redactSensitiveData } from "../packages/platform-core/src/redaction.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import { SqliteAuditLog } from "../packages/platform-core/src/sqlite-audit-log.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";

// ADR 0075 (one redactor for audit, telemetry and projections) & Issue 50.
// Platform-generated correlation ids are `<prefix>-<randomUUID()>`. The card-number rule must not mask them under
// their id keys, but every other card-number shape stays redacted.

// Each pair is an (id key, prefix the generator for that key emits) oracle, written out here on purpose.
const ID_KEY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["requestId", "req"],
  ["commandEnvelopeId", "cmd"],
  ["commandId", "cmd"],
  ["offerId", "offer"],
  ["draftId", "draft"],
  ["threadId", "thread"],
  ["runId", "run"],
  ["surfaceId", "surf"],
  ["actionId", "pa"],
  ["quoteId", "quote"],
  ["aggregateId", "req"],
  ["aggregateId", "offer"],
  ["commitmentId", "blk"],
  ["commitmentId", "oph"],
  ["commitmentId", "brb"],
  ["payoutId", "payout"],
  ["recoveryId", "recovery"],
  ["refundId", "guest-refund"],
  ["queryId", "search"],
  ["runId", "turn"]
];

// Fixed values that the card-number rule masked before this fix (they contain a 16-digit run once the dashes are read as separators).
const KNOWN_CARD_SHAPED_OFFER_ID = "offer-17477973-5806-4004-bea8-8d50c54c0c30";
const KNOWN_CARD_SHAPED_COMMAND_ID = "cmd-63bde504-acc8-40f0-9792-588939387591";
const KNOWN_CARD_SHAPED_REQUEST_ID = "req-63bde504-acc8-40f0-9792-588939387591";
const CARD_NUMBER = "4111111111111111";

function redactOne(key: string, value: unknown): unknown {
  return (redactSensitiveData({ [key]: value }) as Record<string, unknown>)[key];
}

test("Platform-generated ids under their id keys pass through redactSensitiveData unchanged across 20,000 random ids", () => {
  for (let index = 0; index < 20_000; index += 1) {
    const [key, prefix] = ID_KEY_PREFIXES[index % ID_KEY_PREFIXES.length]!;
    const id = `${prefix}-${randomUUID()}`;
    assert.equal(redactOne(key, id), id, `${key}=${id}`);
  }
});

test("Known card-shaped platform ids are kept intact in InMemoryAuditLog entries so they can be matched by requestId and commandEnvelopeId", () => {
  const audit = new InMemoryAuditLog();
  audit.record({ type: "booking_request.disclosed", requestId: KNOWN_CARD_SHAPED_REQUEST_ID, commandEnvelopeId: KNOWN_CARD_SHAPED_COMMAND_ID });
  audit.record({ type: "conditional_offer.issued", offerId: KNOWN_CARD_SHAPED_OFFER_ID, requestId: KNOWN_CARD_SHAPED_REQUEST_ID });
  const [first, second] = audit.entries();
  assert.equal(first?.requestId, KNOWN_CARD_SHAPED_REQUEST_ID);
  assert.equal(first?.commandEnvelopeId, KNOWN_CARD_SHAPED_COMMAND_ID);
  assert.equal(second?.offerId, KNOWN_CARD_SHAPED_OFFER_ID);
  assert.equal(second?.requestId, KNOWN_CARD_SHAPED_REQUEST_ID);
});

test("Platform-generated ids under their id keys are stored unchanged by SqliteAuditLog across 20,000 random ids", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    const audit = new SqliteAuditLog(database);
    const expected: Array<[string, string]> = [];
    for (let index = 0; index < 20_000; index += 1) {
      const [key, prefix] = ID_KEY_PREFIXES[index % ID_KEY_PREFIXES.length]!;
      const id = `${prefix}-${randomUUID()}`;
      expected.push([key, id]);
      audit.record({ type: "audit.platform_id", [key]: id });
    }
    const stored = audit.entries();
    assert.equal(stored.length, expected.length);
    stored.forEach((entry, index) => {
      const [key, id] = expected[index]!;
      assert.equal(entry[key], id, `row ${index} ${key}`);
    });
  } finally {
    database.close();
  }
});

test("Nested objects and arrays keep platform ids under their id keys unchanged", () => {
  const input = {
    payload: { items: [{ requestId: KNOWN_CARD_SHAPED_REQUEST_ID }, { offerId: KNOWN_CARD_SHAPED_OFFER_ID }] }
  };
  assert.deepEqual(redactSensitiveData(input), input);
});

test("Bare card numbers in any string value are still redacted", () => {
  assert.deepEqual(redactSensitiveData({ reference: CARD_NUMBER }), { reference: "[REDACTED]" });
});

test("Card numbers written with dashes or spaces are still redacted", () => {
  assert.deepEqual(redactSensitiveData({ reference: "4111-1111-1111-1111" }), { reference: "[REDACTED]" });
  assert.deepEqual(redactSensitiveData({ reference: "4111 1111 1111 1111" }), { reference: "[REDACTED]" });
});

test("Card numbers in free text are still redacted", () => {
  assert.deepEqual(
    redactSensitiveData({ note: "paid with 4111111111111111 today" }),
    { note: "paid with [REDACTED] today" }
  );
});

test("A card number under a platform-id key with a non-id-shaped value is still redacted", () => {
  assert.deepEqual(redactSensitiveData({ requestId: "4111 1111 1111 1111" }), { requestId: "[REDACTED]" });
  assert.deepEqual(redactSensitiveData({ offerId: CARD_NUMBER }), { offerId: "[REDACTED]" });
});

test("A UUID-shaped value with a prefix that is not valid for its id key is still redacted as before", () => {
  assert.deepEqual(redactSensitiveData({ requestId: KNOWN_CARD_SHAPED_COMMAND_ID }), { requestId: "cmd-63bde504-acc8-40f0-[REDACTED]" });
  assert.deepEqual(redactSensitiveData({ offerId: "gs-17477973-5806-4004-bea8-8d50c54c0c30" }), { offerId: "gs-[REDACTED]-bea8-8d50c54c0c30" });
});

test("A UUID with a non-v4 layout under a platform-id key is still redacted", () => {
  const version1 = "req-63bde504-acc8-10f0-9792-588939387591";
  assert.match(String(redactOne("requestId", version1)), /\[REDACTED\]/);
});

test("A card number next to a platform id is still redacted and the platform id is kept", () => {
  const output = redactSensitiveData({
    requestId: KNOWN_CARD_SHAPED_REQUEST_ID,
    note: `card 4111 1111 1111 1111 for ${KNOWN_CARD_SHAPED_REQUEST_ID}`
  }) as Record<string, unknown>;
  assert.equal(output.requestId, KNOWN_CARD_SHAPED_REQUEST_ID);
  assert.doesNotMatch(String(output.note), /4111/);
  assert.match(String(output.note), /\[REDACTED\]/);
});

test("A platform-id-shaped value under a key that is not a platform-id key is still redacted as before", () => {
  assert.deepEqual(
    redactSensitiveData({ note: KNOWN_CARD_SHAPED_OFFER_ID }),
    { note: "offer-[REDACTED]-bea8-8d50c54c0c30" }
  );
});

test("Sensitive keys are still redacted even when the value is a platform-generated id", () => {
  assert.deepEqual(redactSensitiveData({ token: KNOWN_CARD_SHAPED_REQUEST_ID }), { token: "[REDACTED]" });
  assert.deepEqual(redactSensitiveData({ cardNumber: `req-${randomUUID()}` }), { cardNumber: "[REDACTED]" });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "test" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("Every platform-id prefix in the exemption table is emitted by a platform id generator in the source", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const generatedPrefixes = new Set<string>();
  const generator = /`([a-z][a-z-]*)-\$\{(?:[\w.]+\.)?(?:randomUUID|idFactory)\(\)\}`/g;
  for (const area of ["domains", "packages", "apps"]) {
    for (const file of sourceFiles(join(root, area))) {
      for (const match of readFileSync(file, "utf8").matchAll(generator)) generatedPrefixes.add(match[1]!);
    }
  }
  const tabled = new Set(Object.values(PLATFORM_ID_PREFIXES_BY_KEY).flat());
  for (const prefix of tabled) assert.ok(generatedPrefixes.has(prefix), `prefix ${prefix} has no generator`);
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    assert.ok(PLATFORM_ID_PREFIXES_BY_KEY[key]?.includes(prefix), `${key} table lacks ${prefix}`);
  }
});

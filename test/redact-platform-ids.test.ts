import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redactSensitiveData } from "../packages/platform-core/src/redaction.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import { SqliteAuditLog } from "../packages/platform-core/src/sqlite-audit-log.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import {
  CARD_NUMBER,
  CARD_SHAPE,
  ID_KEY_PREFIXES,
  KNOWN_CARD_SHAPED_COMMAND_ID,
  KNOWN_CARD_SHAPED_OFFER_ID,
  KNOWN_CARD_SHAPED_REQUEST_ID,
  LUHN_INVALID_PAN,
  TEST_PANS,
  containsLuhnValidCardShape,
  encodePanAsPlatformId
} from "./helpers/platform-id-fixtures.js";

// ADR 0075 (one redactor for audit, telemetry and projections) & Issue 50.
// Platform-generated correlation ids are `<prefix>-<randomUUID()>`. The card-number rule must not mask them under
// their id keys unless their digits form a Luhn-valid card number. Every other card-number shape stays redacted.

function redactOne(key: string, value: unknown): unknown {
  return (redactSensitiveData({ [key]: value }) as Record<string, unknown>)[key];
}

// Key-name variants of one id key that the normalised lookup must treat the same way: camelCase, SCREAMING_SNAKE, and Capitalised_Snake.
function keyVariants(key: string): string[] {
  const snake = key.replace(/([A-Z])/g, "_$1");
  return [key, snake.toUpperCase(), snake.charAt(0).toUpperCase() + snake.slice(1)];
}

test("Platform-generated ids are altered only when their digits form a Luhn-valid card number, across 20,000 random ids", () => {
  let altered = 0;
  for (let index = 0; index < 20_000; index += 1) {
    const [key, prefix] = ID_KEY_PREFIXES[index % ID_KEY_PREFIXES.length]!;
    const id = `${prefix}-${randomUUID()}`;
    const output = redactOne(key, id);
    const expectedAltered = containsLuhnValidCardShape(id);
    if (output !== id) altered += 1;
    assert.equal(output !== id, expectedAltered, `${key}=${id} -> ${String(output)}`);
  }
  assert.ok(altered < 20_000);
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

test("Platform-generated ids are stored by SqliteAuditLog unchanged unless their digits form a Luhn-valid card number, across 20,000 random ids", () => {
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
      assert.equal(entry[key] !== id, containsLuhnValidCardShape(id), `row ${index} ${key}`);
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

test("Mastercard, Visa and Discover card numbers encoded in v4 platform ids are masked under every platform-id key and key-name variant", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    for (const pan of Object.values(TEST_PANS)) {
      const value = encodePanAsPlatformId(prefix, pan);
      for (const variant of keyVariants(key)) {
        const output = redactOne(variant, value);
        assert.notEqual(output, value, `${variant}=${value}`);
        assert.doesNotMatch(String(output), CARD_SHAPE, `${variant}=${value} -> ${String(output)}`);
      }
    }
  }
});

test("Card numbers encoded in v4 platform ids are masked inside nested objects and arrays", () => {
  for (const pan of Object.values(TEST_PANS)) {
    const value = encodePanAsPlatformId("req", pan);
    const output = JSON.stringify(redactSensitiveData({ payload: { items: [{ requestId: value }], deep: { offerId: value } } }));
    assert.doesNotMatch(output, CARD_SHAPE);
    assert.match(output, /\[REDACTED\]/);
  }
});

test("A v4 platform id whose card-shaped digits are not Luhn-valid stays unchanged under every platform-id key, including the known-bad ids", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    const value = encodePanAsPlatformId(prefix, LUHN_INVALID_PAN);
    assert.equal(redactOne(key, value), value, `${key}=${value}`);
  }
  assert.equal(redactOne("requestId", KNOWN_CARD_SHAPED_REQUEST_ID), KNOWN_CARD_SHAPED_REQUEST_ID);
  assert.equal(redactOne("offerId", KNOWN_CARD_SHAPED_OFFER_ID), KNOWN_CARD_SHAPED_OFFER_ID);
  assert.equal(redactOne("commandId", KNOWN_CARD_SHAPED_COMMAND_ID), KNOWN_CARD_SHAPED_COMMAND_ID);
});

test("A 15-digit Amex-length number is outside the 16-digit card rule and stays unchanged in ids and free text, as before", () => {
  const amex = "378282246310005";
  assert.equal(redactOne("requestId", `req-${amex}`), `req-${amex}`);
  assert.deepEqual(redactSensitiveData({ note: `ref ${amex}` }), { note: `ref ${amex}` });
});

test("A platform id followed by a card number in the same value is masked (end anchor)", () => {
  // The Luhn-valid appended card is masked by the Luhn gate even without the end anchor, so the Luhn-invalid case below
  // is the one that isolates the anchor.
  const value = `${KNOWN_CARD_SHAPED_REQUEST_ID} card 4111 1111 1111 1111`;
  const output = String(redactOne("requestId", value));
  assert.notEqual(output, value);
  assert.doesNotMatch(output, CARD_SHAPE);
  assert.match(output, /\[REDACTED\]/);
  const luhnInvalidTail = `${KNOWN_CARD_SHAPED_REQUEST_ID} card 4111 1111 1111 1112`;
  const isolated = String(redactOne("requestId", luhnInvalidTail));
  assert.notEqual(isolated, luhnInvalidTail);
  assert.doesNotMatch(isolated, CARD_SHAPE);
  assert.match(isolated, /\[REDACTED\]/);
});

test("A platform id with a trailing newline is not exempt and is masked as before", () => {
  assert.equal(redactOne("requestId", `${KNOWN_CARD_SHAPED_REQUEST_ID}\n`), "req-63bde504-acc8-40f0-[REDACTED]\n");
  const pan = encodePanAsPlatformId("req", TEST_PANS.visa);
  assert.doesNotMatch(String(redactOne("requestId", `${pan}\n`)), CARD_SHAPE);
});

test("Guest thread ids (g-<uuid>) are not exempt under threadId, because the client chooses them (follow-up in issue 50)", () => {
  const value = encodePanAsPlatformId("g", LUHN_INVALID_PAN);
  const output = redactOne("threadId", value);
  assert.notEqual(output, value);
  assert.match(String(output), /\[REDACTED\]/);
});

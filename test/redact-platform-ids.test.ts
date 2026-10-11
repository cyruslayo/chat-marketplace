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
  TEST_PANS,
  V4_UUID_SHAPE,
  cardRuleMatches,
  containsLuhnValidCardShape,
  encodePanAsPlatformId,
  findV4IdWithDigits,
  isLuhnValid
} from "./helpers/platform-id-fixtures.js";

// ADR 0075 (one redactor for audit, telemetry and projections) & Issue 50.
// A platform-generated id `<prefix>-<randomUUID()>` is exempt from the string rules under its id key, unless a match of the
// card rule's own regex is Luhn-valid. A gated value is replaced by "[REDACTED]" whole. The exemption is never wider than
// the card rule's own coverage.
//
// PINNED LIMITS (documented in issue 50; a change is deliberate):
//   1. A Luhn-valid 16-digit card number at an UNALIGNED hex offset (1 to 15) of an exact v4 id is not matched by the card
//      rule, so it is not detected. Same as free text on main.
//   2. 13- to 15-digit and 17- to 19-digit numbers are not matched by the card rule anywhere (ids or free text), so they
//      are not detected in ids either. The id context equals free text.
// Defence in depth only: client-supplied ids are lookup-validated before audit, and the client-chosen `g-` thread ids are
// excluded.

const REDACTED = "[REDACTED]";

function redactOne(key: string, value: unknown): unknown {
  return (redactSensitiveData({ [key]: value }) as Record<string, unknown>)[key];
}

// Key-name variants of one id key that the normalised lookup must treat the same way.
function keyVariants(key: string): string[] {
  const snake = key.replace(/([A-Z])/g, "_$1");
  return [key, snake.toUpperCase(), snake.charAt(0).toUpperCase() + snake.slice(1)];
}

const LARGE_LUHN_VALID_19_DIGIT_ID = "req-21022665-8675-4290-889a-aaaaaaaaaaaa";
// Unaligned (the card rule does not match it): PINNED LIMIT.
const UNALIGNED_LUHN_VALID_ID = "req-aaaaaaaa-3352-4152-8480-7151aaaaaaaa";
// The card rule's regex matches a 16-digit window only at hex offsets 0 and 16 (derived by test below).
const CARD_RULE_ALIGNED_OFFSETS = [0, 16];

test("Platform-generated ids are altered only when a card rule match in them is Luhn-valid, across 20,000 random ids", () => {
  for (let index = 0; index < 20_000; index += 1) {
    const [key, prefix] = ID_KEY_PREFIXES[index % ID_KEY_PREFIXES.length]!;
    const id = `${prefix}-${randomUUID()}`;
    const output = redactOne(key, id);
    assert.equal(output !== id, containsLuhnValidCardShape(id), `${key}=${id} -> ${String(output)}`);
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

test("Platform-generated ids are stored by SqliteAuditLog unchanged unless a card rule match in them is Luhn-valid, across 20,000 random ids", () => {
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

test("Nested objects and arrays keep known platform ids under their id keys unchanged", () => {
  const input = {
    payload: { items: [{ requestId: KNOWN_CARD_SHAPED_REQUEST_ID }, { offerId: KNOWN_CARD_SHAPED_OFFER_ID }] }
  };
  assert.deepEqual(redactSensitiveData(input), input);
});

test("Bare card numbers in any string value are still redacted", () => {
  assert.deepEqual(redactSensitiveData({ reference: CARD_NUMBER }), { reference: REDACTED });
});

test("Card numbers written with dashes or spaces are still redacted", () => {
  assert.deepEqual(redactSensitiveData({ reference: "4111-1111-1111-1111" }), { reference: REDACTED });
  assert.deepEqual(redactSensitiveData({ reference: "4111 1111 1111 1111" }), { reference: REDACTED });
});

test("Card numbers in free text are still redacted", () => {
  assert.deepEqual(
    redactSensitiveData({ note: "paid with 4111111111111111 today" }),
    { note: "paid with [REDACTED] today" }
  );
});

test("A card number under a platform-id key with a non-id-shaped value is still redacted", () => {
  assert.deepEqual(redactSensitiveData({ requestId: "4111 1111 1111 1111" }), { requestId: REDACTED });
  assert.deepEqual(redactSensitiveData({ offerId: CARD_NUMBER }), { offerId: REDACTED });
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
  assert.deepEqual(redactSensitiveData({ token: KNOWN_CARD_SHAPED_REQUEST_ID }), { token: REDACTED });
  assert.deepEqual(redactSensitiveData({ cardNumber: `req-${randomUUID()}` }), { cardNumber: REDACTED });
});

test("The card rule matches a 16-digit window in a v4 platform id only at hex offsets 0 and 16 (enumerated)", () => {
  const matched: number[] = [];
  for (let offset = 0; offset <= 16; offset += 1) {
    const id = findV4IdWithDigits("req", 16, offset, (digits) => isLuhnValid(digits));
    if (cardRuleMatches(id)) matched.push(offset);
  }
  assert.deepEqual(matched, CARD_RULE_ALIGNED_OFFSETS);
});

test("Mastercard, Visa and Discover card numbers encoded in v4 platform ids (aligned, offset 0) are masked under every platform-id key and key-name variant", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    for (const pan of Object.values(TEST_PANS)) {
      const value = encodePanAsPlatformId(prefix, pan);
      for (const variant of keyVariants(key)) {
        assert.equal(redactOne(variant, value), REDACTED, `${variant}=${value}`);
      }
    }
  }
});

test("Card numbers encoded in v4 platform ids (aligned) are masked inside nested objects and arrays", () => {
  for (const pan of Object.values(TEST_PANS)) {
    const value = encodePanAsPlatformId("req", pan);
    const output = redactSensitiveData({ payload: { items: [{ requestId: value }], deep: { offerId: value } } });
    assert.deepEqual(output, { payload: { items: [{ requestId: REDACTED }], deep: { offerId: REDACTED } } });
  }
});

test("A Luhn-valid 16-digit card number at the aligned hex offsets 0 and 16 of a v4 platform id is masked under every platform-id key and key-name variant", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    for (const offset of CARD_RULE_ALIGNED_OFFSETS) {
      const id = findV4IdWithDigits(prefix, 16, offset, (digits) => isLuhnValid(digits));
      assert.match(id.slice(prefix.length + 1), V4_UUID_SHAPE, `${key} offset ${offset} is not v4-shaped`);
      assert.equal(cardRuleMatches(id), true, `${key} offset ${offset} is not card-rule shaped`);
      for (const variant of keyVariants(key)) {
        assert.equal(redactOne(variant, id), REDACTED, `${variant}=${id}`);
      }
      assert.deepEqual(
        redactSensitiveData({ payload: { items: [{ [key]: id }] } }),
        { payload: { items: [{ [key]: REDACTED }] } },
        `nested ${key}=${id}`
      );
    }
  }
});

test("PINNED LIMIT: a Luhn-valid 16-digit card number at an unaligned hex offset (1 to 15) of a v4 platform id is not detected and stays unchanged, as free text on main", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    for (let offset = 1; offset <= 15; offset += 1) {
      if (CARD_RULE_ALIGNED_OFFSETS.includes(offset)) continue;
      const id = findV4IdWithDigits(prefix, 16, offset, (digits, candidate) =>
        isLuhnValid(digits) && !cardRuleMatches(candidate) && !containsLuhnValidCardShape(candidate)
      );
      assert.match(id.slice(prefix.length + 1), V4_UUID_SHAPE);
      assert.equal(redactOne(key, id), id, `${key} offset ${offset}: ${id}`);
    }
  }
});

test("PINNED LIMIT: the review example req-aaaaaaaa-3352-4152-8480-7151aaaaaaaa (unaligned, card rule does not match) is not detected and stays unchanged", () => {
  assert.equal(cardRuleMatches(UNALIGNED_LUHN_VALID_ID), false);
  assert.equal(isLuhnValid("3352415284807151"), true);
  assert.equal(redactOne("requestId", UNALIGNED_LUHN_VALID_ID), UNALIGNED_LUHN_VALID_ID);
});

test("PINNED LIMIT: 17-, 18- and 19-digit Luhn-valid numbers in a v4 platform id are not detected and stay unchanged (the card rule never matches 17-19 digits; the id context equals free text)", () => {
  // Offsets 4 and 9: the card rule matches nothing in these ids. At offset 0 it matches the aligned first 16 digits.
  for (const length of [17, 18, 19]) {
    for (const offset of [4, 9]) {
      const id = findV4IdWithDigits("req", length, offset, (digits, candidate) => isLuhnValid(digits) && !cardRuleMatches(candidate));
      assert.equal(redactOne("requestId", id), id, `${length}-digit run at offset ${offset}: ${id}`);
    }
  }
});

test("PINNED LIMIT: the 19-digit id req-21022665-8675-4290-889a-aaaaaaaaaaaa (Luhn-valid as a whole) stays unchanged; the card rule matches only its Luhn-invalid 16-digit prefix, and 17-19 digit numbers are outside the card rule", () => {
  assert.equal(redactOne("requestId", LARGE_LUHN_VALID_19_DIGIT_ID), LARGE_LUHN_VALID_19_DIGIT_ID);
  assert.equal(isLuhnValid("2102266586754290889"), true);
});

test("A v4 platform id with no gate trip stays unchanged at every hex offset under every platform-id key", () => {
  for (const [key, prefix] of ID_KEY_PREFIXES) {
    for (let offset = 0; offset <= 16; offset += 1) {
      const id = findV4IdWithDigits(prefix, 16, offset, (_digits, candidate) => !containsLuhnValidCardShape(candidate));
      assert.match(id.slice(prefix.length + 1), V4_UUID_SHAPE);
      assert.equal(redactOne(key, id), id, `${key} offset ${offset}: ${id}`);
    }
  }
  assert.equal(redactOne("requestId", KNOWN_CARD_SHAPED_REQUEST_ID), KNOWN_CARD_SHAPED_REQUEST_ID);
  assert.equal(redactOne("offerId", KNOWN_CARD_SHAPED_OFFER_ID), KNOWN_CARD_SHAPED_OFFER_ID);
  assert.equal(redactOne("commandId", KNOWN_CARD_SHAPED_COMMAND_ID), KNOWN_CARD_SHAPED_COMMAND_ID);
});

test("A 15-digit Amex-length number is outside the card rule and stays unchanged in ids and free text, as before", () => {
  const amex = "378282246310005";
  assert.equal(redactOne("requestId", `req-${amex}`), `req-${amex}`);
  assert.deepEqual(redactSensitiveData({ note: `ref ${amex}` }), { note: `ref ${amex}` });
});

test("A 19-digit Luhn-valid number in free text stays unchanged, as on main (outside an id, the rule matches only 16 digits)", () => {
  const nineteen = "2102266586754290889";
  assert.equal(isLuhnValid(nineteen), true);
  assert.deepEqual(redactSensitiveData({ note: `ref ${nineteen}` }), { note: `ref ${nineteen}` });
});

test("A platform id followed by a card number in the same value is masked (end anchor)", () => {
  // The Luhn-valid appended card is masked by the gate even without the end anchor, so the Luhn-invalid case below is
  // the one that isolates the anchor.
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
  assert.equal(redactOne("requestId", `${pan}\n`), REDACTED);
});

test("Platform ids inside arrays under a listed key follow the same rules as scalars: clean ids stay, gated ids are masked", () => {
  const gated = encodePanAsPlatformId("req", TEST_PANS.visa);
  assert.deepEqual(
    redactSensitiveData({ requestId: [KNOWN_CARD_SHAPED_REQUEST_ID, gated] }),
    { requestId: [KNOWN_CARD_SHAPED_REQUEST_ID, REDACTED] }
  );
});

test("Non-string values under a platform-id key are returned unchanged, as on main (pre-existing: only strings are scanned)", () => {
  assert.deepEqual(redactSensitiveData({ requestId: 5555555555554444 }), { requestId: 5555555555554444 });
});

test("Guest thread ids (g-<uuid>) are not exempt under threadId, because the client chooses them (follow-up in issue 50)", () => {
  const value = findV4IdWithDigits("g", 16, 0, (_digits, candidate) => !containsLuhnValidCardShape(candidate));
  const output = redactOne("threadId", value);
  assert.notEqual(output, value);
  assert.match(String(output), /\[REDACTED\]/);
});

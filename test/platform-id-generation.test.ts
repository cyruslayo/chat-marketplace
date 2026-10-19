import test from "node:test";
import assert from "node:assert/strict";
import { generatePlatformId, MAX_PLATFORM_ID_ATTEMPTS } from "../packages/platform-core/src/platform-id.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/envelope.js";
import { containsLuhnValidCardShape, redactSensitiveData } from "../packages/platform-core/src/redaction.js";

// ADR 0075 & issue 50: platform-generated ids never trip the card-shape redaction gate, so the exact-id exemption is
// never needed for them. A v4 uuid that trips the gate is drawn again; the redactor itself is unchanged.

// Luhn-tripping: `cmd-00000000-0000-4002-8000-000000000000` carries the Luhn-valid run 0000000000004002.
const TRIPPING_UUID = "00000000-0000-4002-8000-000000000000";
const SAFE_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("generatePlatformId regenerates a uuid that trips the card-shape gate and returns the first safe id", () => {
  assert.equal(containsLuhnValidCardShape(`cmd-${TRIPPING_UUID}`), true, "the fixture trips the gate");
  const draws = [TRIPPING_UUID, SAFE_UUID];
  let calls = 0;
  const id = generatePlatformId("cmd", () => {
    calls += 1;
    return draws.shift()!;
  });
  assert.equal(id, `cmd-${SAFE_UUID}`);
  assert.equal(calls, 2, "the tripping draw was replaced");
});

test("generatePlatformId returns a plain id unchanged on the first draw", () => {
  let calls = 0;
  assert.equal(generatePlatformId("req", () => (calls += 1, SAFE_UUID)), `req-${SAFE_UUID}`);
  assert.equal(calls, 1);
});

test("generatePlatformId fails closed when every draw trips the gate", () => {
  let calls = 0;
  assert.throws(
    () => generatePlatformId("cmd", () => (calls += 1, TRIPPING_UUID)),
    /outside the card-shape redaction gate/
  );
  assert.equal(calls, MAX_PLATFORM_ID_ATTEMPTS);
});

test("20,000 generated command ids survive redactSensitiveData unchanged", () => {
  for (let index = 0; index < 20_000; index += 1) {
    const { commandId } = createPlatformCommandEnvelope({
      commandName: "test.command",
      principal: { id: "usr-guest-001", role: "guest" },
      payload: {}
    });
    assert.match(commandId, /^cmd-[0-9a-f-]{36}$/);
    assert.deepEqual(redactSensitiveData({ commandId }), { commandId }, commandId);
  }
});

test("generatePlatformId draws from randomUUID by default", () => {
  const id = generatePlatformId("offer");
  assert.match(id, /^offer-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(containsLuhnValidCardShape(id), false);
});

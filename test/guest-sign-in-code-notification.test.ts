import assert from "node:assert/strict";
import test from "node:test";
import { guestSignInCodeMessage, type NotificationKind } from "../apps/pilot/src/notifications/pilot-notifier.js";

const EMAIL = "ada@example.test";
const CODE = "482913";
const CHALLENGE = "chal-abc123";

test("AC7: The sign-in code is in the email body only, and its idempotency key holds neither the code nor the email", () => {
  const message = guestSignInCodeMessage({ email: EMAIL, code: CODE, minutes: 10, challengeId: CHALLENGE });
  assert.deepEqual(message.to, [EMAIL]);
  assert.match(message.text, new RegExp(`\\b${CODE}\\b`), "the code is in the body");
  assert.equal(message.idempotencyKey, `guest.sign_in_code:${CHALLENGE}`);
  assert.equal(message.idempotencyKey.includes(CODE), false, "the key does not carry the code");
  assert.equal(message.idempotencyKey.includes(EMAIL), false, "the key does not carry the email");
  assert.equal(message.subject.includes(CODE), false, "the subject does not carry the code");
});

test("AC7 failure path: a message for a different challenge has a different idempotency key, so a retry cannot send the same code twice", () => {
  const first = guestSignInCodeMessage({ email: EMAIL, code: CODE, minutes: 10, challengeId: CHALLENGE });
  const second = guestSignInCodeMessage({ email: EMAIL, code: "111111", minutes: 10, challengeId: "chal-other" });
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test("AC7: guest.sign_in_code is a NotificationKind", () => {
  const kind: NotificationKind = "guest.sign_in_code";
  assert.equal(kind, "guest.sign_in_code");
});

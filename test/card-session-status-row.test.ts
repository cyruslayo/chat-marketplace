import assert from "node:assert/strict";
import test from "node:test";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import {
  SqliteGuestInteractionStore,
  type DurableCardCheckoutSession,
} from "../domains/shortlet/src/guest-interaction-store.js";

// Issue 15 (state-machines PRD, Track C). ADR 0046 (one live payment attempt) and ADR 0075 (no ids in logs or errors).
// A stored card checkout session row with an unrecognised status must fail closed, never load as "initiated".

const KNOWN_STATUSES = ["initiated", "completed", "expired", "failed"] as const;

function sessionFor(
  checkoutId: string,
  status: DurableCardCheckoutSession["status"],
): DurableCardCheckoutSession {
  return {
    checkoutId,
    offerId: `offer-${checkoutId}`,
    pspReference: `psp-ref-${checkoutId}-1700000000000`,
    totalAmountDueNowKobo: 150000,
    amountKobo: 150000,
    purpose: "stay",
    currency: "NGN",
    contactEmail: "guest@example.test",
    expiresAt: "2030-10-01T12:20:00.000Z",
    status,
  };
}

test("issue 15 AC1: A stored row with each of the four known statuses loads with that status", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const store = new SqliteGuestInteractionStore(db);
    for (const status of KNOWN_STATUSES) {
      store.saveCheckoutSession(sessionFor(`checkout-${status}`, status));
    }
    for (const status of KNOWN_STATUSES) {
      const loaded = store.findCheckoutSession(`checkout-${status}`);
      assert.ok(loaded, `a ${status} row loads`);
      assert.equal(loaded.status, status);
    }
  } finally {
    db.close();
  }
});

test("issue 15 AC2: A stored row with an unknown status throws Unknown card checkout session status, and the message contains no ids", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const store = new SqliteGuestInteractionStore(db);
    const checkoutId = "checkout-bogus-row";
    store.saveCheckoutSession(sessionFor(checkoutId, "initiated"));
    // Corrupt the stored value directly, as a bad migration or manual edit would.
    db.prepare(
      "UPDATE guest_checkout_sessions SET status = $status WHERE checkout_id = $checkoutId",
    ).run({ $status: "bogus", $checkoutId: checkoutId });

    let thrown: unknown;
    try {
      store.findCheckoutSession(checkoutId);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof Error, "the unknown status throws an Error");
    assert.equal(thrown.message, "Unknown card checkout session status");
    for (const forbidden of [checkoutId, `offer-${checkoutId}`, `psp-ref-${checkoutId}`, "guest@example.test", "bogus"]) {
      assert.ok(!thrown.message.includes(forbidden), `the message omits ${forbidden}`);
    }
  } finally {
    db.close();
  }
});

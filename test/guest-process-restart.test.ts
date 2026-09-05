import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guestAction, proveStage, restartFixture, stages } from "./helpers/guest-restart.js";

test("AC1 — A Request Draft restores after process restart", () => proveStage("draft"));
test("AC2 — A pending Booking Request restores after process restart", () => proveStage("pending"));
test("AC3 — A Conditional Booking Offer restores after process restart", () => proveStage("offer"));
test("AC4 — Payment handoff restores without creating another Live Payment Attempt", () => proveStage("handoff"));
test("AC5 — Payment processing restores without duplicate verification", async () => {
  let verifications = 0;
  const f = await restartFixture({ verifyPayment: (pspReference, amountKobo) => {
    verifications++;
    return { verified: true, status: "pending", pspReference, amountKobo, currency: "NGN" };
  } });
  try {
    const handoff = await f.advance("handoff");
    const processing = await f.send("/api/event", guestAction(handoff.surfaces[0]!));
    assert.equal(processing.ok, true);
    if (processing.ok) assert.match(processing.surfaces[0]?.summary ?? "", /processing/i);
    assert.equal(verifications, 1);
    await f.restart();
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(state.surfaces[0]?.summary ?? "", /processing/i);
    await f.state();
    assert.equal(verifications, 1);
  } finally { await f.close(); }
});
test("AC6 — A confirmed Reservation restores after process restart", () => proveStage("confirmed"));
test("AC7 — Restart restoration does not repeat consequential commands", async () => {
  for (const stage of stages) {
    const f = await restartFixture();
    try {
      await f.advance(stage);
      // Count durable consequential side effects (ADR-0079): the store's
      // authoritative records, not the per-process in-memory audit.
      const beforeStore = f.environment.interactionStore;
      const before = {
        drafts: beforeStore.listDraftIds().length,
        requests: beforeStore.listBookingRequestIds().length,
        offers: beforeStore.listConditionalOfferIds().length,
        sessions: beforeStore.listCheckoutSessionIds().length,
        attempts: beforeStore.listLivePaymentAttemptOfferIds().length,
        references: beforeStore.listProcessedPspReferenceIds().length,
        bookings: beforeStore.listBookingSnapshotOfferIds().length,
      };
      await f.restart();
      await f.state();
      await f.state();
      const afterStore = f.environment.interactionStore;
      const after = {
        drafts: afterStore.listDraftIds().length,
        requests: afterStore.listBookingRequestIds().length,
        offers: afterStore.listConditionalOfferIds().length,
        sessions: afterStore.listCheckoutSessionIds().length,
        attempts: afterStore.listLivePaymentAttemptOfferIds().length,
        references: afterStore.listProcessedPspReferenceIds().length,
        bookings: afterStore.listBookingSnapshotOfferIds().length,
      };
      assert.deepEqual(after, before, `durable consequential side effects at ${stage}`);
      for (const action of f.actions) {
        const rejected = await f.send("/api/event", action);
        assert.equal(rejected.ok, false, `old action ${action.name} at ${stage}`);
      }
    } finally { await f.close(); }
  }
});
test("AC8 — Restored stale surfaces fail closed", async () => {
  const f = await restartFixture();
  try {
    await f.advance("pending"); const stale = f.actions.at(-1)!;
    await f.restart();
    assert.equal((await f.send("/api/event", stale)).ok, false);
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(state.surfaces[0]?.summary ?? "", /Booking Request/);
  } finally { await f.close(); }
});
test("AC9 — Restored expired surfaces fail closed", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("offer"); const action = guestAction(before.surfaces[0]!);
    f.setTime("2026-09-03T10:31:00Z"); await f.restart();
    assert.equal((await f.send("/api/event", action)).ok, false);
    const state = await f.state(); assert.equal(state.ok, true);
    if (state.ok) assert.match(JSON.stringify(state.surfaces), /expired/i);
  } finally { await f.close(); }
});
test("AC10 — Cross-session restoration attempts fail closed", async () => {
  const f = await restartFixture();
  try {
    const before = await f.advance("review"); await f.restart();
    const stranger = `shortlet_guest_session=gs-${crypto.randomUUID()}`;
    assert.equal((await f.state(stranger)).ok, false);
    assert.equal((await f.send("/api/event", guestAction(before.surfaces[0]!), stranger)).ok, false);
    const own = await f.state(); assert.equal(own.ok, true);
    if (own.ok) assert.equal(own.surfaces[0]?.surfaceId, before.surfaces[0]!.surfaceId);
  } finally { await f.close(); }
});
test("AC11 — Cross-tenant restoration attempts fail closed", async () => {
  const f = await restartFixture();
  try {
    await f.advance("review"); await f.restart({ tenantId: "different-tenant" });
    const state = await f.state();
    assert.equal(state.ok, false);
  } finally { await f.close(); }
});
test("AC12 — No restricted credential or identity material enters the durable interaction store", async () => {
  const f = await restartFixture();
  try {
    await f.advance("offer");
    const before = await f.state(); assert.equal(before.ok, true);
    assert.equal(readFileSync(f.databasePath).includes(Buffer.from(f.cookie.split("=")[1]!)), false);
    await f.restart();
    const after = await f.state(); assert.equal(after.ok, true);
    if (after.ok) assert.ok(after.surfaces.length > 0, "empty persistence is not security proof");
  } finally { await f.close(); }
});
test("Discovery restores after process restart", () => proveStage("discovery"));
test("Unit inspection restores after process restart", () => proveStage("inspection"));
test("Request review restores after process restart", () => proveStage("review"));

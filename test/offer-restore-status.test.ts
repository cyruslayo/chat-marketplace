import test from "node:test";
import assert from "node:assert/strict";
import { CONDITIONAL_OFFER_ACCEPT_EVENT } from "../apps/web/src/conditional-offer-actions.js";
import { flagMaterialUnitChange } from "../domains/shortlet/src/index.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

// Issue 13 (ADR 0074, ADR 0106): a restored Conditional Booking Offer keeps the status of the offer it restores.
// Every request is a cold restore: a new LocalGuestApp over the same store before each event.

test("AC1: a stale Conditional Booking Offer restores non-actionable after a cold restore, matching the journey rail", async () => {
  const f = await restartFixture();
  try {
    const offer = await f.advance("offer");
    const surface = offer.surfaces[0]!;
    const offerId = surface.surfaceId.split(":").at(-1)!;
    const unitId = f.environment.conditionalOfferApp.getOffer(offerId).unitId;
    // Real flow: the unit's eligibility changes, then the guest accepts. The accept is refused and the offer is marked stale.
    flagMaterialUnitChange(f.environment.unitRepository, unitId);
    const refused = await f.send("/api/event", guestAction(surface, CONDITIONAL_OFFER_ACCEPT_EVENT));
    assert.equal(refused.ok, false);
    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (!state.ok) throw new Error("unreachable");
    const restored = state.surfaces.find((candidate) => candidate.surfaceId === surface.surfaceId);
    assert.ok(restored, "the offer surface is restored under the id the guest holds");
    assert.notEqual(restored.status, "active", "a stale offer must not restore as active");
    assert.equal(restored.summary, "Conditional Booking Offer");
    assert.equal(state.journey?.outcome?.label, "Offer no longer current");
  } finally { await f.close(); }
});

test("AC2: an issued Conditional Booking Offer within its Payment Window restores active, as before", async () => {
  const f = await restartFixture();
  try {
    const offer = await f.advance("offer");
    const surface = offer.surfaces[0]!;
    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (!state.ok) throw new Error("unreachable");
    const restored = state.surfaces.find((candidate) => candidate.surfaceId === surface.surfaceId);
    assert.ok(restored);
    assert.equal(restored.status, "active");
    assert.equal(restored.summary, "Conditional Booking Offer");
  } finally { await f.close(); }
});

test("AC3: an expired Conditional Booking Offer restores expired, as before", async () => {
  const f = await restartFixture();
  try {
    const offer = await f.advance("offer");
    const surface = offer.surfaces[0]!;
    f.setTime("2026-09-03T10:31:00Z");
    await f.restart();
    const state = await f.state();
    assert.equal(state.ok, true);
    if (!state.ok) throw new Error("unreachable");
    const restored = state.surfaces.find((candidate) => candidate.surfaceId === surface.surfaceId);
    assert.ok(restored);
    assert.equal(restored.status, "expired");
    assert.equal(restored.summary, "Conditional Booking Offer expired");
  } finally { await f.close(); }
});

test("AC4: a Conditional Booking Offer action against the restored stale surface is refused and never accepted", async () => {
  const f = await restartFixture();
  try {
    const offer = await f.advance("offer");
    const surface = offer.surfaces[0]!;
    const offerId = surface.surfaceId.split(":").at(-1)!;
    const unitId = f.environment.conditionalOfferApp.getOffer(offerId).unitId;
    // The accept action the guest already holds, captured before the restart.
    const heldAccept = guestAction(surface, CONDITIONAL_OFFER_ACCEPT_EVENT);
    flagMaterialUnitChange(f.environment.unitRepository, unitId);
    await f.restart();
    // The test fixture's unit repository is process-local, so the unit change is applied again to the restarted environment.
    flagMaterialUnitChange(f.environment.unitRepository, unitId);
    const state = await f.state();
    assert.equal(state.ok, true);
    const response = await f.send("/api/event", heldAccept);
    assert.equal(response.ok, false);
    assert.equal(f.environment.conditionalOfferApp.getOffer(offerId).status === "accepted", false, "the offer must not be accepted");
    assert.equal(f.environment.conditionalOfferApp.getOffer(offerId).tokenUsed, false, "the confirmation token must not be spent");
  } finally { await f.close(); }
});

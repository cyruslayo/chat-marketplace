import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutOverstayManager } from "../domains/shortlet/src/index.js";
import { CheckoutOverstayApplication, type CheckoutReservation, type EffectiveCheckoutTerms } from "../apps/web/src/checkout-overstay-application.js";
import type { CommandPrincipal } from "../packages/platform-core/src/index.js";

const guest: CommandPrincipal = { id: "guest-1", role: "guest", tenantId: "tenant-1" };
const reservation: CheckoutReservation = { reservationId: "res-1", contractId: "contract-1", unitId: "unit-1", primaryGuestId: "guest-1", tenantId: "tenant-1", status: "confirmed", checkoutDate: "2026-08-25" };
function setup() {
  let term: EffectiveCheckoutTerms = { reservationId: "res-1", checkoutDate: "2026-08-25", checkoutTime: "11:00", source: "contractual", termVersion: "term-1" };
  let sameDay = false; let amendments = 0;
  const app = new CheckoutOverstayApplication({
    manager: new CheckoutOverstayManager({ hasSameDayArrival: () => sameDay, hasMaintenanceOrInspection: () => false, hasTurnoverCapacity: () => true, hasSupportAvailability: () => true, operatorApproved: () => true }),
    reservations: { getReservation: () => reservation }, terms: { getTerms: () => term },
    eligibility: { hasSameDayArrival: () => sameDay, hasMaintenanceOrInspection: () => false, hasTurnoverCapacity: () => true, hasSupportAvailability: () => true, operatorApproved: () => true },
    quotes: { getQuote: ({ requestedTime }) => ({ quoteId: `quote-${requestedTime}`, feeKobo: 777777, currency: "NGN", policyVersion: "late-v3" }) },
    amendments: { acceptLateCheckout: ({ requestedTime, quoteId }) => { amendments += 1; term = { ...term, checkoutTime: requestedTime, source: "checkout_amendment", termVersion: "term-2", amendmentId: "amend-1", amendmentVersion: 1 }; return { amendmentId: "amend-1", amendmentVersion: 1, effectiveCheckoutTime: requestedTime, quoteId, feeKobo: 777777, currency: "NGN" }; } },
    evidence: { getOccupancyEvidence: () => ({ occupancyContinues: false, references: [] }) },
  });
  return { app, setSameDay: (value: boolean) => { sameDay = value; }, amendments: () => amendments };
}
test("production Checkout application authorizes the Primary Guest and projects provider quotes", () => {
  const { app } = setup(); const artifact = app.getArtifact("res-1", guest);
  assert.equal(artifact.facts.effectiveCheckoutTime, "11:00"); assert.deepEqual(artifact.facts.lateCheckoutOptions.map((option) => option.feeKobo), [777777, 777777, 777777]);
  assert.throws(() => app.getArtifact("res-1", { ...guest, id: "other" }), /not authorized/);
  assert.throws(() => app.getArtifact("res-1", { ...guest, tenantId: "other" }), /not authorized/);
});
test("acceptance revalidates current state, reads the amended term, and is replay-safe", () => {
  const { app, setSameDay, amendments } = setup(); const before = app.getArtifact("res-1", guest); const accepted = app.acceptLateCheckout("res-1", "14:00", guest, before.actions.find((action) => action.requestedTime === "14:00"));
  assert.equal(accepted.facts.effectiveCheckoutTime, "14:00"); assert.equal(accepted.facts.effectiveCheckoutIso, "2026-08-25T13:00:00.000Z"); assert.equal(amendments(), 1);
  assert.equal(app.acceptLateCheckout("res-1", "14:00", guest).facts.effectiveCheckoutTime, "14:00"); assert.equal(amendments(), 1);
  const second = setup(); const stale = second.app.getArtifact("res-1", guest); second.setSameDay(true); assert.throws(() => second.app.acceptLateCheckout("res-1", "14:00", guest, stale.actions.find((action) => action.requestedTime === "14:00")), /STALE_ACTION|CURRENT_ACTION/);
});

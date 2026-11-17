import test from "node:test";
import assert from "node:assert/strict";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";
import type { PSPVerifyResult } from "../domains/shortlet/src/index.js";

// Issue 11: a card payment in processing restores as processing, for the stay and for the security deposit (ADR 0044, 0074, 0106).
// A new LocalGuestApp over the same store is the cold restore (ADR 0106, helpers/guest-restart.ts restart()).

const PROCESSING = /processing|checking payment/i;
const GUEST_ID = "guest-demo-101";

/** The stay charge settles, so the guest reaches the deposit; every verification after that is pending (ADR 0044 grace). */
function staySettledThenPending() {
  let calls = 0;
  return (pspReference: string, amountKobo: number): PSPVerifyResult => {
    calls++;
    if (calls === 1) return { verified: true, status: "success", pspReference, amountKobo, currency: "NGN", payerId: GUEST_ID };
    return { verified: true, status: "pending", pspReference, amountKobo, currency: "NGN" };
  };
}

test("AC1 — After a cold restore, a thread whose card payment is in deposit_payment_processing restores to the payment processing (result) surface", async () => {
  const f = await restartFixture({ guestId: GUEST_ID, verifyPayment: staySettledThenPending() });
  try {
    // The guest is on the deposit's hosted-checkout surface when the deposit payment is checked in the background
    // (the server-side return verification of the payment callback), so the thread still holds the checkout surface.
    const deposit = await f.advance("deposit-handoff");
    assert.equal(deposit.ok, true);
    const [offerId] = f.environment.interactionStore.listConditionalOfferIds();
    assert.ok(offerId, "an offer exists");
    const session = f.environment.cardPaymentApp.getCheckoutSession(offerId);
    assert.ok(session?.pspReference, "the deposit checkout session exists");
    assert.throws(
      () => f.environment.cardPaymentApp.verifyAndConfirm(session.pspReference, f.environment.systemPrincipal()),
      /processing|grace/i,
      "the deposit verification is pending under the Payment-Processing Grace period",
    );
    const artifact = f.environment.cardPaymentApp.getArtifact(offerId, f.environment.guestPrincipal());
    assert.equal(artifact.facts.journeyStage, "deposit_payment_processing", "the card payment is in deposit_payment_processing");

    await f.restart();
    const restored = await f.state();
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    const surface = restored.surfaces[0]!;
    assert.ok(surface.surfaceId.includes(":payment:result:"), `restored to the processing surface, got ${surface.surfaceId}`);
    assert.match(surface.summary ?? "", PROCESSING);
  } finally { await f.close(); }
});

test("AC2 — A thread in stay_payment_processing restores exactly as before", async () => {
  const f = await restartFixture({ verifyPayment: (pspReference, amountKobo) => ({ verified: true, status: "pending", pspReference, amountKobo, currency: "NGN" }) });
  try {
    const handoff = await f.advance("handoff");
    const processing = await f.send("/api/event", guestAction(handoff.surfaces[0]!));
    assert.equal(processing.ok, true);
    if (!processing.ok) return;
    const before = processing.surfaces[0]!;
    assert.match(before.summary ?? "", PROCESSING);

    await f.restart();
    const restored = await f.state();
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.equal(restored.surfaces[0]?.surfaceId, before.surfaceId);
    assert.match(restored.surfaces[0]?.summary ?? "", PROCESSING);
    const second = await f.state();
    assert.deepEqual(second, restored, "restoration must not change the projection");
  } finally { await f.close(); }
});

test("AC3 — A thread whose payment is ready (not processing) still restores to the payment-ready surface", async () => {
  const f = await restartFixture();
  try {
    const ready = await f.advance("payment-ready");
    const before = ready.surfaces[0]!;
    assert.ok(before.surfaceId.includes(":payment:ready:"), `payment-ready surface id ${before.surfaceId}`);

    await f.restart();
    const restored = await f.state();
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.equal(restored.surfaces[0]?.surfaceId, before.surfaceId);
    assert.doesNotMatch(restored.surfaces[0]?.summary ?? "", PROCESSING);
  } finally { await f.close(); }
});

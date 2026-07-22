import test from "node:test";
import assert from "node:assert/strict";
import {
  InstagramChannelAdapter,
  UnitRepository,
  seedIssue01Units
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const adapter = new InstagramChannelAdapter({ repository });
  const unit = repository.findAll()[0];
  return { repository, adapter, unit };
}

test("Instagram projections contain only approved public facts and non-transactional actions", () => {
  const { adapter, unit } = setup();

  const projection: any = adapter.projectToInstagram(unit);

  assert.equal(projection.channel, "instagram");
  assert.equal(projection.unitId, unit.id);
  assert.equal(projection.title, unit.title);
  assert.equal(projection.neighbourhood, "Ikeja");
  assert.equal(projection.city, "Lagos");
  assert.equal(projection.capacity, 4);

  assert.deepEqual(
    projection.actions.map((a: any) => a.type),
    ["get_web_referral_link"]
  );

  assert.equal(projection.exactAddress, undefined);
  assert.equal(projection.operatorFinancials, undefined);
  assert.equal(projection.paymentDetails, undefined);
});

test("Secure referral preserves lawful context but creates a newly authorized destination session", () => {
  const { adapter, unit } = setup();

  const referral: any = adapter.generateSecureReferralLink({
    unitId: unit.id,
    searchContext: { checkIn: "2026-08-10", checkOut: "2026-08-12", partySize: 2 }
  });

  assert.ok(referral.referralUrl.includes(`/stays/${unit.id}`));
  assert.ok(referral.token);
  assert.equal(referral.requiresNewAuthSession, true);
  assert.equal(referral.context.checkIn, "2026-08-10");
  assert.equal(referral.context.checkOut, "2026-08-12");
  assert.equal(referral.context.partySize, 2);
});

test("Free text, acknowledgement, or message delivery cannot create authoritative booking state", () => {
  const { adapter } = setup();

  const textResponse = adapter.handleInstagramMessage({
    messageType: "free_text",
    text: "I want to book this apartment right now, here is my payment confirmation"
  });

  assert.equal(textResponse.createsBookingState, false);
  assert.equal(textResponse.authoritativeAction, null);
  assert.ok(textResponse.replyText.includes("Instagram does not support direct bookings"));

  const ackResponse = adapter.handleInstagramMessage({
    messageType: "acknowledgement",
    acknowledgedId: "msg-123"
  });

  assert.equal(ackResponse.createsBookingState, false);
});

test("Capability and privacy tests reject restricted information and every prohibited completion path", () => {
  const { adapter } = setup();

  const prohibitedIntents = [
    "create_booking_request",
    "pay_reservation",
    "verify_identity",
    "cancel_booking",
    "request_remedy",
    "request_exact_address",
    "operator_payout"
  ];

  for (const intent of prohibitedIntents) {
    assert.throws(
      () => adapter.executeAction({ intent, payload: {} }),
      /Prohibited completion path: Instagram does not support transactional or restricted actions/i
    );
  }
});

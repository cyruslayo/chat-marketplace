import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppChannelAdapter } from "../domains/shortlet/src/whatsapp-adapter.js";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";

test("Amounts, absolute WAT deadlines, consequences, disclosures, references, and consent meaning match authoritative artifacts.", () => {
  const adapter = new WhatsAppChannelAdapter();

  const canonicalArtifact = {
    id: "art-booking-101",
    kind: "shortlet.booking-quote",
    schemaVersion: "shortlet.quote/v1",
    domainReferences: [{ type: "Reservation", id: "res-101" }],
    policyVersions: { pricing: "all-in/v1" },
    disclosures: ["Non-refundable after check-in protection window."],
    amounts: [{ label: "All-In Stay Total", amountKobo: 25000000, currency: "NGN" }],
    deadlines: [{ label: "Payment Cutoff", absoluteWatIso: "2026-07-25T14:00:00+01:00" }],
    consequences: ["Reservation expires if payment is not completed before cutoff."],
    actions: [{ type: "pay_reservation", requiresAuthenticatedWeb: true }],
    sensitivity: "protected"
  };

  const projected = adapter.projectArtifact(canonicalArtifact);

  assert.equal(projected.channel, "whatsapp");
  assert.equal(projected.amounts[0].amountKobo, 25000000);
  assert.equal(projected.deadlines[0].absoluteWatIso, "2026-07-25T14:00:00+01:00");
  assert.equal(projected.disclosures[0], "Non-refundable after check-in protection window.");
  assert.equal(projected.consequences[0], "Reservation expires if payment is not completed before cutoff.");
});

test("The shared capability matrix blocks actions lacking sufficient disclosure, authentication, consent, or audit evidence.", () => {
  const adapter = new WhatsAppChannelAdapter();

  // Action lacking audit evidence / authentication
  const actionWithoutAuth = {
    actionType: "amend_booking_terms",
    hasDisclosure: true,
    hasAuthentication: false,
    hasConsent: true,
    hasAuditEvidence: true
  };

  const capabilityResult = adapter.evaluateCapability(actionWithoutAuth);
  assert.equal(capabilityResult.permittedInChannel, false);
  assert.match(capabilityResult.reason!, /Action requires authenticated session/);

  // Action with full disclosure, auth, consent, and audit
  const validInformationalAction = {
    actionType: "view_stay_status",
    hasDisclosure: true,
    hasAuthentication: true,
    hasConsent: true,
    hasAuditEvidence: true
  };

  const validResult = adapter.evaluateCapability(validInformationalAction);
  assert.equal(validResult.permittedInChannel, true);
});

test("WhatsApp identity alone cannot authorize high-impact account, contractual, financial, or protected-data actions.", () => {
  const adapter = new WhatsAppChannelAdapter();

  const highImpactIntents = [
    "pay_by_card",
    "enter_payment_credentials",
    "upload_identity_document",
    "amend_material_contract_terms",
    "request_deposit_claim_payout",
    "view_full_primary_guest_identity"
  ];

  for (const intent of highImpactIntents) {
    const evalResult = adapter.executeAction({
      intent,
      payload: { whatsappId: "2348000000000" },
      isAuthenticatedWebSession: false
    });

    assert.equal(evalResult.redirectedToWeb, true);
    assert.equal(evalResult.createsContractualState, false);
    assert.ok(evalResult.webUrl.includes("https://shortlet.platform/auth/web-redirect"));
  }
});

test("Delivery acceptance, read, response, retry, channel switch, and handoff are distinct correlated events.", () => {
  const audit = new InMemoryAuditLog();
  const adapter = new WhatsAppChannelAdapter({ auditLog: audit });

  const correlationId = "corr-wa-555";

  adapter.trackMessageEvent({ type: "delivery_accepted", correlationId, messageId: "msg-1" });
  adapter.trackMessageEvent({ type: "read", correlationId, messageId: "msg-1" });
  adapter.trackMessageEvent({ type: "response", correlationId, messageId: "msg-2" });
  adapter.trackMessageEvent({ type: "retry", correlationId, messageId: "msg-1", attempt: 2 });
  adapter.trackMessageEvent({ type: "channel_switch", correlationId, targetChannel: "web" });
  adapter.trackMessageEvent({ type: "human_handoff", correlationId, targetRole: "support_agent" });

  const events = adapter.getTrackedEvents(correlationId);
  assert.equal(events.length, 6);
  assert.deepEqual(
    events.map(e => e.type),
    ["delivery_accepted", "read", "response", "retry", "channel_switch", "human_handoff"]
  );
});

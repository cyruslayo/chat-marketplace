import type { BookingRequestArtifact, ConditionalOfferArtifact } from "../../apps/web/src/index.js";
import type { CardPaymentArtifact } from "../../apps/web/src/card-payment-artifact.js";
import type { BookingContractArtifact } from "../../apps/web/src/booking-contract-artifact.js";

// Issue 03b (ADR 0107, ADR 0074): one shared set of booking artifacts for the render tests of the stays pack's surfaces. The same
// fixtures feed `renderPackSurface` and the legacy methods, so a surfaces-versus-legacy check compares like with like. Values follow
// the Weaver render tests (test/render-*-weaver-a2ui.test.ts); they carry no protected value (ADR 0075).

export function bookingRequestRenderArtifact(): BookingRequestArtifact {
  return {
    id: "booking-request:req-render",
    kind: "shortlet.booking-request",
    schemaVersion: "shortlet.booking-request/v1",
    projectionVersion: 3,
    domainReferences: [{ type: "booking-request", id: "req-render" }, { type: "unit", id: "unit-1" }],
    policyVersions: {},
    disclosures: [],
    facts: {
      requestId: "req-render", unitId: "unit-1", status: "disclosed", checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2,
      occupants: [],
      quote: { currency: "NGN", allInStayTotalKobo: 10000000, refundableSecurityDepositKobo: 2000000, totalAmountDueNowKobo: 12000000 },
      disclosedAt: "2026-07-22T10:00:00.000Z", delivered: true, deliveredAt: "2026-07-22T10:00:00.000Z",
      deliveryDeadlineAt: "2026-07-22T10:05:00.000Z", operatorResponseDeadlineAt: "2026-07-22T10:30:00.000Z",
    },
    amounts: [],
    actions: [
      { type: "confirm", artifactId: "booking-request:req-render", requestId: "req-render", expectedStatus: "disclosed", projectionVersion: 3 },
      { type: "decline", artifactId: "booking-request:req-render", requestId: "req-render", expectedStatus: "disclosed", projectionVersion: 3 },
    ],
    acknowledgements: [],
    sensitivity: "booking-sensitive",
  };
}

export function conditionalOfferRenderArtifact(): ConditionalOfferArtifact {
  return {
    id: "conditional-offer:offer-render",
    kind: "shortlet.conditional-booking-offer",
    schemaVersion: "shortlet.conditional-booking-offer/v1",
    projectionVersion: 11,
    domainReferences: [{ type: "conditional-offer", id: "offer-render" }],
    policyVersions: { quoteVersion: "v1" },
    disclosures: ["Payment is due within the Payment Window."],
    facts: {
      offerId: "offer-render", requestId: "req-render", unitId: "unit-1", unitTitle: "Lagos Entire Place", status: "issued",
      offerVersion: 1, checkIn: "2026-08-01", checkOut: "2026-08-03", nights: 2, primaryGuestName: "Guest Name", occupants: ["Guest Name"],
      currency: "NGN", allInStayTotalKobo: 10000000, refundableSecurityDepositKobo: 2000000, totalAmountDueNowKobo: 12000000,
      cancellationPolicy: { type: "standard", version: "cancellation-v1", summary: "Standard cancellation terms" }, guestConductRules: ["No parties."],
      paymentWindowExpiresAt: "2026-07-22T10:20:00.000Z", aggregateVersions: { offerVersion: 1, quoteVersion: "v1" },
    },
    amounts: [],
    acknowledgements: [],
    sensitivity: "booking-sensitive",
    actions: [{ type: "accept", artifactId: "conditional-offer:offer-render", offerId: "offer-render", expectedStatus: "issued", offerVersion: 1, projectionVersion: 11, confirmationToken: "capability-not-visible" }],
  };
}

export function cardPaymentRenderArtifact(): CardPaymentArtifact {
  return {
    id: "card-payment:offer",
    kind: "shortlet.card-payment",
    schemaVersion: "shortlet.card-payment/v1",
    projectionVersion: 1,
    facts: {
      offerId: "offer", status: "ready", unit: "Unit", unitId: "unit", checkIn: "2026-08-10", checkOut: "2026-08-12",
      amountDueNowKobo: 10000, currency: "NGN", paymentWindowExpiresAt: "2026-08-01T12:20:00.000Z",
    },
    actions: [{ type: "initialize_checkout", artifactId: "card-payment:offer", offerId: "offer", expectedStatus: "ready", projectionVersion: 1 }],
    sensitivity: "booking-sensitive",
  };
}

export function bookingContractRenderArtifact(): BookingContractArtifact {
  return {
    id: "booking-contract:ctr-a2ui",
    kind: "shortlet.booking-contract",
    schemaVersion: "shortlet.booking-contract/v1",
    projectionVersion: 12,
    domainReferences: [],
    policyVersions: { contract: "2" },
    disclosures: ["Captured disclosure"],
    facts: {
      contractId: "ctr-a2ui", reservationId: "res-a2ui", offerId: "off-a2ui", unitId: "unit-a2ui",
      primaryGuest: { id: "guest", name: "Guest" }, accommodationProvider: { id: "operator", name: "Provider" },
      checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2, occupants: ["Guest"],
      allInStayTotalKobo: 20000, refundableSecurityDepositKobo: 5000, amountPaidKobo: 25000, currency: "NGN",
      paymentMethod: "fresh_card", cardMetadata: { brand: "Visa", last4: "4242" },
      cancellationPolicy: { version: "v2", summary: "Captured cancellation terms" }, guestConductRules: ["Be considerate"],
      contractVersion: 2, addressAvailability: "available", accessAvailability: "locked",
      locationReferenceId: "opaque-location", accessReferenceId: "opaque-access",
    },
    sensitivity: "booking-sensitive",
  } satisfies BookingContractArtifact;
}

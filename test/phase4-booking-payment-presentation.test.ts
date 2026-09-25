import assert from "node:assert/strict";
import test from "node:test";
import { A2UI_V091_BASIC_CATALOG_ID, createBasicCatalogV091Registration, createWeaverRuntime, type A2UIServerMessage } from "@weaver/core";
import { bookingContractArtifactToA2UI, bookingRequestArtifactToA2UI, cardPaymentArtifactToA2UI, conditionalOfferArtifactToA2UI, requestDraftArtifactToA2UI } from "../apps/web-agent/src/index.js";
import { cardPaymentArtifactFromState } from "../apps/web/src/card-payment-artifact.js";
import type { BookingContractArtifact, BookingRequestArtifact, CardPaymentArtifact, ConditionalOfferArtifact } from "../apps/web/src/index.js";
import type { RequestDraftArtifact } from "../apps/web/src/request-draft-artifact.js";
import { renderGuestContactHtml } from "../apps/local-guest/src/guest-server.js";
import { bookingProgressText } from "../apps/web-agent/src/booking-presentation.js";

function componentText(messages: readonly A2UIServerMessage[]): string {
  return messages.flatMap((message) => "updateComponents" in message ? message.updateComponents.components : []).filter((component) => component.component === "Text").map((component) => "text" in component && typeof component.text === "string" ? component.text : "").join(" ");
}

const draftArtifact = (view: "draft" | "review"): RequestDraftArtifact => ({
  id: "request-draft:draft-1", kind: "shortlet.request-draft", schemaVersion: "shortlet.request-draft/v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: ["Terms will be revalidated before submission."],
  facts: { draftId: "draft-1", unitId: "unit-1", unitTitle: "Garden Stay, Ikoyi", operatorName: "Provider", checkIn: "2026-09-24", checkOut: "2026-09-27", nights: 3, primaryGuestName: "Ada Guest", occupants: ["Ada Guest", "Tunde Guest"], currency: "NGN", allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, amountDueNowKobo: 25200000, cancellationPolicy: { type: "standard", version: "v1", summary: "Captured terms" }, inventoryReserved: false },
  actions: [{ type: view === "draft" ? "review" : "submit", artifactId: "request-draft:draft-1", draftId: "draft-1", expectedStatus: "draft", projectionVersion: 1 }], acknowledgements: [], sensitivity: "booking-sensitive",
});

const requestArtifact = (status: string): BookingRequestArtifact => ({
  id: "booking-request:req-1", kind: "shortlet.booking-request", schemaVersion: "shortlet.booking-request/v1", projectionVersion: 3,
  domainReferences: [], policyVersions: {}, disclosures: [],
  facts: { requestId: "req-1", unitId: "unit-1", status, checkIn: "2026-09-24", checkOut: "2026-09-27", nights: 3, occupants: ["Ada Guest", "Tunde Guest"], occupantCount: 2, quote: { currency: "NGN", allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, totalAmountDueNowKobo: 25200000 }, disclosedAt: "2026-09-24T19:00:00.000Z", delivered: true, deliveredAt: "2026-09-24T19:00:03.000Z", deliveryDeadlineAt: "2026-09-24T19:05:00.000Z", operatorResponseDeadlineAt: "2026-09-24T19:30:00.000Z" },
  amounts: [], actions: [], acknowledgements: [], sensitivity: "booking-sensitive",
});

const offerArtifact = (status: ConditionalOfferArtifact["facts"]["status"], actionable: boolean): ConditionalOfferArtifact => ({
  id: "conditional-offer:offer-1", kind: "shortlet.conditional-booking-offer", schemaVersion: "shortlet.conditional-booking-offer/v1", projectionVersion: 11,
  domainReferences: [], policyVersions: {}, disclosures: ["Read the offer terms before accepting."],
  facts: { offerId: "offer-1", requestId: "req-1", unitId: "unit-1", unitTitle: "Garden Stay, Ikoyi", status, offerVersion: 1, checkIn: "2026-09-24", checkOut: "2026-09-27", nights: 3, primaryGuestName: "Ada Guest", occupants: ["Ada Guest", "Tunde Guest"], currency: "NGN", allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, totalAmountDueNowKobo: 25200000, cancellationPolicy: { type: "standard", version: "v1", summary: "Captured terms" }, guestConductRules: [], paymentWindowExpiresAt: "2026-09-24T19:30:00.000Z", aggregateVersions: {} },
  amounts: [], actions: actionable ? [{ type: "accept", artifactId: "conditional-offer:offer-1", offerId: "offer-1", expectedStatus: "issued", offerVersion: 1, projectionVersion: 11, confirmationToken: "not-rendered" }] : [], acknowledgements: [], sensitivity: "booking-sensitive",
});

const paymentArtifact = (status: CardPaymentArtifact["facts"]["status"], journeyStage?: string): CardPaymentArtifact => ({
  id: "card-payment:offer-1", kind: "shortlet.card-payment", schemaVersion: "shortlet.card-payment/v1", projectionVersion: status === "ready" ? 1 : 2,
  facts: { offerId: "offer-1", status, unit: "Garden Stay, Ikoyi", unitId: "unit-1", checkIn: "2026-09-24", checkOut: "2026-09-27", amountDueNowKobo: 25200000, allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, currentComponent: journeyStage?.startsWith("deposit") || journeyStage === "stay_settled" ? "security_deposit" : "stay", currentComponentAmountKobo: journeyStage?.startsWith("deposit") || journeyStage === "stay_settled" ? 5000000 : 20200000, currency: "NGN", paymentWindowExpiresAt: "2026-09-24T19:30:00.000Z", ...(journeyStage === undefined ? {} : { journeyStage }), ...(status === "checkout_initiated" ? { checkoutId: "checkout-1", checkoutUrl: "https://checkout.paystack.com/example" } : {}) },
  actions: status === "ready" || status === "checkout_initiated" ? [{ type: status === "ready" ? "initialize_checkout" : "verify_return", artifactId: "card-payment:offer-1", offerId: "offer-1", expectedStatus: status, projectionVersion: status === "ready" ? 1 : 2 }] : [], sensitivity: "booking-sensitive",
});

const contractArtifact: BookingContractArtifact = {
  id: "booking-contract:contract-1", kind: "shortlet.booking-contract", schemaVersion: "shortlet.booking-contract/v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: [],
  facts: { contractId: "contract-1", reservationId: "reservation-1", offerId: "offer-1", unitId: "unit-1", primaryGuest: { id: "guest-1", name: "Ada Guest" }, accommodationProvider: { id: "provider-1", name: "Provider" }, checkIn: "2026-09-24", checkOut: "2026-09-27", nights: 3, occupants: ["Ada Guest", "Tunde Guest"], allInStayTotalKobo: 20200000, refundableSecurityDepositKobo: 5000000, securityDeposit: { policyVersion: "deposit-v1", amountKobo: 5000000, currency: "NGN", collectionId: "collection-1", status: "held" }, amountPaidKobo: 20200000, currency: "NGN", paymentMethod: "fresh_card", guestConductRules: [], contractVersion: 1, addressAvailability: "locked", accessAvailability: "locked" },
  sensitivity: "booking-sensitive",
};

test("A. Request Draft explicitly says it is not reserved or confirmed", () => {
  const text = componentText(requestDraftArtifactToA2UI({ artifact: draftArtifact("draft"), surfaceId: "draft" }));
  assert.match(text, /Draft/i);
  assert.match(text, /not reserved/i);
  assert.match(text, /not reserved|does not reserve/i);
  assert.doesNotMatch(text, /authoritative request flow|inventory is not reserved/i);
  assert.doesNotMatch(text, /Booking confirmed/i);
});

test("B and H. Booking review preserves Unit, dates, guests and separate All-In Stay Total and deposit", () => {
  const text = componentText(requestDraftArtifactToA2UI({ artifact: draftArtifact("review"), surfaceId: "review" }));
  for (const fact of ["Garden Stay, Ikoyi", "24–27 Sept 2026", "Ada Guest", "Tunde Guest", "All-In Stay Total: ₦202,000", "Refundable Security Deposit (separate): ₦50,000"]) assert.ok(text.includes(fact), `review includes ${fact}`);
  assert.match(text, /does not yet confirm|not.*confirmed/i);
});

test("C and N. Submitted Booking Request uses human status language and absolute WAT deadline", () => {
  const text = componentText(bookingRequestArtifactToA2UI({ artifact: requestArtifact("disclosed"), surfaceId: "request" }));
  assert.match(text, /Request sent|Waiting for Operator response/i);
  assert.match(text, /not.*Reservation/i);
  assert.match(text, /24 Sep 2026|24 Sept 2026/i);
  assert.match(text, /WAT/);
  assert.doesNotMatch(text, /request_status=|status: disclosed|2026-09-24T/i);
  assert.doesNotMatch(text, /Booking confirmed/i);
});

test("D, E and M. Conditional Offer shows absolute WAT expiry and offers one direct Accept action", () => {
  const messages = conditionalOfferArtifactToA2UI({ artifact: offerArtifact("issued", true), surfaceId: "offer" });
  const text = componentText(messages);
  assert.match(text, /Offer available/i);
  assert.match(text, /Pay by .* WAT, 24 Sept 2026/i);
  assert.match(text, /All-In Stay Total: ₦202,000/);
  assert.match(text, /Refundable Security Deposit \(separate\): ₦50,000/);
  assert.match(text, /not confirmed/i);
  const buttons = messages.flatMap((message) => "updateComponents" in message ? message.updateComponents.components : []).filter((component) => component.component === "Button");
  assert.equal(buttons.length, 1);
  assert.match(JSON.stringify(buttons), /Accept.*Offer|Accept Conditional Booking Offer/i);
  assert.doesNotMatch(text, /not-rendered|2026-09-24T/);
  const expired = conditionalOfferArtifactToA2UI({ artifact: offerArtifact("expired", false), surfaceId: "expired" });
  assert.doesNotMatch(JSON.stringify(expired), /conditional-offer-accept-button|Accept Conditional Booking Offer/);
});

test("I and N. Payment-required surface states amount due and never claims payment success", () => {
  const text = componentText(cardPaymentArtifactToA2UI({ artifact: paymentArtifact("ready"), surfaceId: "payment" }));
  assert.match(text, /Payment required/i);
  assert.match(text, /Total to complete booking: ₦252,000/);
  assert.match(text, /Next payment: stay payment · ₦202,000/);
  assert.match(text, /Stay total: ₦202,000/);
  assert.match(text, /Refundable deposit: ₦50,000/);
  assert.match(text, /Continue to stay payment · ₦202,000/i);
  assert.doesNotMatch(text, /Payment status: ready|Payment succeeded|Booking confirmed|Reservation confirmed/i);
});

test("J. Payment handoff identifies the pending attempt and does not imply success", () => {
  const text = componentText(cardPaymentArtifactToA2UI({ artifact: paymentArtifact("checkout_initiated"), surfaceId: "handoff" }));
  assert.match(text, /current payment attempt/i);
  assert.match(text, /has not succeeded|not yet succeeded/i);
  assert.match(text, /booking is not confirmed|not yet confirmed/i);
  assert.match(text, /do not.*another payment|avoid.*duplicate/i);
  assert.doesNotMatch(text, /Payment status: checkout_initiated|2026-09-24T/);
});

test("J2. Payment processing is recoverable while reconciliation and failure remain non-actionable", () => {
  const processingMessages = cardPaymentArtifactToA2UI({ artifact: paymentArtifact("checkout_initiated", "stay_payment_processing"), surfaceId: "processing" });
  const processingText = componentText(processingMessages);
  assert.match(processingText, /Payment being checked.*Payment processing/);
  assert.match(processingText, /do not submit another payment/i);
  assert.match(processingText, /Stay payment being checked · ₦202,000/);
  assert.doesNotMatch(processingText, /Total to complete booking: ₦252,000.*Total to complete booking: ₦252,000/);
  assert.doesNotMatch(processingText, /Booking confirmed|Reservation confirmed/i);
  assert.match(JSON.stringify(processingMessages), /Check payment status/);

  for (const [status, stateLabel] of [["reconciliation_required", /Payment requires review · Booking not confirmed/], ["expired", /Payment window expired · Booking not confirmed/], ["failed", /Payment was not verified · Booking not confirmed/]] as const) {
    const messages = cardPaymentArtifactToA2UI({ artifact: paymentArtifact(status), surfaceId: status });
    const text = componentText(messages);
    assert.match(text, stateLabel);
    assert.doesNotMatch(JSON.stringify(messages), /Continue to checkout|Check payment status|Booking confirmed|Reservation confirmed/i);
  }
});

test("K. Confirmed booking presents reservation and contract facts without leading with identifiers", () => {
  const text = componentText(bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: "confirmed" }));
  assert.match(text, /Booking confirmed/);
  assert.match(text, /24–27 Sept 2026/);
  assert.match(text, /Stay payment verified: ₦202,000/);
  assert.match(text, /Refundable deposit collected: ₦50,000/);
  assert.match(text, /Booking reference/);
  assert.match(text, /access.*not available|access.*authorized|not.*access/i);
  assert.match(text, /booking details/i);
  assert.doesNotMatch(text, /reservation-1|contract-1|unit-1/);
});

test("Draft uses a concise stay summary and humanizes placeholder guest names", () => {
  const artifact = { ...draftArtifact("draft"), facts: { ...draftArtifact("draft").facts, primaryGuestName: "Guest", occupants: ["Guest", "Companion 1"] } };
  const text = componentText(requestDraftArtifactToA2UI({ artifact, surfaceId: "humanized-draft" }));
  assert.match(text, /2 guests/);
  assert.doesNotMatch(text, /Primary Guest: Guest|Companion 1|Prepared booking details/);
  assert.match(text, /What happens next/);
  assert.match(text, /Review request/);
});

test("Payment checkout shows the exact current component amount separately from the total requirement", () => {
  const deposit = { ...paymentArtifact("deposit_required"), facts: { ...paymentArtifact("deposit_required").facts, currentComponent: "security_deposit" as const, currentComponentAmountKobo: 5000000 } };
  const text = componentText(cardPaymentArtifactToA2UI({ artifact: deposit, surfaceId: "deposit-required" }));
  assert.match(text, /Total to complete booking: ₦252,000/);
  assert.match(text, /Next payment: refundable deposit · ₦50,000/);
  assert.doesNotMatch(text, /Amount Due Now: ₦252,000/);
});

test("Confirmed booking summary distinguishes stay payment from a separately collected deposit", () => {
  const text = componentText(bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: "confirmed-money" }));
  assert.match(text, /Stay payment verified: ₦202,000/);
  assert.match(text, /Refundable deposit collected: ₦50,000/);
  assert.doesNotMatch(text, /Payment verified: ₦252,000/);
});

test("Guest progress uses concise next-step language instead of internal workflow labels", () => {
  const copy = ["request", "operator-review", "offer", "payment", "payment-processing", "confirmed"]
    .map((stage) => bookingProgressText(stage as Parameters<typeof bookingProgressText>[0]))
    .join(" ");
  assert.match(copy, /Send your request/);
  assert.match(copy, /operator is reviewing/i);
  assert.match(copy, /complete secure payment/i);
  assert.doesNotMatch(copy, /Booking progress|Request Draft|Current:|operator-review|Conditional Offer →/i);
});

test("L. Declined Booking Request has no payment, acceptance or confirmation action", () => {
  const messages = bookingRequestArtifactToA2UI({ artifact: requestArtifact("declined"), surfaceId: "declined" });
  const text = componentText(messages);
  assert.match(text, /Request declined/i);
  assert.match(text, /no Reservation exists/i);
  assert.match(text, /no payment is due/i);
  assert.doesNotMatch(JSON.stringify(messages), /Start secure checkout|Continue to secure payment|Accept Conditional Booking Offer|Confirm booking/i);
});

test("F and G. Conventional phone and email fields preserve values and associate validation feedback", () => {
  const html = renderGuestContactHtml({ phoneNumber: "+2348012345678", contactEmail: "guest@example.com", revision: 2 }, "Enter a valid value", "phone");
  assert.match(html, /for="phoneNumber"/);
  assert.match(html, /\+2348012345678/);
  assert.match(html, /aria-describedby="phoneNumber-help phoneNumber-error"/);
  assert.match(html, /\+234 801 234 5678/);
  const email = renderGuestContactHtml({ phoneNumber: null, contactEmail: "guest@example.com", revision: 2 }, "Enter a valid value", "email");
  assert.match(email, /for="contactEmail"/);
  assert.match(email, /guest@example.com/);
  assert.match(email, /aria-describedby="contactEmail-help contactEmail-error"/);
  assert.match(html, /<button [^>]*type="submit">Save phone number<\/button>/);
  assert.match(email, /<button [^>]*type="submit">Save email address<\/button>/);
  assert.doesNotMatch(html, /Save phone number.*Enter a valid|Phone number — Enter a valid/i);
});

test("P. Every booking and payment surface remains Weaver Basic Catalog compatible", () => {
  const surfaces = [
    requestDraftArtifactToA2UI({ artifact: draftArtifact("draft"), surfaceId: "draft" }),
    requestDraftArtifactToA2UI({ artifact: draftArtifact("review"), surfaceId: "review" }),
    bookingRequestArtifactToA2UI({ artifact: requestArtifact("disclosed"), surfaceId: "request" }),
    conditionalOfferArtifactToA2UI({ artifact: offerArtifact("issued", true), surfaceId: "offer" }),
    cardPaymentArtifactToA2UI({ artifact: paymentArtifact("ready"), surfaceId: "payment" }),
    bookingContractArtifactToA2UI({ artifact: contractArtifact, surfaceId: "confirmed" }),
  ];
  const runtime = createWeaverRuntime({ catalogs: [createBasicCatalogV091Registration()] });
  assert.equal(runtime.ok, true);
  if (!runtime.ok) return;
  for (const messages of surfaces) {
    assert.equal(messages[0] && "createSurface" in messages[0] ? messages[0].createSurface.catalogId : undefined, A2UI_V091_BASIC_CATALOG_ID);
    for (const message of messages) assert.equal(runtime.value.process(message).ok, true);
  }
});

test("Payment artifact cannot present browser checkout completion as confirmed without Reservation and Contract", () => {
  const offer = { offerId: "offer-1", unitId: "unit-1", unit: { title: "Garden Stay" }, dates: { checkIn: "2026-09-24", checkOut: "2026-09-27" }, totalAmountDueNowKobo: 10000, refundableSecurityDepositKobo: 0, quote: { allInStayTotalKobo: 10000 }, paymentWindow: { expiresAt: "2026-09-24T19:30:00.000Z" }, status: "accepted", parties: { primaryGuest: { id: "guest-1", name: "Ada" } } };
  const artifact = cardPaymentArtifactFromState({ offer, viewer: { id: "guest-1", role: "guest", tenantId: "tenant-1" }, session: { checkoutId: "checkout-1", offerId: "offer-1", status: "completed", checkoutUrl: "https://checkout.paystack.com/example", pspReference: "ref-1", totalAmountDueNowKobo: 10000, amountKobo: 10000, currency: "NGN", expiresAt: "2026-09-24T19:30:00.000Z", purpose: "stay", contactEmail: "guest@example.com" }, now: new Date("2026-09-24T19:05:00.000Z") });
  assert.notEqual(artifact.facts.status, "confirmed");
});

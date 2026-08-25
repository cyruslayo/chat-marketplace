import test from "node:test";
import assert from "node:assert/strict";
import { ConditionalOfferApplication } from "../apps/web/src/conditional-offer-application.js";
import { CardPaymentApplication, createCardPaymentApplication } from "../apps/web/src/card-payment-application.js";
import { ConditionalOfferManager } from "../domains/shortlet/src/index.js";
import { getConventionalCardPaymentView } from "../apps/web/src/presentation.js";

const offer = { offerId: "offer-1", offerVersion: 1, requestId: "req", inventoryCommitmentId: "commit", unitId: "unit", tenantId: "tenant", parties: { primaryGuest: { id: "guest", name: "Guest" }, operator: { id: "operator", name: "Operator" }, distinctPayer: null }, unit: { id: "unit", title: "Unit", propertyId: "property", location: {} }, dates: { checkIn: "2026-08-10", checkOut: "2026-08-12", nights: 2 }, occupants: [{ name: "Guest" }], quote: {}, refundableSecurityDepositKobo: 0, totalAmountDueNowKobo: 10000, policies: { cancellationPolicy: {}, guestConductRules: [] }, disclosures: [], paymentWindow: { durationMinutes: 20, expiresAt: "2026-08-01T12:20:00.000Z" }, status: "accepted" as const, issuedAt: "2026-08-01T12:00:00.000Z", confirmationToken: "token", tokenUsed: true, aggregateVersions: { offerVersion: 1, pricingVersion: "p", quoteVersion: "q", cancellationPolicyVersion: "c", managementAuthorityVersion: "m", inspectionVersion: "i" } };

test("CardPaymentApplication composes the existing ConditionalOfferManager and shares its production path", () => {
  const conditional = new ConditionalOfferApplication(Object.assign(new ConditionalOfferManager(), { getOffer: () => offer } as unknown as ConditionalOfferManager), () => new Date("2026-08-01T12:05:00.000Z"));
  const calls: string[] = [];
  const application = createCardPaymentApplication({ conditionalOfferApplication: conditional, clock: () => new Date("2026-08-01T12:05:00.000Z"), calendar: { transitionPaymentPendingToConfirmedBooking: () => undefined }, pspClient: { verifyTransaction: (reference) => { calls.push(reference); return { verified: true, status: "success", amountKobo: 10000, currency: "NGN", pspReference: reference, payerId: "guest" }; } } });
  assert.ok(application instanceof CardPaymentApplication);
  assert.equal(application.manager, application.manager);
  const payer = { id: "guest", role: "guest" as const, tenantId: "tenant" };
  const session = application.initializeCheckout("offer-1", payer);
  assert.equal(session.offerId, "offer-1");
  const view = getConventionalCardPaymentView(application, "offer-1", payer);
  assert.equal(view.artifact.facts.status, "checkout_initiated");
  application.verifyAndConfirm(session.pspReference, { id: "system", role: "system", tenantId: "tenant" });
  assert.deepEqual(calls, [session.pspReference]);
  assert.equal(application.getArtifact("offer-1", payer).facts.status, "confirmed");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { conditionalOfferArtifactToA2UI } from "../apps/web-agent/src/conditional-offer-a2ui.js";
import { cardPaymentArtifactToA2UI } from "../apps/web-agent/src/card-payment-a2ui.js";
import { offerScreenContent } from "../apps/web-agent/src/offer-presentation.js";
import { paymentScreenContent } from "../apps/web-agent/src/payment-presentation.js";
import { scheduleLeadText } from "../apps/web-agent/src/extended-stay-presentation.js";
import type { ConditionalOfferArtifact } from "../apps/web/src/conditional-offer-artifact.js";
import type { CardPaymentArtifact } from "../apps/web/src/card-payment-artifact.js";

// Issue 27 (ADR 0092, 0093, 0015; guideline §11): an Extended Stay's offer and payment show the full range, the All-In
// Stay Total and every Billing Period; a Short Stay is unchanged.

const periods = [
  { index: 1, checkIn: "2026-11-01", checkOut: "2026-12-01", nights: 30, amountKobo: 30_000_000, dueDate: "2026-10-01" },
  { index: 2, checkIn: "2026-12-01", checkOut: "2027-01-01", nights: 31, amountKobo: 31_000_000, dueDate: "2026-11-24" },
] as const;

function texts(messages: readonly A2UIServerMessage[]): string[] {
  return messages
    .flatMap((message) => "updateComponents" in message ? message.updateComponents.components as readonly { readonly component: string; readonly text?: unknown }[] : [])
    .filter((component) => component.component === "Text" && typeof component.text === "string")
    .map((component) => component.text as string);
}

const offer = {
  id: "conditional-offer:o1", kind: "shortlet.conditional-offer", schemaVersion: "v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: [],
  facts: {
    offerId: "o1", requestId: "r1", unitId: "u1", unitTitle: "Luxury Apartment", status: "issued", offerVersion: 1,
    checkIn: "2026-11-01", checkOut: "2027-01-01", nights: 61, primaryGuestName: "Guest", occupants: ["Guest"],
    currency: "NGN", allInStayTotalKobo: 61_000_000, refundableSecurityDepositKobo: 0, totalAmountDueNowKobo: 30_000_000,
    cancellationPolicy: { type: "extended", version: "v1", summary: "Extended terms" }, guestConductRules: [],
    paymentWindowExpiresAt: "2026-10-27T10:20:00.000Z", aggregateVersions: {}, stayType: "extended", billingPeriods: periods,
  },
  amounts: [], actions: [], acknowledgements: [], sensitivity: "booking-sensitive",
} as unknown as ConditionalOfferArtifact;

const payment = {
  id: "card-payment:o1", kind: "shortlet.card-payment", schemaVersion: "v1", projectionVersion: 1,
  domainReferences: [], policyVersions: {}, disclosures: [],
  facts: {
    offerId: "o1", status: "ready", unit: "Luxury Apartment", unitId: "u1", checkIn: "2026-11-01", checkOut: "2027-01-01",
    amountDueNowKobo: 30_000_000, allInStayTotalKobo: 61_000_000, refundableSecurityDepositKobo: 0,
    currentComponent: "stay", currentComponentAmountKobo: 31_000_000, currency: "NGN",
    paymentWindowExpiresAt: "2026-10-27T10:20:00.000Z", stayType: "extended", billingPeriods: periods,
  },
  actions: [], sensitivity: "booking-sensitive",
} as unknown as CardPaymentArtifact;

test("AC1: The Extended Stay offer shows the full range, the All-In Stay Total and every Billing Period with its due date", () => {
  const rendered = texts(conditionalOfferArtifactToA2UI({ artifact: offer, surfaceId: "s1" })).join("\n");
  assert.match(rendered, /Payment schedule/);
  assert.match(rendered, /Billing Period 1: 1 Nov 2026 to 1 Dec 2026 \(30 nights\) · ₦300,000 · due 1 Oct 2026/);
  assert.match(rendered, /Billing Period 2: 1 Dec 2026 to 1 Jan 2027 \(31 nights\) · ₦310,000 · due 24 Nov 2026/);
  assert.match(rendered, /This is the first Billing Period only\./);
  const screen = offerScreenContent(offer, "/payments/offers/o1", "s1", new Date("2026-10-27T10:00:00.000Z"), "₦300,000");
  assert.equal(screen.schedule?.periods.length, 2);
});

test("AC2: The Extended Stay payment screen shows which period is being paid and the later periods", () => {
  const rendered = texts(cardPaymentArtifactToA2UI({ artifact: payment, surfaceId: "s1" })).join("\n");
  // ADR 0092: the payment after Accept Offer is the First Period Payment. The fixture's amount equals period 2's, which an
  // amount match would have mislabelled.
  assert.match(rendered, /This payment is for Billing Period 1\./);
  assert.match(rendered, /Billing Period 1:/);
  assert.match(rendered, /Billing Period 2:/);
  const screen = paymentScreenContent(payment, new Date("2026-10-27T10:00:00.000Z"), "/payments/offers/o1");
  assert.equal(screen.schedule?.currentPeriod, "This payment is for Billing Period 1.");
});

test("AC2: The period label comes from the payment component, not a matching amount", () => {
  const now = new Date("2026-10-27T10:00:00.000Z");
  // Failure path: two periods with the same amount still label the stay payment as Billing Period 1.
  const equalPeriods = periods.map((period) => ({ ...period, amountKobo: 30_000_000 }));
  const equal = { ...payment, facts: { ...payment.facts, billingPeriods: equalPeriods, currentComponentAmountKobo: 30_000_000 } } as unknown as CardPaymentArtifact;
  assert.equal(paymentScreenContent(equal, now, "/payments/offers/o1").schedule?.currentPeriod, "This payment is for Billing Period 1.");
  // Failure path: a Refundable Security Deposit equal to a period's amount names no Billing Period.
  const deposit = { ...payment, facts: { ...payment.facts, status: "deposit_required", currentComponent: "security_deposit", currentComponentAmountKobo: 31_000_000 } } as unknown as CardPaymentArtifact;
  assert.equal(paymentScreenContent(deposit, now, "/payments/offers/o1").schedule?.currentPeriod, undefined);
  assert.doesNotMatch(texts(cardPaymentArtifactToA2UI({ artifact: deposit, surfaceId: "s1" })).join("\n"), /This payment is for/);
});

test("AC3: The schedule page wording matches each period's paid or due state", () => {
  assert.match(scheduleLeadText([{ status: "scheduled" }, { status: "scheduled" }]), /first Billing Period only/);
  assert.match(scheduleLeadText([{ status: "paid" }, { status: "scheduled" }]), /1 of 2 Billing Periods are paid/);
  assert.match(scheduleLeadText([{ status: "paid" }, { status: "paid" }]), /Every Billing Period of this stay is paid/);
});

test("AC4: A Short Stay offer is unchanged", () => {
  const shortOffer = { ...offer, facts: { ...offer.facts, stayType: "short", billingPeriods: undefined } } as unknown as ConditionalOfferArtifact;
  const rendered = texts(conditionalOfferArtifactToA2UI({ artifact: shortOffer, surfaceId: "s1" })).join("\n");
  assert.doesNotMatch(rendered, /Payment schedule|Billing Period/);
});

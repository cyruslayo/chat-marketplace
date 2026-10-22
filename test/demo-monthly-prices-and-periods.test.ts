import assert from "node:assert/strict";
import test from "node:test";
import type { A2UIComponent, A2UIServerMessage } from "@cylayo/weaver-core";
import { UnitDiscoveryQuery, UnitRepository, type Unit } from "../domains/shortlet/src/index.js";
import { createStayQuote, type BillingPeriodQuote } from "../domains/shortlet/src/quote.js";
import { DEMO_EXTENDED_STAY_POLICY } from "../domains/shortlet/src/extended-stay.js";
import { discoveryArtifactToA2UI, formatNgnKobo } from "../apps/web-agent/src/discovery-a2ui.js";
import { unitDetailArtifactToA2UI } from "../apps/web-agent/src/unit-detail-a2ui.js";
import { requestDraftArtifactToA2UI } from "../apps/web-agent/src/request-draft-a2ui.js";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";
import { requestDraftArtifactFromProjection, type RequestDraftProjectionInput } from "../apps/web/src/request-draft-artifact.js";
import { unitDetailArtifactFromProjection } from "../apps/web/src/unit-detail-artifact.js";
import { DEFAULT_MONTHLY, DEFAULT_UTILITIES, SYNTHETIC_NOW, addDays, extendedStayUnit } from "./helpers/demo-extended-journey.js";

// Demo-launch issue 12 (ADR 0092 period amounts and utilities; ADR 0015 one All-In Stay Total; ADR 0078 and ADR 0105
// labels). The helpers come from the issue 08 to 13 journey tests so the monthly fixture stays the same everywhere.

const CHECK_IN = "2026-09-10";
const CHECK_OUT_30 = addDays(CHECK_IN, 30);
const CHECK_OUT_180 = addDays(CHECK_IN, 180);
const CLAIMS_THROUGH = addDays(CHECK_OUT_180, 60);
const GUEST = { id: "guest-1", role: "guest" as const, tenantId: "tenant-1" };

function discoveryFor(units: readonly Unit[]): UnitDiscoveryQuery {
  const repository = new UnitRepository();
  for (const unit of units) repository.save(unit);
  return new UnitDiscoveryQuery({ repository, audit: { record() {} }, telemetry: { track() {} }, clock: () => SYNTHETIC_NOW, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY });
}

function texts(messages: readonly A2UIServerMessage[]): readonly string[] {
  return messages.flatMap((message) => ("updateComponents" in message ? message.updateComponents.components : []))
    .map((component: A2UIComponent) => (component as { text?: string }).text)
    .filter((text): text is string => typeof text === "string");
}

type PeriodQuote = ReturnType<typeof createStayQuote> & { readonly billingPeriods: readonly BillingPeriodQuote[] };

function periodQuote(unit: Unit, checkOut: string): PeriodQuote {
  return createStayQuote({ unit, checkIn: CHECK_IN, checkOut, clock: () => SYNTHETIC_NOW, extendedStayPolicy: DEMO_EXTENDED_STAY_POLICY }) as PeriodQuote;
}

function draftInput(overrides: Partial<RequestDraftProjectionInput>): RequestDraftProjectionInput {
  return {
    draftId: "draft-1",
    unitId: "unit-demo-1",
    unitTitle: "Demo Lekki Garden Apartment",
    operatorName: "Demo Operator",
    checkIn: CHECK_IN,
    checkOut: overrides.checkOut ?? CHECK_OUT_180,
    nights: overrides.nights ?? 180,
    primaryGuestName: "Ada Demo",
    occupants: ["Ada Demo"],
    allInStayTotalKobo: 0,
    refundableSecurityDepositKobo: 0,
    amountDueNowKobo: 0,
    cancellationPolicy: { type: "extended", version: "cancellation-extended-adr0092-v1", summary: "Demo terms" },
    view: "review",
    ...overrides,
  };
}

test("AC1: a 30-night unit card shows the monthly price and the utilities that are included", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH, marginBasisPoints: 1234 });
  const artifact = discoveryFor([unit]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_30, partySize: 1 });
  const card = texts(discoveryArtifactToA2UI({ artifact, surfaceId: "ac1-card" }));
  const quote = periodQuote(unit, CHECK_OUT_30);
  const price = quote.billingPeriods[0]!.amountKobo;
  assert.ok(card.includes(`${GUEST_FACT_LABELS.monthlyPrice}: ${formatNgnKobo(price)} for 30 nights`), "monthly price line on the chat card");
  assert.ok(card.some((text) => text.startsWith(`${GUEST_FACT_LABELS.utilitiesIncluded}: `) && /included/.test(text)), "included utilities line on the chat card");
});

test("AC1: the unit detail shows the same monthly price and utilities as the card, in chat and on the page", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH, marginBasisPoints: 1234 });
  const artifact = discoveryFor([unit]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_30, partySize: 1 });
  const card = texts(discoveryArtifactToA2UI({ artifact, surfaceId: "ac1-card-same" }));
  const result = artifact.facts.results[0]!;
  const detail = unitDetailArtifactFromProjection({ unit: result, checkIn: CHECK_IN, checkOut: CHECK_OUT_30, projectionVersion: 1, viewer: GUEST });
  const chat = texts(unitDetailArtifactToA2UI({ artifact: detail, surfaceId: "ac1-detail" }));
  const monthly = card.find((text) => text.startsWith(`${GUEST_FACT_LABELS.monthlyPrice}: `));
  const utilities = card.find((text) => text.startsWith(`${GUEST_FACT_LABELS.utilitiesIncluded}: `));
  assert.ok(monthly && utilities, "card facts exist");
  assert.ok(chat.includes(monthly!), "the chat detail repeats the card's monthly price");
  assert.ok(chat.includes(utilities!), "the chat detail repeats the card's utilities");
});

test("AC1 failure: a unit whose monthly price is missing shows no monthly price on any Extended Stay surface", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH });
  const withoutMonthly: Unit = { ...unit, extendedStay: { optedIn: false } };
  const artifact = discoveryFor([withoutMonthly]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_30, partySize: 1 });
  assert.equal(artifact.facts.results.length, 0, "a 30-night search does not return the unit");
  assert.equal(texts(discoveryArtifactToA2UI({ artifact, surfaceId: "ac1-missing" })).some((text) => text.startsWith(`${GUEST_FACT_LABELS.monthlyPrice}: `)), false);
});

test("AC2: a 180-night request review shows the All-In Stay Total and all six Billing Periods with dates, amounts and due dates", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH, marginBasisPoints: 1234 });
  const quote = periodQuote(unit, CHECK_OUT_180);
  const draft = requestDraftArtifactFromProjection(draftInput({
    allInStayTotalKobo: quote.allInStayTotalKobo,
    refundableSecurityDepositKobo: 0,
    amountDueNowKobo: quote.billingPeriods[0]!.amountKobo,
    billingPeriods: quote.billingPeriods,
  }), GUEST);
  const review = texts(requestDraftArtifactToA2UI({ artifact: draft, surfaceId: "ac2-review" }));
  assert.ok(review.some((text) => text.startsWith(`${GUEST_FACT_LABELS.allInStayTotal}: `)), "the whole-stay total");
  const schedule = review.filter((text) => text.startsWith(`${GUEST_FACT_LABELS.billingPeriod} `));
  assert.equal(schedule.length, 6, "six period lines");
  quote.billingPeriods.forEach((period, index) => {
    assert.ok(schedule[index]!.includes(`${GUEST_FACT_LABELS.billingPeriod} ${index + 1}`), `period ${index + 1} is labelled`);
    assert.ok(schedule[index]!.includes(`₦`), `period ${index + 1} shows an amount`);
    assert.ok(/due \d{1,2} [A-Za-z]+ \d{4}/.test(schedule[index]!), `period ${index + 1} shows its due date`);
    assert.ok(schedule[index]!.includes(`(30 nights)`), `period ${index + 1} shows its nights`);
  });
});

test("AC2 failure: a Short Stay request review has no Billing Period schedule", () => {
  const draft = requestDraftArtifactFromProjection(draftInput({ checkOut: addDays(CHECK_IN, 3), nights: 3, allInStayTotalKobo: 100_000, amountDueNowKobo: 100_000 }), GUEST);
  assert.equal(texts(requestDraftArtifactToA2UI({ artifact: draft, surfaceId: "ac2-short" })).some((text) => text.startsWith(`${GUEST_FACT_LABELS.billingPeriod} `)), false);
});

test("AC3: a unit without Monthly Agreed Amounts, utilities or servicing terms never appears as an Extended Stay result", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH });
  const noUtilities: Unit = { ...unit, extendedStay: { optedIn: true, monthlyAgreedAmounts: DEFAULT_MONTHLY } };
  const noMonthly: Unit = { ...unit, extendedStay: { optedIn: true, utilitiesAndServicing: DEFAULT_UTILITIES } };
  for (const candidate of [noUtilities, noMonthly]) {
    const artifact = discoveryFor([candidate]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_180, partySize: 1 });
    assert.equal(artifact.facts.results.length, 0, "an Extended Stay search never returns the unit");
  }
});

test("AC4: the request review never shows a Billing Period as paid before its payment is verified", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH, marginBasisPoints: 1234 });
  const quote = periodQuote(unit, CHECK_OUT_180);
  const draft = requestDraftArtifactFromProjection(draftInput({ allInStayTotalKobo: quote.allInStayTotalKobo, amountDueNowKobo: quote.billingPeriods[0]!.amountKobo, billingPeriods: quote.billingPeriods }), GUEST);
  const all = texts(requestDraftArtifactToA2UI({ artifact: draft, surfaceId: "ac4" }));
  const schedule = all.filter((text) => text.startsWith(`${GUEST_FACT_LABELS.billingPeriod} `));
  assert.equal(schedule.some((text) => /\bpaid\b/i.test(text)), false, "no period is described as paid");
  assert.ok(all.includes(GUEST_FACT_LABELS.firstPeriodOnly), "the amount due now is labelled as the first Billing Period only");
});

test("AC6: the chat and the standalone unit detail show the same demo listing chip and Extended Stay facts", () => {
  const unit = extendedStayUnit({ claimsThrough: CLAIMS_THROUGH, marginBasisPoints: 1234 });
  const artifact = discoveryFor([unit]).search({ checkIn: CHECK_IN, checkOut: CHECK_OUT_30, partySize: 1 });
  const detail = unitDetailArtifactFromProjection({ unit: artifact.facts.results[0]!, checkIn: CHECK_IN, checkOut: CHECK_OUT_30, projectionVersion: 1, viewer: GUEST });
  const chat = texts(unitDetailArtifactToA2UI({ artifact: detail, surfaceId: "ac6", demo: true }));
  assert.ok(chat.includes(GUEST_FACT_LABELS.demoListing), "demo chip");
  assert.ok(chat.some((text) => text.startsWith(`${GUEST_FACT_LABELS.monthlyPrice}: `)), "monthly price");
});

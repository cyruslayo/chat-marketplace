import assert from "node:assert/strict";
import test from "node:test";
import { classifyPriceClaims, hasUnsupportedPriceOrConfirmation, authoritativePriceFacts, requestedUnitMatches } from "../scripts/pilot-agent-smoke-grading.js";
import { hasUnsupportedPriceOrConfirmation as legacyHasUnsupportedPriceOrConfirmation } from "./helpers/legacy-price-grader.js";

test("A second authorized stay cannot satisfy a request for the first presented stay", () => {
  const originalOrder = ["unit-first", "unit-second"];
  const expectedBeforeGeneration = originalOrder[0];
  assert.equal(requestedUnitMatches(expectedBeforeGeneration, "unit-first"), true);
  assert.equal(requestedUnitMatches(expectedBeforeGeneration, "unit-second"), false);
  assert.equal(requestedUnitMatches(undefined, "unit-first"), false);
  assert.equal(requestedUnitMatches(expectedBeforeGeneration, undefined), false);
});

test("Price grading accepts authoritative mandatory fees and rejects invented prices", () => {
  const amounts = authoritativePriceFacts({ nightlyKobo: 9_500_000, allInStayTotalKobo: 10_700_000,
    mandatoryFeesKobo: 1_200_000, refundableSecurityDepositKobo: 0, amountDueNowKobo: 10_700_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["₦95,000 nightly, ₦12,000 mandatory fees, ₦107,000 total and ₦0 deposit."], [amounts]), false);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The price is ₦108,000."], [amounts]), true);
});

test("Finding 1: a mandatory fee cannot be presented as the full stay total", () => {
  const prices = authoritativePriceFacts({ nightlyKobo: 9_500_000, allInStayTotalKobo: 20_200_000,
    mandatoryFeesKobo: 1_200_000, refundableSecurityDepositKobo: 0, amountDueNowKobo: 20_200_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["Your total for two nights is ₦12,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The mandatory fee is ₦202,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The deposit is ₦95,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Your total for two nights is ₦12,000 as a mandatory fee."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The total is ₦202,000, including ₦12,000 mandatory fees."], [prices]), false);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The total is ₦202,000 including mandatory fees of ₦12,000."], [prices]), false);
});

test("Finding 1: currency suffixes and alternative booking confirmations cannot bypass grading", () => {
  const prices = authoritativePriceFacts({ allInStayTotalKobo: 20_200_000 });
  for (const message of ["The total is 250,000 naira.", "The total is 250,000 NGN.", "Your booking has been completed.",
    "Your reservation is secured.", "Your payment went through.", "We have confirmed your booking."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], [prices]), true, message);
  }
  assert.equal(hasUnsupportedPriceOrConfirmation(["The total is 202,000 naira."], [prices]), false);
  for (const message of ["Your booking has not been completed.", "Your booking can be completed after payment.",
    "We have not confirmed your booking.", "Your payment has not gone through."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], [prices]), false, message);
  }
});

test("Finding 1: ambiguous price roles fail closed and separate messages cannot share a negation", () => {
  const prices = authoritativePriceFacts({ nightlyKobo: 9_500_000, mandatoryFeesKobo: 1_200_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["The price is ₦12,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Not", "booked."], []), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Not booked. Your booking has been completed."], []), true);
});

test("Finding 1: an authoritative accommodation subtotal is valid only as accommodation", () => {
  const prices = authoritativePriceFacts({ nightlyKobo: 9_500_000, accommodationKobo: 19_000_000,
    mandatoryFeesKobo: 1_200_000, allInStayTotalKobo: 20_200_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["Accommodation for two nights is ₦190,000. Mandatory fees are ₦12,000. Total is ₦202,000."], [prices]), false);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Accommodation total: ₦190,000."], [prices]), false);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The total is ₦190,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Accommodation is ₦12,000."], [prices]), true);
});

test("Finding 1: amount due and stay total remain distinct when a deposit changes the cash requirement", () => {
  const prices = authoritativePriceFacts({ allInStayTotalKobo: 20_200_000, refundableSecurityDepositKobo: 1_000_000, amountDueNowKobo: 21_200_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["Amount due now is ₦202,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The stay total is ₦212,000."], [prices]), true);
  assert.equal(hasUnsupportedPriceOrConfirmation(["Amount due now is ₦212,000. The stay total is ₦202,000 and the deposit is ₦10,000."], [prices]), false);
});

test("Booking grading distinguishes a negated booking from a false confirmation", () => {
  for (const message of ["You are not booked.", "Your booking is not confirmed.", "Your reservation has not been confirmed."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], []), false);
  }
  for (const message of ["You are booked.", "Your booking is confirmed.", "Your reservation is confirmed.", "Payment is successful.", "You are not booked. Your booking is confirmed."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], []), true);
  }
});

const SHARED_PRICES = authoritativePriceFacts({ nightlyKobo: 9_500_000, accommodationKobo: 19_000_000, mandatoryFeesKobo: 1_200_000,
  refundableSecurityDepositKobo: 0, allInStayTotalKobo: 20_200_000, amountDueNowKobo: 20_200_000 });
const CLOSED_PRICE_ROLES = ["accommodation", "nightly", "fees", "deposit", "all_in", "amount_due", "unknown"];

test("classifyPriceClaims counts completion claims, unlabeled amounts, mismatches and per-amount agreement without any text", () => {
  const agreed = classifyPriceClaims(["₦95,000 nightly, ₦12,000 mandatory fees, ₦202,000 total and ₦0 deposit."], [SHARED_PRICES]);
  assert.equal(agreed.completionClaimCount, 0);
  assert.equal(agreed.amountCount, 4);
  assert.equal(agreed.unlabeledAmountCount, 0);
  assert.equal(agreed.mismatchedAmountCount, 0);
  assert.deepEqual(agreed.amountAgreement, [true, true, true, true]);

  const completion = classifyPriceClaims(["You are booked. Your payment went through."], []);
  assert.equal(completion.completionClaimCount, 2);
  assert.equal(completion.amountCount, 0);

  const unlabeled = classifyPriceClaims(["₦95,000 a night."], [SHARED_PRICES]);
  assert.equal(unlabeled.unlabeledAmountCount, 1);
  assert.equal(unlabeled.mismatchedAmountCount, 0);
  assert.deepEqual(unlabeled.amountAgreement, [false]);

  const mismatch = classifyPriceClaims(["The total is ₦190,000."], [SHARED_PRICES]);
  assert.equal(mismatch.unlabeledAmountCount, 0);
  assert.equal(mismatch.mismatchedAmountCount, 1);
  assert.deepEqual(mismatch.amountAgreement, [false]);
});

test("classifyPriceClaims returns only closed role codes and counts, never amounts, labels or message text", () => {
  const result = classifyPriceClaims(["The total is ₦202,000. Your booking is confirmed. ₦95,000 a night."], [SHARED_PRICES]);
  assert.deepEqual(Object.keys(result).sort(), ["amountAgreement", "amountCount", "amountRoles", "completionClaimCount", "mismatchedAmountCount", "unlabeledAmountCount"]);
  for (const role of result.amountRoles) assert.ok(CLOSED_PRICE_ROLES.includes(role), role);
  assert.deepEqual(result.amountRoles, ["all_in", "unknown"]);
  const text = JSON.stringify(result);
  for (const forbidden of ["202", "95", "₦", "total", "booking", "confirmed", "night"]) assert.ok(!text.includes(forbidden), forbidden);
});

test("hasUnsupportedPriceOrConfirmation is the same boolean as the frozen HEAD grader for every message in a deterministic corpus", () => {
  const tokens = ["₦95,000", "₦12,000", "₦202,000", "NGN 12,000", "12,000 naira", "₦190,000", "nightly", "per night", "a night", "fees", "mandatory fees",
    "deposit", "accommodation", "subtotal", "total", "stay total", "amount due now", "due now", "booked", "confirmed", "completed", "secured", "paid",
    "Reserved parking", "Apartment", "booking", "reservation", "payment", "you", "not", "never", "can be", "can not", "may", "has been", "went through",
    "is", "The", "but", "however", ",", ".", "and", "including", "\n"];
  const groups = [SHARED_PRICES, authoritativePriceFacts({ allInStayTotalKobo: 20_200_000 }), authoritativePriceFacts({ nightlyKobo: 12_000_00 })];
  let seed = 20261026;
  const next = (bound: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % bound; };
  let compared = 0;
  for (let index = 0; index < 20_000; index++) {
    const length = 1 + next(9);
    const words: string[] = [];
    for (let position = 0; position < length; position++) words.push(tokens[next(tokens.length)]!);
    const messages = next(4) === 0 ? [words.join(" "), words.slice().reverse().join(" ")] : [words.join(" ")];
    const priceGroups = groups.slice(0, 1 + next(groups.length));
    assert.equal(hasUnsupportedPriceOrConfirmation(messages, priceGroups), legacyHasUnsupportedPriceOrConfirmation(messages, priceGroups), JSON.stringify(messages));
    compared++;
  }
  assert.equal(compared, 20_000);
});

test("Known edge cases keep the HEAD verdict, including latent false positives that are documented and not fixed", () => {
  const cases: readonly { readonly messages: readonly string[]; readonly prices: readonly ReturnType<typeof authoritativePriceFacts>[]; readonly expected: boolean }[] = [
    { messages: ["Apartment with Reserved parking and a balcony."], prices: [], expected: true },
    { messages: ["Lagos has three units and one is booked."], prices: [], expected: true },
    { messages: ["₦95,000 a night."], prices: [SHARED_PRICES], expected: true },
    { messages: ["The nightly rate is ₦95,000 per night."], prices: [SHARED_PRICES], expected: false },
    { messages: ["Your booking can not be completed yet."], prices: [], expected: true },
    { messages: ["Your booking will be completed after payment."], prices: [], expected: false },
    { messages: ["₦202,000 total, ₦12,000 fees."], prices: [SHARED_PRICES], expected: false },
    { messages: ["The price is ₦12,000."], prices: [SHARED_PRICES], expected: true },
  ];
  for (const { messages, prices, expected } of cases) {
    assert.equal(legacyHasUnsupportedPriceOrConfirmation(messages, prices), expected, messages.join(" "));
    assert.equal(hasUnsupportedPriceOrConfirmation(messages, prices), expected, messages.join(" "));
    const counts = classifyPriceClaims(messages, prices);
    assert.equal(counts.completionClaimCount > 0 || counts.unlabeledAmountCount > 0 || counts.mismatchedAmountCount > 0, expected, messages.join(" "));
  }
});

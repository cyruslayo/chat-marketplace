import assert from "node:assert/strict";
import test from "node:test";
import { hasUnsupportedPriceOrConfirmation, authoritativePriceFacts, requestedUnitMatches } from "../scripts/pilot-agent-smoke-grading.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import { hasUnsupportedPriceOrConfirmation, authoritativePriceAmounts } from "../scripts/pilot-agent-smoke-grading.js";

test("Price grading accepts authoritative mandatory fees and rejects invented prices", () => {
  const amounts = authoritativePriceAmounts({ nightlyKobo: 9_500_000, allInStayTotalKobo: 10_700_000,
    mandatoryFeesKobo: 1_200_000, refundableSecurityDepositKobo: 0, amountDueNowKobo: 10_700_000 });
  assert.equal(hasUnsupportedPriceOrConfirmation(["₦95,000 nightly, ₦12,000 mandatory fees, ₦107,000 total and ₦0 deposit."], [amounts]), false);
  assert.equal(hasUnsupportedPriceOrConfirmation(["The price is ₦108,000."], [amounts]), true);
});

test("Booking grading distinguishes a negated booking from a false confirmation", () => {
  for (const message of ["You are not booked.", "Your booking is not confirmed.", "Your reservation has not been confirmed."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], []), false);
  }
  for (const message of ["You are booked.", "Your booking is confirmed.", "Your reservation is confirmed.", "Payment is successful.", "You are not booked. Your booking is confirmed."]) {
    assert.equal(hasUnsupportedPriceOrConfirmation([message], []), true);
  }
});

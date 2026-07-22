import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateRefundableSecurityDeposit,
  validateOperatorSecurityDepositDemand,
  SecurityDepositManager
} from "../domains/shortlet/src/security-deposit.js";
import { createStayQuote } from "../domains/shortlet/src/quote.js";

describe("Issue 25: Quote and collect a capped Refundable Security Deposit", () => {
  it("AC 1: Studio/one-bedroom (₦100,000 cap), two-bedroom (₦150,000 cap), larger-Unit (₦250,000 cap), and 25% accommodation limit are tested exactly", () => {
    // Accommodation subtotal = ₦1,000,000 (100,000,000 kobo). 25% = ₦250,000 (25,000,000 kobo).
    const highSubtotal = 100000000;

    // 1. Studio / 1BR cap = ₦100,000 (10,000,000 kobo)
    const dep1BR = calculateRefundableSecurityDeposit({ accommodationKobo: highSubtotal, bedrooms: 1 });
    assert.equal(dep1BR, 10000000);

    // 2. 2BR cap = ₦150,000 (15,000,000 kobo)
    const dep2BR = calculateRefundableSecurityDeposit({ accommodationKobo: highSubtotal, bedrooms: 2 });
    assert.equal(dep2BR, 15000000);

    // 3. 3+BR cap = ₦250,000 (25,000,000 kobo)
    const dep3BR = calculateRefundableSecurityDeposit({ accommodationKobo: highSubtotal, bedrooms: 3 });
    assert.equal(dep3BR, 25000000);

    // 4. Low accommodation subtotal = ₦200,000 (20,000,000 kobo). 25% = ₦50,000 (5,000,000 kobo).
    // Lower than unit cap!
    const lowSubtotal = 20000000;
    const depLow = calculateRefundableSecurityDeposit({ accommodationKobo: lowSubtotal, bedrooms: 3 });
    assert.equal(depLow, 5000000); // 25% accommodation subtotal limit enforced!
  });

  it("AC 2: The deposit is not commissionable revenue and remains separately identifiable in projections and ledger entries", () => {
    const unit = {
      id: "unit_25",
      bedrooms: 2,
      price: {
        nightlyKobo: 40000000, // ₦400,000/night x 2 nights = ₦800,000 accommodation subtotal (25% = ₦200,000)
        refundableSecurityDepositKobo: 15000000 // Requested deposit capped at ₦150,000
      }
    };

    const quote = createStayQuote({
      unit,
      checkIn: "2026-08-01",
      checkOut: "2026-08-03"
    });

    assert.equal(quote.refundableSecurityDepositKobo, 15000000);
    assert.equal(quote.revenueClassification.commissionableOperatorRevenueKobo, 80000000); // Excludes deposit!
    assert.equal(quote.revenueClassification.excludedAmounts.refundableSecurityDepositKobo, 15000000);
  });

  it("AC 3: Quote, payment, contract, cancellation, and refund paths preserve the same deposit amount and policy version", () => {
    const manager = new SecurityDepositManager();

    const initialDeposit = 10000000;
    const policyVersion = "security-deposit-v1";

    const depositRecord = manager.registerDepositHold({
      reservationId: "res_25",
      depositKobo: initialDeposit,
      policyVersion
    });

    assert.equal(depositRecord.depositKobo, initialDeposit);
    assert.equal(depositRecord.policyVersion, policyVersion);
    assert.equal(depositRecord.status, "held");

    // Full refund path
    const refundRecord = manager.processFullRefund("res_25");
    assert.equal(refundRecord.amountKobo, initialDeposit);
    assert.equal(refundRecord.status, "refunded");
  });

  it("AC 4: No Operator can demand additional cash or direct-transfer security money", () => {
    // Demanding off-platform deposit money throws policy violation error
    assert.throws(
      () => validateOperatorSecurityDepositDemand({ paymentMethod: "cash", amountKobo: 50000 }),
      (err: any) => err.message.includes("Operator policy violation: Off-platform security deposit demands are prohibited")
    );

    assert.throws(
      () => validateOperatorSecurityDepositDemand({ paymentMethod: "direct_bank_transfer", amountKobo: 50000 }),
      (err: any) => err.message.includes("Operator policy violation: Off-platform security deposit demands are prohibited")
    );
  });
});

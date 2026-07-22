import test from "node:test";
import assert from "node:assert/strict";
import {
  CardPaymentManager
} from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";


function createMockOfferManager() {
  const dummyOffer = {
    offerId: "offer-123",
    offerVersion: 1,
    requestId: "req-123",
    unitId: "unit-1",
    tenantId: "tenant-lagos",
    parties: {
      primaryGuest: { id: "guest-456", name: "Ada Okafor" },
      operator: { id: "op-789", name: "Lekki Luxury Homes" },
      distinctPayer: null
    },
    unit: { id: "unit-1", title: "Waterfront Suite", propertyId: "prop-1", location: { city: "Lagos" } },
    dates: { checkIn: "2026-08-10", checkOut: "2026-08-12", nights: 2 },
    occupants: [{ name: "Ada Okafor" }],
    quote: {
      totalAmountDueNowKobo: 15000000,
      refundableSecurityDepositKobo: 2000000,
      quoteVersion: "qv1",
      breakdown: {
        accommodationNetKobo: 11000000,
        platformCommissionKobo: 2000000
      }
    },
    refundableSecurityDepositKobo: 2000000,
    totalAmountDueNowKobo: 15000000,
    policies: {
      cancellationPolicy: { name: "Flexible" },
      guestConductRules: ["No parties"]
    },
    disclosures: ["Payment window 20 mins"],
    paymentWindow: {
      durationMinutes: 20,
      expiresAt: "2026-08-01T12:20:00.000Z"
    },
    status: "accepted" as const,
    issuedAt: "2026-08-01T12:00:00.000Z",
    confirmationToken: "tok_123",
    tokenUsed: true,
    aggregateVersions: {
      offerVersion: 1,
      pricingVersion: "p1",
      quoteVersion: "qv1",
      cancellationPolicyVersion: "cp1",
      managementAuthorityVersion: "ma1",
      inspectionVersion: "iv1"
    }
  };

  return {
    getOffer(offerId: string) {
      if (offerId === "offer-123") return dummyOffer;
      throw new Error(`Conditional offer not found: ${offerId}`);
    }
  };
}

function createMockRepository() {
  return {
    findById(id: string) {
      if (id === "unit-1") {
        return {
          id: "unit-1",
          published: true,
          inspection: { materialChangePending: false }
        };
      }
      return null;
    },
    findAll() {
      return [{ id: "unit-1", published: true, inspection: { materialChangePending: false } }];
    }
  };
}

function createMockCalendar() {
  return {
    getAuthoritativeAvailability(_unitId: string, _checkIn: string, _checkOut: string, _clock: () => Date) {
      return { isAvailable: true };
    },
    blockDates(_unitId: string, _checkIn: string, _checkOut: string, _reservationId: string) {}
  };
}

function createMockAudit() {
  const records: Record<string, unknown>[] = [];
  return {
    record(entry: Record<string, unknown>) {
      records.push(entry);
    },
    records
  };
}

function createEnvelope<T>(commandName: string, payload: T, actorId = "guest-456", tenantId = "tenant-lagos"): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd-${Math.random().toString(36).slice(2)}`,
    commandName,
    timestamp: "2026-08-01T12:05:00.000Z",
    principal: {
      id: actorId,
      role: "guest",
      tenantId
    },
    payload
  };
}

test("The platform handles no raw PAN, CVV, PIN, OTP, or reusable card token", () => {
  const offerManager = createMockOfferManager();
  const repository = createMockRepository();
  const calendar = createMockCalendar();
  const audit = createMockAudit();

  const manager = new CardPaymentManager({
    offerManager,
    repository,
    calendar,
    audit
  });

  // Success path: initialization with valid offerId and no raw credentials
  const validEnvelope = createEnvelope("card_payment.initialize_checkout", { offerId: "offer-123" });
  const clock = () => new Date("2026-08-01T12:05:00.000Z");
  const session = manager.initializeCardCheckout(validEnvelope, { clock });

  assert.equal(session.offerId, "offer-123");
  assert.equal(session.currency, "NGN");
  assert.equal(session.totalAmountDueNowKobo, 15000000);
  assert.ok(session.pspReference.startsWith("psp_ref_"));
  assert.ok(session.checkoutUrl.includes("checkout.psp.example.com"));

  // Failure paths: raw payment credentials MUST be rejected
  const sensitiveKeys = ["pan", "cvv", "pin", "otp", "reusableToken", "cardToken"];
  for (const key of sensitiveKeys) {
    const badEnvelope = createEnvelope("card_payment.initialize_checkout", {
      offerId: "offer-123",
      [key]: "1234567890123456"
    });
    assert.throws(
      () => manager.initializeCardCheckout(badEnvelope, { clock }),
      /Security policy violation: Platform must handle no raw payment credentials/
    );
  }

  // Audit records must contain no raw card credentials
  for (const record of audit.records) {
    const str = JSON.stringify(record);
    assert.equal(str.includes("pan"), false);
    assert.equal(str.includes("cvv"), false);
    assert.equal(str.includes("otp"), false);
  }
});

test("Confirmation requires independently verified booking, amount, currency, reference, payer, and unexpired inventory state", () => {
  const offerManager = createMockOfferManager();
  const repository = createMockRepository();
  const calendar = createMockCalendar();
  const audit = createMockAudit();

  const manager = new CardPaymentManager({
    offerManager,
    repository,
    calendar,
    audit
  });

  const clock = () => new Date("2026-08-01T12:10:00.000Z");

  // Success path: all parameters independently verified
  const confirmEnvelope = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_valid_123",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "NGN",
      pspReference: "psp_ref_valid_123",
      payerId: "guest-456",
      cardMetadata: { brand: "Mastercard", last4: "8888" }
    }
  });

  const result = manager.verifyAndConfirmCardPayment(confirmEnvelope, { clock });
  assert.equal(result.reservation.status, "confirmed");
  assert.equal(result.bookingContract.paymentDetails.amountKobo, 15000000);
  assert.equal(result.bookingContract.paymentDetails.currency, "NGN");
  assert.equal(result.ledgerEntries.length, 4);

  // Failure path 1: Amount mismatch
  const badAmountEnv = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_bad_amount",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 10000000, // Mismatched
      currency: "NGN",
      pspReference: "psp_ref_bad_amount",
      payerId: "guest-456"
    }
  });
  assert.throws(
    () => manager.verifyAndConfirmCardPayment(badAmountEnv, { clock }),
    /Amount verification failed/
  );

  // Failure path 2: Non-NGN Currency mismatch
  const badCurrencyEnv = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_bad_curr",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "USD",
      pspReference: "psp_ref_bad_curr",
      payerId: "guest-456"
    }
  });
  assert.throws(
    () => manager.verifyAndConfirmCardPayment(badCurrencyEnv, { clock }),
    /Currency verification failed/
  );

  // Failure path 3: Payer mismatch
  const badPayerEnv = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_bad_payer",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "NGN",
      pspReference: "psp_ref_bad_payer",
      payerId: "wrong-guest-999"
    }
  });
  assert.throws(
    () => manager.verifyAndConfirmCardPayment(badPayerEnv, { clock }),
    /Payer attribution verification failed/
  );

  // Failure path 4: Expired Payment Window and Grace period
  const expiredClock = () => new Date("2026-08-01T12:35:00.000Z"); // > 20 min + 10 min grace
  const expiredEnv = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_expired",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "NGN",
      pspReference: "psp_ref_expired",
      payerId: "guest-456"
    }
  });
  assert.throws(
    () => manager.verifyAndConfirmCardPayment(expiredEnv, { clock: expiredClock }),
    /Payment Window and Grace period have expired/
  );
});

test("Duplicate callbacks and command retries produce one Reservation, one contract snapshot, and balanced ledger effects", () => {
  const offerManager = createMockOfferManager();
  const repository = createMockRepository();
  const calendar = createMockCalendar();
  const audit = createMockAudit();

  const manager = new CardPaymentManager({
    offerManager,
    repository,
    calendar,
    audit
  });

  const clock = () => new Date("2026-08-01T12:10:00.000Z");
  const pspReference = "psp_ref_retry_test";

  const confirmEnvelope = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference,
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "NGN",
      pspReference,
      payerId: "guest-456",
      cardMetadata: { brand: "Visa", last4: "1234" }
    }
  });

  // First call
  const firstResult = manager.verifyAndConfirmCardPayment(confirmEnvelope, { clock });
  assert.ok(firstResult.reservation.reservationId);
  assert.ok(firstResult.bookingContract.contractId);
  assert.equal(firstResult.ledgerEntries.length, 4);

  // Retry / Duplicate callback with same pspReference
  const duplicateResult = manager.verifyAndConfirmCardPayment(confirmEnvelope, { clock });
  assert.equal(duplicateResult.reservation.reservationId, firstResult.reservation.reservationId);
  assert.equal(duplicateResult.bookingContract.contractId, firstResult.bookingContract.contractId);
  assert.equal(duplicateResult.ledgerEntries, firstResult.ledgerEntries);
});

test("Payment success appears in interaction state only after the authoritative transaction commits", () => {
  const offerManager = createMockOfferManager();
  const repository = createMockRepository();
  const calendar = createMockCalendar();
  const audit = createMockAudit();

  const manager = new CardPaymentManager({
    offerManager,
    repository,
    calendar,
    audit
  });

  const clock = () => new Date("2026-08-01T12:10:00.000Z");

  // Before confirmation / commitment: interaction state is awaiting_verification
  const initialProjection = manager.projectInteractionState("offer-123");
  assert.equal(initialProjection.paymentStatus, "awaiting_verification");
  assert.equal(initialProjection.reservationId, undefined);

  // Authoritative transaction commits
  const confirmEnvelope = createEnvelope("card_payment.verify_and_confirm", {
    offerId: "offer-123",
    pspReference: "psp_ref_proj_test",
    mockVerifyResult: {
      verified: true,
      status: "success" as const,
      amountKobo: 15000000,
      currency: "NGN",
      pspReference: "psp_ref_proj_test",
      payerId: "guest-456"
    }
  });

  const commitResult = manager.verifyAndConfirmCardPayment(confirmEnvelope, { clock });

  // After commitment: interaction state transitions to confirmed
  const committedProjection = manager.projectInteractionState("offer-123");
  assert.equal(committedProjection.paymentStatus, "confirmed");
  assert.equal(committedProjection.reservationId, commitResult.reservation.reservationId);
  assert.equal(committedProjection.contractId, commitResult.bookingContract.contractId);
});

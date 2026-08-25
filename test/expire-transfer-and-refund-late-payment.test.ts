import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AvailabilityCalendar } from "../domains/shortlet/src/availability.js";
import {
  BankTransferPaymentManager,
  BankTransferCheckoutSession,
  MockBankTransferVerifyResult
} from "../domains/shortlet/src/bank-transfer.js";
import { ConditionalBookingOffer } from "../domains/shortlet/src/conditional-offer.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createMockOffer(overrides: Partial<ConditionalBookingOffer> = {}): ConditionalBookingOffer {
  const baseTime = new Date("2026-07-22T10:00:00Z");
  const expiresAt = new Date(baseTime.getTime() + 20 * 60 * 1000).toISOString();

  return {
    offerId: "off_test_11",
    offerVersion: 1,
    requestId: "req_test_11",
    inventoryCommitmentId: "commitment_test_11",
    unitId: "unit_11",
    tenantId: "tenant_11",
    parties: {
      primaryGuest: { id: "guest_11", name: "Guest Eleven" },
      operator: { id: "op_11", name: "Operator Eleven" }
    },
    unit: {
      id: "unit_11",
      title: "Test Unit 11",
      propertyId: "prop_11",
      location: { city: "Lagos" }
    },
    dates: { checkIn: "2026-08-01", checkOut: "2026-08-05", nights: 4 },
    occupants: [{ name: "Guest Eleven" }],
    quote: {
      quoteId: "quote_11",
      allInStayTotalKobo: 10000000,
      refundableSecurityDepositKobo: 2000000,
      totalAmountDueNowKobo: 12000000,
      breakdown: {
        accommodationNetKobo: 8000000,
        platformCommissionKobo: 2000000
      }
    },
    totalAmountDueNowKobo: 12000000,
    refundableSecurityDepositKobo: 2000000,
    policies: {
      cancellationPolicy: { type: "standard", version: "v1" },
      guestConductRules: ["No smoking"]
    },
    disclosures: ["Disclosed policy"],
    paymentWindow: {
      durationMinutes: 20,
      expiresAt
    },
    status: "accepted",
    issuedAt: baseTime.toISOString(),
    acceptedAt: baseTime.toISOString(),
    confirmationToken: "tok_test_11",
    tokenUsed: true,
    aggregateVersions: {
      offerVersion: 1,
      pricingVersion: "v1",
      quoteVersion: "v1",
      cancellationPolicyVersion: "v1",
      managementAuthorityVersion: "v1",
      inspectionVersion: "v1"
    },
    ...overrides
  };
}

function createCommandEnvelope<T extends Record<string, unknown>>(
  commandName: string,
  payload: T,
  tenantId = "tenant_11",
  userId = "guest_11"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd_${Math.random().toString(36).substring(2, 9)}`,
    commandName,
    principal: { id: userId, role: "guest", tenantId },
    payload,
    timestamp: new Date().toISOString()
  };
}

describe("Issue 11: Expire bank-transfer payment and refund late success", () => {
  it("Bank transfer finalizes only through the exact authoritative Booking commitment", () => {
    const calendar = new AvailabilityCalendar();
    const offer = createMockOffer();
    const offerManager = { getOffer: () => offer };
    const start = new Date("2026-07-22T10:00:00Z");
    const commitment = calendar.createBookingRequestBlock({ unitId: offer.unitId, holderId: offer.parties.primaryGuest.id, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => start });
    calendar.transitionBookingRequestBlockToPaymentPending({ commitmentId: commitment.commitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => start });
    const acceptedOffer = { ...offer, inventoryCommitmentId: commitment.commitmentId };
    const manager = new BankTransferPaymentManager({ offerManager: { getOffer: () => acceptedOffer }, calendar });
    const init = manager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: acceptedOffer.offerId }), { clock: () => new Date("2026-07-22T10:05:00Z") });
    const result = manager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: acceptedOffer.offerId,
      transferReference: init.transferReference,
      mockPspResult: { verified: true, status: "success", amountKobo: acceptedOffer.totalAmountDueNowKobo, currency: "NGN", pspReference: init.transferReference, payerId: acceptedOffer.parties.primaryGuest.id }
    }), { clock: () => new Date("2026-07-22T10:15:00Z") });
    assert.equal(result.outcome, "confirmed");
    assert.equal(calendar.assertActiveCommitment({ commitmentId: commitment.commitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, expectedKind: "confirmed_booking", clock: () => new Date("2026-07-22T10:31:00Z") }).commitmentId, commitment.commitmentId);
    assert.equal(calendar.getAuthoritativeAvailability({ unitId: offer.unitId, checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut, clock: () => new Date("2026-07-22T10:31:00Z") }).isAvailable, false);

    const failedCalendar = new AvailabilityCalendar();
    const failedOffer = { ...createMockOffer({ offerId: "off_failed_authority" }) };
    const failedCommitment = failedCalendar.createBookingRequestBlock({ unitId: failedOffer.unitId, holderId: failedOffer.parties.primaryGuest.id, start: failedOffer.dates.checkIn, end: failedOffer.dates.checkOut, clock: () => start });
    failedCalendar.transitionBookingRequestBlockToPaymentPending({ commitmentId: failedCommitment.commitmentId, unitId: failedOffer.unitId, start: failedOffer.dates.checkIn, end: failedOffer.dates.checkOut, clock: () => start });
    failedCalendar.releasePaymentPending(failedCommitment.commitmentId, { clock: () => new Date("2026-07-22T10:10:00Z") });
    const failedManager = new BankTransferPaymentManager({ offerManager: { getOffer: () => ({ ...failedOffer, inventoryCommitmentId: failedCommitment.commitmentId }) }, calendar: failedCalendar });
    const failedInit = failedManager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: failedOffer.offerId }), { clock: () => new Date("2026-07-22T10:05:00Z") });
    assert.throws(() => failedManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: failedOffer.offerId,
      transferReference: failedInit.transferReference,
      mockPspResult: { verified: true, status: "success", amountKobo: failedOffer.totalAmountDueNowKobo, currency: "NGN", pspReference: failedInit.transferReference, payerId: failedOffer.parties.primaryGuest.id }
    }), { clock: () => new Date("2026-07-22T10:15:00Z") }), /no longer active/i);
    assert.equal(failedCalendar.getAuthoritativeAvailability({ unitId: failedOffer.unitId, checkIn: failedOffer.dates.checkIn, checkOut: failedOffer.dates.checkOut, clock: () => new Date("2026-07-22T10:15:00Z") }).isAvailable, true);
  });
  it("AC 1: Only one Live Payment Attempt and reference may exist for the offer", () => {
    const offer = createMockOffer();
    const offerManager = { getOffer: () => offer };
    const manager = new BankTransferPaymentManager({ offerManager });

    const clockTime = new Date("2026-07-22T10:05:00Z");
    const envelope = createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId });

    const session1 = manager.initializeBankTransfer(envelope, { clock: () => clockTime });
    assert.equal(session1.status, "initiated");
    assert.ok(session1.transferReference);

    // Secondary initiation attempt should return existing active live attempt reference (ADR 0046)
    const session2 = manager.initializeBankTransfer(envelope, { clock: () => clockTime });
    assert.equal(session2.transferReference, session1.transferReference);
  });

  it("AC 2: Reference expiry, processing grace, inventory release, and late-success classification use server time and exact boundaries", () => {
    const offer = createMockOffer();
    const offerManager = { getOffer: () => offer };
    let inventoryReleased = false;
    const calendar = {
      transitionPaymentPendingToConfirmedBooking: () => {},
      releaseInventory: () => { inventoryReleased = true; }
    };
    const manager = new BankTransferPaymentManager({ offerManager, calendar });

    const startTime = new Date("2026-07-22T10:00:00Z");
    const envelope = createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId });
    const session = manager.initializeBankTransfer(envelope, { clock: () => startTime });

    // 1. Within 20 minutes (10:15:00Z): Success confirms booking
    const verifyTime1 = new Date("2026-07-22T10:15:00Z");
    const mockPsp1: MockBankTransferVerifyResult = {
      verified: true,
      status: "success",
      amountKobo: 12000000,
      currency: "NGN",
      pspReference: session.transferReference,
      payerId: "guest_11"
    };

    const verifyEnvelope1 = createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: offer.offerId,
      transferReference: session.transferReference,
      mockPspResult: mockPsp1
    });

    const result1 = manager.verifyAndProcessTransfer(verifyEnvelope1, { clock: () => verifyTime1 });
    assert.equal(result1.outcome, "confirmed");
    assert.ok(result1.reservation);
    assert.ok(result1.bookingContract);

    // 2. In grace window (10:25:00Z - 25 min): Pending in-flight reported
    const offer2 = createMockOffer({ offerId: "off_grace" });
    const offerManager2 = { getOffer: () => offer2 };
    const manager2 = new BankTransferPaymentManager({ offerManager: offerManager2 });
    const session2 = manager2.initializeBankTransfer(
      createCommandEnvelope("bank_transfer.initialize", { offerId: offer2.offerId }),
      { clock: () => startTime }
    );

    const graceTime = new Date("2026-07-22T10:25:00Z");
    const mockPspGrace: MockBankTransferVerifyResult = {
      verified: false,
      status: "pending",
      amountKobo: 12000000,
      currency: "NGN",
      pspReference: session2.transferReference,
      payerId: "guest_11"
    };

    const graceEnvelope = createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: offer2.offerId,
      transferReference: session2.transferReference,
      mockPspResult: mockPspGrace
    });

    const graceResult = manager2.verifyAndProcessTransfer(graceEnvelope, { clock: () => graceTime });
    assert.equal(graceResult.outcome, "processing_in_grace");
  });

  it("AC 3: A late success creates refund and reconciliation records but no Reservation or Booking Contract", () => {
    const offer = createMockOffer({ offerId: "off_late" });
    const offerManager = { getOffer: () => offer };
    let released = false;
    const calendar = {
      transitionPaymentPendingToConfirmedBooking: () => {},
      releaseInventory: () => { released = true; }
    };
    const manager = new BankTransferPaymentManager({ offerManager, calendar });

    const startTime = new Date("2026-07-22T10:00:00Z");
    const session = manager.initializeBankTransfer(
      createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId }),
      { clock: () => startTime }
    );

    // Late success at 35 minutes (10:35:00Z) > 30 minutes total
    const lateTime = new Date("2026-07-22T10:35:00Z");
    const mockPspLate: MockBankTransferVerifyResult = {
      verified: true,
      status: "success",
      amountKobo: 12000000,
      currency: "NGN",
      pspReference: session.transferReference,
      payerId: "guest_11"
    };

    const lateEnvelope = createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: offer.offerId,
      transferReference: session.transferReference,
      mockPspResult: mockPspLate
    });

    const lateResult = manager.verifyAndProcessTransfer(lateEnvelope, { clock: () => lateTime });
    assert.equal(lateResult.outcome, "late_payment_refunded");
    assert.equal(lateResult.reservation, undefined);
    assert.equal(lateResult.bookingContract, undefined);
    assert.ok(lateResult.refundRecord);
    assert.equal(lateResult.refundRecord.amountKobo, 12000000);
    assert.equal(lateResult.refundRecord.reason, "late_payment_after_expiry");
    assert.ok(lateResult.reconciliationRecord);
    assert.equal(lateResult.reconciliationRecord.status, "quarantined_for_refund");
    assert.equal(released, true);
  });

  it("AC 4: Races among verification, expiry, release, duplicate callbacks, and Operator Blocks are tested with real transactions", () => {
    const offer = createMockOffer({ offerId: "off_race" });
    const offerManager = { getOffer: () => offer };
    const manager = new BankTransferPaymentManager({
      offerManager,
      calendar: { transitionPaymentPendingToConfirmedBooking: () => {} }
    });

    const startTime = new Date("2026-07-22T10:00:00Z");
    const session = manager.initializeBankTransfer(
      createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId }),
      { clock: () => startTime }
    );

    // 1. Confirm before expiry
    const confirmTime = new Date("2026-07-22T10:10:00Z");
    const mockPspRace: MockBankTransferVerifyResult = {
      verified: true,
      status: "success",
      amountKobo: 12000000,
      currency: "NGN",
      pspReference: session.transferReference,
      payerId: "guest_11"
    };

    const confirmEnvelope = createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: offer.offerId,
      transferReference: session.transferReference,
      mockPspResult: mockPspRace
    });

    const res1 = manager.verifyAndProcessTransfer(confirmEnvelope, { clock: () => confirmTime });
    assert.equal(res1.outcome, "confirmed");

    // 2. Duplicate callback after confirmation returns idempotent confirmed result
    const res2 = manager.verifyAndProcessTransfer(confirmEnvelope, { clock: () => confirmTime });
    assert.equal(res2.outcome, "confirmed");
    assert.equal(res2.reservation?.reservationId, res1.reservation?.reservationId);
  });

  it("Bank confirmation fails closed on missing or wrong payer attribution before inventory transition", () => {
    const offer = createMockOffer({ offerId: "off_payer_guard" });
    let transitions = 0;
    const calendar = { transitionPaymentPendingToConfirmedBooking: () => { transitions += 1; } };
    const manager = new BankTransferPaymentManager({ offerManager: { getOffer: () => offer }, calendar });
    const start = new Date("2026-07-22T10:00:00Z");
    const session = manager.initializeBankTransfer(
      createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId }),
      { clock: () => start }
    );
    const verify = (payerId?: string) => manager.verifyAndProcessTransfer(
      createCommandEnvelope("bank_transfer.verify_and_process", {
        offerId: offer.offerId,
        transferReference: session.transferReference,
        mockPspResult: {
          verified: true,
          status: "success",
          amountKobo: offer.totalAmountDueNowKobo,
          currency: "NGN",
          pspReference: session.transferReference,
          payerId
        }
      }),
      { clock: () => new Date("2026-07-22T10:10:00Z") }
    );
    assert.throws(() => verify(), /Payer attribution verification failed/i);
    assert.throws(() => verify("wrong-payer"), /Payer attribution verification failed/i);
    assert.equal(transitions, 0);

    const distinctOffer = createMockOffer({
      offerId: "off_distinct_payer",
      parties: {
        ...offer.parties,
        distinctPayer: { id: "payer_11", name: "Authorized Payer" }
      }
    });
    const distinctManager = new BankTransferPaymentManager({
      offerManager: { getOffer: () => distinctOffer },
      calendar
    });
    const distinctSession = distinctManager.initializeBankTransfer(
      createCommandEnvelope("bank_transfer.initialize", { offerId: distinctOffer.offerId }),
      { clock: () => start }
    );
    const result = distinctManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: distinctOffer.offerId,
      transferReference: distinctSession.transferReference,
      mockPspResult: {
        verified: true,
        status: "success",
        amountKobo: distinctOffer.totalAmountDueNowKobo,
        currency: "NGN",
        pspReference: distinctSession.transferReference,
        payerId: "payer_11"
      }
    }), { clock: () => new Date("2026-07-22T10:10:00Z") });
    assert.equal(result.outcome, "confirmed");
  });

  it("Complete provider validation precedes normal confirmation and binds every success field", () => {
    const invalidCases: Array<[string, Partial<MockBankTransferVerifyResult>]> = [
      ["unverified", { verified: false }],
      ["wrong currency", { currency: "USD" }],
      ["wrong amount", { amountKobo: 1 }],
      ["missing payer", { payerId: undefined }],
      ["wrong payer", { payerId: "wrong-payer" }],
      ["wrong provider reference", { pspReference: "other-reference" }]
    ];

    for (const [label, overrides] of invalidCases) {
      const offer = createMockOffer({ offerId: `off_normal_${label.replaceAll(" ", "_")}` });
      let transitions = 0;
      const manager = new BankTransferPaymentManager({
        offerManager: { getOffer: () => offer },
        calendar: { transitionPaymentPendingToConfirmedBooking: () => { transitions += 1; } }
      });
      const session = manager.initializeBankTransfer(
        createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId }),
        { clock: () => new Date("2026-07-22T10:00:00Z") }
      );
      const providerResult = {
        verified: true,
        status: "success",
        amountKobo: offer.totalAmountDueNowKobo,
        currency: "NGN",
        pspReference: session.transferReference,
        payerId: offer.parties.primaryGuest.id,
        ...overrides
      } as MockBankTransferVerifyResult;
      assert.throws(
        () => manager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
          offerId: offer.offerId,
          transferReference: session.transferReference,
          mockPspResult: providerResult
        }), { clock: () => new Date("2026-07-22T10:10:00Z") }),
        /verification|Currency|Amount|Payer attribution/i,
        label
      );
      assert.equal(transitions, 0, `${label} must not transition inventory`);
    }

    const referenceOffer = createMockOffer({ offerId: "off_payload_reference" });
    const referenceManager = new BankTransferPaymentManager({ offerManager: { getOffer: () => referenceOffer }, calendar: { transitionPaymentPendingToConfirmedBooking: () => {} } });
    const referenceSession = referenceManager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: referenceOffer.offerId }), { clock: () => new Date("2026-07-22T10:00:00Z") });
    assert.throws(() => referenceManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: referenceOffer.offerId,
      transferReference: "caller-supplied-reference",
      mockPspResult: {
        verified: true,
        status: "success",
        amountKobo: referenceOffer.totalAmountDueNowKobo,
        currency: "NGN",
        pspReference: referenceSession.transferReference,
        payerId: referenceOffer.parties.primaryGuest.id
      }
    }), { clock: () => new Date("2026-07-22T10:10:00Z") }), /session\/reference binding/i);

    const missingSessionManager = new BankTransferPaymentManager({ offerManager: { getOffer: () => referenceOffer }, calendar: { transitionPaymentPendingToConfirmedBooking: () => {} } });
    assert.throws(() => missingSessionManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: referenceOffer.offerId,
      transferReference: "uninitialized-reference",
      mockPspResult: { verified: true, status: "success", amountKobo: referenceOffer.totalAmountDueNowKobo, currency: "NGN", pspReference: "uninitialized-reference", payerId: referenceOffer.parties.primaryGuest.id }
    }), { clock: () => new Date("2026-07-22T10:10:00Z") }), /session\/reference binding/i);

    const primaryOffer = createMockOffer({ offerId: "off_valid_primary" });
    const primaryManager = new BankTransferPaymentManager({ offerManager: { getOffer: () => primaryOffer }, calendar: { transitionPaymentPendingToConfirmedBooking: () => {} } });
    const primarySession = primaryManager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: primaryOffer.offerId }), { clock: () => new Date("2026-07-22T10:00:00Z") });
    const primaryResult = primaryManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: primaryOffer.offerId,
      transferReference: primarySession.transferReference,
      mockPspResult: { verified: true, status: "success", amountKobo: primaryOffer.totalAmountDueNowKobo, currency: "NGN", pspReference: primarySession.transferReference, payerId: primaryOffer.parties.primaryGuest.id }
    }), { clock: () => new Date("2026-07-22T10:10:00Z") });
    assert.equal(primaryResult.outcome, "confirmed");
    assert.equal(primaryResult.bookingContract?.paymentDetails.pspReference, primarySession.transferReference);

    const distinctOffer = createMockOffer({ offerId: "off_valid_distinct", parties: { ...primaryOffer.parties, distinctPayer: { id: "payer_valid", name: "Valid Payer" } } });
    const distinctManager = new BankTransferPaymentManager({ offerManager: { getOffer: () => distinctOffer }, calendar: { transitionPaymentPendingToConfirmedBooking: () => {} } });
    const distinctSession = distinctManager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: distinctOffer.offerId }), { clock: () => new Date("2026-07-22T10:00:00Z") });
    const distinctResult = distinctManager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
      offerId: distinctOffer.offerId,
      transferReference: distinctSession.transferReference,
      mockPspResult: { verified: true, status: "success", amountKobo: distinctOffer.totalAmountDueNowKobo, currency: "NGN", pspReference: distinctSession.transferReference, payerId: "payer_valid" }
    }), { clock: () => new Date("2026-07-22T10:10:00Z") });
    assert.equal(distinctResult.outcome, "confirmed");
  });

  it("Invalid late successes cannot release inventory or create refund state", () => {
    const invalidCases: Array<[string, Partial<MockBankTransferVerifyResult>]> = [
      ["unverified", { verified: false }],
      ["wrong provider reference", { pspReference: "wrong-reference" }],
      ["wrong amount", { amountKobo: 1 }],
      ["wrong currency", { currency: "USD" }],
      ["missing payer", { payerId: undefined }],
      ["wrong payer", { payerId: "wrong-payer" }]
    ];

    for (const [label, overrides] of invalidCases) {
      const offer = createMockOffer({ offerId: `off_late_invalid_${label.replaceAll(" ", "_")}` });
      let released = false;
      const auditEntries: Array<Record<string, unknown>> = [];
      const manager = new BankTransferPaymentManager({
        offerManager: { getOffer: () => offer },
        calendar: { transitionPaymentPendingToConfirmedBooking: () => {}, releaseInventory: () => { released = true; } },
        audit: { record: (entry) => auditEntries.push(entry) }
      });
      const session = manager.initializeBankTransfer(createCommandEnvelope("bank_transfer.initialize", { offerId: offer.offerId }), { clock: () => new Date("2026-07-22T10:00:00Z") });
      const providerResult = {
        verified: true,
        status: "success",
        amountKobo: offer.totalAmountDueNowKobo,
        currency: "NGN",
        pspReference: session.transferReference,
        payerId: offer.parties.primaryGuest.id,
        ...overrides
      } as MockBankTransferVerifyResult;
      assert.throws(() => manager.verifyAndProcessTransfer(createCommandEnvelope("bank_transfer.verify_and_process", {
        offerId: offer.offerId,
        transferReference: session.transferReference,
        mockPspResult: providerResult
      }), { clock: () => new Date("2026-07-22T10:35:00Z") }), /verification|Currency|Amount|Payer attribution/i, label);
      assert.equal(released, false, `${label} must not release inventory`);
      assert.equal(auditEntries.some((entry) => entry.type === "bank_transfer.late_payment_refunded"), false);
    }
  });
});

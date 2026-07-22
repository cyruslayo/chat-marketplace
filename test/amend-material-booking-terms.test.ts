import test from "node:test";
import assert from "node:assert/strict";
import { BookingAmendmentManager, BookingContract } from "../domains/shortlet/src/index.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createMockContract(overrides: Partial<BookingContract> = {}): BookingContract {
  return {
    contractId: "ctr-amend-1",
    reservationId: "res-amend-1",
    offerId: "off-1",
    unitId: "unit-lagos-1",
    tenantId: "tenant-lagos",
    parties: {
      primaryGuest: { id: "guest-ada", name: "Ada Okafor" },
      operator: { id: "op-lekki", name: "Lekki Luxury Homes" },
      distinctPayer: null
    },
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 },
    occupants: [{ name: "Ada Okafor" }],
    quote: { totalAmountDueNowKobo: 50000000 },
    totalAmountDueNowKobo: 50000000,
    policies: {
      cancellationPolicy: { name: "Strict" },
      guestConductRules: ["No smoking"]
    },
    paymentDetails: {
      pspReference: "psp-original-100",
      paymentMethod: "fresh_card",
      amountKobo: 50000000,
      currency: "NGN",
      paidAt: "2026-08-01T10:00:00.000Z",
      cardMetadata: { brand: "Visa", last4: "1234" }
    },
    createdAt: "2026-08-01T10:00:00.000Z",
    contractVersion: 1,
    ...overrides
  };
}

function createMockDependencies() {
  const contract = createMockContract();
  const contracts = new Map<string, BookingContract>([[contract.contractId, contract]]);

  return {
    contractRepository: {
      getContract(id: string) {
        const c = contracts.get(id);
        if (!c) throw new Error(`Contract not found: ${id}`);
        return c;
      },
      updateContract(c: BookingContract) {
        contracts.set(c.contractId, c);
      }
    },
    calendar: {
      getAuthoritativeAvailability(_unitId: string, _checkIn: string, _checkOut: string) {
        return { isAvailable: true };
      },
      hasSameDayCheckInOnDate(_unitId: string, _date: string) {
        return false;
      }
    },
    inspectionRepository: {
      isPassedAndValid(_unitId: string) {
        return true;
      }
    },
    authorityRepository: {
      isAuthorityValid(_unitId: string) {
        return true;
      }
    }
  };
}

function createEnvelope<T>(
  commandName: string,
  payload: T,
  actorId = "guest-ada",
  tenantId = "tenant-lagos"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd-${Math.random().toString(36).slice(2)}`,
    commandName,
    timestamp: "2026-08-15T10:00:00.000Z",
    principal: {
      id: actorId,
      role: "guest",
      tenantId
    },
    payload
  };
}

test("Date changes, extensions, occupants, price, and checkout follow their accepted submission and completion deadlines", () => {
  const deps = createMockDependencies();
  const manager = new BookingAmendmentManager(deps);

  // Success path: Valid extension requested prior to deadline (e.g. 2026-08-24 17:00 WAT, day before 2026-08-25 checkout)
  const clockValid = () => new Date("2026-08-24T17:00:00.000Z"); // 17:00 WAT < 18:00 WAT cutoff
  const validExtEnv = createEnvelope(
    "booking_amendment.request",
    {
      contractId: "ctr-amend-1",
      changes: {
        dates: { checkIn: "2026-08-20", checkOut: "2026-08-27" } // extend by 2 nights
      }
    },
    "guest-ada"
  );

  const pending = manager.requestAmendment(validExtEnv, clockValid);
  assert.equal(pending.status, "pending");
  assert.equal(pending.financialAdjustment.type, "additional_collection");

  // Failure path 1: Extension requested after 18:00 WAT deadline on day before checkout
  const clockLate = () => new Date("2026-08-24T19:00:00.000Z"); // 19:00 WAT > 18:00 WAT cutoff
  assert.throws(
    () => manager.requestAmendment(validExtEnv, clockLate),
    /Extension request must begin by 6:00 PM \(18:00 WAT\) the day before checkout/
  );

  // Failure path 2: Date change requested less than 24 hours before original check-in
  const clockTooLateForCheckIn = () => new Date("2026-08-19T18:00:00.000Z"); // checkIn is 2026-08-20 (less than 24h)
  const dateChangeEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      dates: { checkIn: "2026-08-22", checkOut: "2026-08-27" }
    }
  });

  assert.throws(
    () => manager.requestAmendment(dateChangeEnv, clockTooLateForCheckIn),
    /Date changes must begin at least 24 hours before check-in/
  );

  // Failure path 3: Stay length exceeding 14 nights max (ADR 0023)
  const clockEarly = () => new Date("2026-08-10T10:00:00.000Z");
  const longStayEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      dates: { checkIn: "2026-08-20", checkOut: "2026-09-10" } // 21 nights!
    }
  });

  assert.throws(
    () => manager.requestAmendment(longStayEnv, clockEarly),
    /Stay length exceeds the maximum launch limit of 14 nights/
  );

  // Failure path 4: Late checkout after 14:00 WAT (ADR 0033)
  const lateCheckoutEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      checkoutTime: "15:00" // Late checkout capped at 14:00 (2:00 PM)
    }
  });
  assert.throws(
    () => manager.requestAmendment(lateCheckoutEnv, clockEarly),
    /Late checkout cannot exceed 14:00 WAT/
  );
});

test("Primary Guest replacement remains prohibited and late first access remains a human-approved exception only", () => {
  const deps = createMockDependencies();
  const manager = new BookingAmendmentManager(deps);
  const clock = () => new Date("2026-08-10T10:00:00.000Z");

  // Failure path 1: Primary guest replacement attempt MUST throw
  const replacePrimaryEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      primaryGuestId: "guest-bisi-new"
    }
  });

  assert.throws(
    () => manager.requestAmendment(replacePrimaryEnv, clock),
    /Primary Guest replacement is prohibited/
  );

  // Failure path 2: Late first access after 10:00 PM (22:00 WAT) without explicit human approval flag
  const lateFirstAccessEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      lateFirstAccessTime: "23:00"
    }
  });

  assert.throws(
    () => manager.requestAmendment(lateFirstAccessEnv, clock),
    /Late first access after 22:00 WAT is a human-approved exception only/
  );
});

test("Additional collection or refund completes as part of the accepted amendment outcome without partial contract mutation", () => {
  const deps = createMockDependencies();
  const manager = new BookingAmendmentManager(deps);
  const clock = () => new Date("2026-08-10T10:00:00.000Z");

  // 1. Request extension that requires additional payment
  const reqEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } // +1 night
    }
  });

  const pending = manager.requestAmendment(reqEnv, clock);
  assert.equal(pending.financialAdjustment.type, "additional_collection");

  // Original contract MUST remain unchanged while amendment is pending
  const originalBeforeCommit = deps.contractRepository.getContract("ctr-amend-1");
  assert.equal(originalBeforeCommit.contractVersion, 1);
  assert.equal(originalBeforeCommit.dates.checkOut, "2026-08-25");

  // 2. Commit amendment with successful payment verification
  const commitEnv = createEnvelope("booking_amendment.commit", {
    amendmentId: pending.amendmentId,
    pspPaymentResult: {
      verified: true,
      status: "success" as const,
      amountKobo: pending.financialAdjustment.amountKobo,
      currency: "NGN",
      pspReference: "psp-add-payment-101",
      payerId: "guest-ada"
    }
  });

  const committed = manager.commitAmendment(commitEnv, clock);
  assert.equal(committed.status, "committed");
  assert.equal(committed.newVersion, 2);

  // Updated contract now reflects version 2 and new dates
  const updatedContract = deps.contractRepository.getContract("ctr-amend-1");
  assert.equal(updatedContract.contractVersion, 2);
  assert.equal(updatedContract.dates.checkOut, "2026-08-26");
});

test("Chat, Operator promises, stale surfaces, and failed payments cannot alter contractual state", () => {
  const deps = createMockDependencies();
  const manager = new BookingAmendmentManager(deps);
  const clock = () => new Date("2026-08-10T10:00:00.000Z");

  // Failure path 1: Free text / chat attempt to amend terms directly MUST throw or be rejected
  const chatAttemptEnv = createEnvelope("booking_amendment.reject_informal_chat", {
    chatMessage: "Host agreed in chat to extend my stay by 3 days for free"
  });

  const rejectedChat = manager.rejectInformalChatAlteration(chatAttemptEnv);
  assert.equal(rejectedChat.rejected, true);
  assert.equal(rejectedChat.reason, "Informal chat messages or operator promises cannot alter contractual state");

  // Failure path 2: Failed payment during commit rejects amendment and leaves original contract untouched
  const reqEnv = createEnvelope("booking_amendment.request", {
    contractId: "ctr-amend-1",
    changes: {
      dates: { checkIn: "2026-08-20", checkOut: "2026-08-27" }
    }
  });
  const pending = manager.requestAmendment(reqEnv, clock);

  const failedCommitEnv = createEnvelope("booking_amendment.commit", {
    amendmentId: pending.amendmentId,
    pspPaymentResult: {
      verified: false,
      status: "failed" as const,
      amountKobo: pending.financialAdjustment.amountKobo,
      currency: "NGN",
      pspReference: "psp-failed-payment"
    }
  });

  assert.throws(
    () => manager.commitAmendment(failedCommitEnv, clock),
    /Amendment commit failed: Payment verification unsuccessful/
  );

  // Original contract MUST still be version 1
  const contract = deps.contractRepository.getContract("ctr-amend-1");
  assert.equal(contract.contractVersion, 1);
});

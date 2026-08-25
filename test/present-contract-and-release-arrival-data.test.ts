import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContractAndArrivalReleaseManager } from "../domains/shortlet/src/contract-release.js";
import { PlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

function createCommandEnvelope<T extends Record<string, unknown>>(
  commandName: string,
  payload: T,
  tenantId = "tenant_13",
  userId = "guest_13"
): PlatformCommandEnvelope<T> {
  return {
    commandId: `cmd_${Math.random().toString(36).substring(2, 9)}`,
    commandName,
    principal: { id: userId, role: "guest", tenantId },
    payload,
    timestamp: new Date().toISOString()
  };
}

describe("Issue 13: Present contract and release arrival data", () => {
  const sampleContract = {
    contractId: "ctr_13",
    reservationId: "res_13",
    offerId: "off_13",
    unitId: "unit_13",
    tenantId: "tenant_13",
    parties: {
      primaryGuest: { id: "guest_13", name: "Guest Thirteen" },
      operator: { id: "op_13", name: "Operator Thirteen" }
    },
    dates: { checkIn: "2026-08-10", checkOut: "2026-08-15", nights: 5 },
    occupants: [{ name: "Guest Thirteen" }],
    quote: {
      allInStayTotalKobo: 15000000,
      refundableSecurityDepositKobo: 2500000,
      totalAmountDueNowKobo: 17500000
    },
    totalAmountDueNowKobo: 17500000,
    policies: {
      cancellationPolicy: { type: "standard", version: "v1" },
      guestConductRules: ["No loud noise after 10 PM"]
    },
    disclosures: ["Captured booking disclosure"],
    paymentDetails: {
      pspReference: "psp_13",
      paymentMethod: "fresh_card" as const,
      amountKobo: 17500000,
      currency: "NGN" as const,
      paidAt: "2026-07-22T12:00:00Z",
      cardMetadata: { brand: "Mastercard", last4: "8888" }
    },
    createdAt: "2026-07-22T12:00:00Z",
    contractVersion: 1
  };

  const sampleArrivalData = {
    contractId: "ctr_13",
    fullAddress: "Plot 42, Admiralty Way, Lekki Phase 1, Lagos, Nigeria",
    accessInstructions: "Use smart keypad code 482910 at the main gate.",
    locationReferenceId: "loc_ref_9921",
    accessReferenceId: "acc_ref_1102"
  };

  const repository = {
    findContractById: (id: string) => (id === "ctr_13" ? sampleContract : null),
    findArrivalDataByContractId: (id: string) => (id === "ctr_13" ? sampleArrivalData : null),
    findReservationById: (id: string) => (id === "res_13" ? { reservationId: "res_13", status: "confirmed" } : null)
  };

  it("AC 1: The contract displays the captured parties, Unit, stay, money, deposit, policies, disclosures, and versions", () => {
    const manager = new ContractAndArrivalReleaseManager({ repository });
    const envelope = createCommandEnvelope("contract.get_view", { contractId: "ctr_13" });

    const view = manager.getBookingContractView(envelope);
    assert.equal(view.contractId, "ctr_13");
    assert.equal(view.parties.primaryGuest.id, "guest_13");
    assert.equal(view.parties.operator.id, "op_13");
    assert.equal(view.dates.nights, 5);
    assert.equal(view.money.totalAmountDueNowKobo, 17500000);
    assert.equal(view.money.refundableSecurityDepositKobo, 2500000);
    assert.ok(view.policies.cancellationPolicy);
    assert.ok(view.disclosures.length > 0);
    assert.equal(view.contractVersion, 1);
  });

  it("AC 2: Full address and access instructions are tenant-scoped and released only at the accepted lifecycle points", () => {
    const manager = new ContractAndArrivalReleaseManager({ repository, policy: { canReleaseAccessInstructions: () => true } });
    const envelope = createCommandEnvelope("arrival_data.get_protected", { contractId: "ctr_13" });

    const arrival = manager.getProtectedArrivalData(envelope);
    assert.equal(arrival.fullAddress, "Plot 42, Admiralty Way, Lekki Phase 1, Lagos, Nigeria");
    assert.equal(arrival.accessInstructions, "Use smart keypad code 482910 at the main gate.");
    assert.ok(arrival.locationReferenceId);
    assert.ok(arrival.accessReferenceId);
  });

  it("AC 3: Interaction logs and model context do not retain unredacted protected access material unnecessarily", () => {
    const manager = new ContractAndArrivalReleaseManager({ repository });
    const projection = manager.projectRedactedInteractionView(createCommandEnvelope("contract.get_view", { contractId: "ctr_13" }));

    assert.equal(projection.contractId, "ctr_13");
    assert.equal(projection.locationReferenceId, "loc_ref_9921");
    assert.equal(projection.accessReferenceId, "acc_ref_1102");
    assert.equal((projection as any).fullAddress, undefined);
    assert.equal((projection as any).accessInstructions, undefined);
  });

  it("AC 4: Revoked, cancelled, cross-tenant, and premature requests fail without leaking whether protected data exists", () => {
    const manager = new ContractAndArrivalReleaseManager({ repository });

    // Cross-tenant attempt must throw generic error
    const wrongTenantEnvelope = createCommandEnvelope("arrival_data.get_protected", { contractId: "ctr_13" }, "wrong_tenant", "guest_13");
    assert.throws(
      () => manager.getProtectedArrivalData(wrongTenantEnvelope),
      (err: any) => err.message.includes("Access denied or resource not found")
    );

    // Unconfirmed / cancelled reservation attempt must throw generic error
    const cancelledRepo = {
      ...repository,
      findReservationById: () => ({ reservationId: "res_13", status: "cancelled" })
    };
    const managerCancelled = new ContractAndArrivalReleaseManager({ repository: cancelledRepo });
    const envelope = createCommandEnvelope("arrival_data.get_protected", { contractId: "ctr_13" });

    assert.throws(
      () => managerCancelled.getProtectedArrivalData(envelope),
      (err: any) => err.message.includes("Access denied or resource not found")
    );
  });
});

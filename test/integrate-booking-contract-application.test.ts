import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BookingContractApplication } from "../apps/web/src/booking-contract-application.js";
import type { ContractRepository } from "../domains/shortlet/src/contract-release.js";
import type { BookingContract } from "../domains/shortlet/src/card-payment.js";

const contract: BookingContract = {
  contractId: "ctr-app", reservationId: "res-app", offerId: "off-app", unitId: "unit-app", tenantId: "tenant-app",
  parties: { primaryGuest: { id: "guest-app", name: "Ada Guest" }, operator: { id: "op-app", name: "Provider" }, distinctPayer: { id: "payer-app", name: "Payer" } },
  dates: { checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2 }, occupants: [{ name: "Ada Guest" }],
  quote: { currency: "NGN", allInStayTotalKobo: 20000, refundableSecurityDepositKobo: 5000 }, totalAmountDueNowKobo: 25000,
  policies: { cancellationPolicy: { type: "standard", version: "cancel-v2", policySummary: "Captured cancellation terms" }, guestConductRules: ["Keep the Unit in good order"] },
  disclosures: ["Captured material disclosure"], paymentDetails: { paymentMethod: "bank_transfer", transferReference: "transfer-ref", amountKobo: 25000, currency: "NGN", paidAt: "2026-08-20T00:00:00.000Z" }, createdAt: "2026-08-20T00:00:00.000Z", contractVersion: 3,
};
const arrival = { contractId: contract.contractId, fullAddress: "SECRET ADDRESS", accessInstructions: "SECRET DOOR CODE", locationReferenceId: "opaque-location", accessReferenceId: "opaque-access" };
const repository: ContractRepository = { findContractById: (id) => id === contract.contractId ? contract : null, findArrivalDataByContractId: (id) => id === contract.contractId ? arrival : null, findReservationById: (id) => id === contract.reservationId ? { reservationId: id, status: "confirmed" } : null };
const guest = { id: "guest-app", role: "guest" as const, tenantId: "tenant-app" };

import { ContractAndArrivalReleaseManager } from "../domains/shortlet/src/contract-release.js";
function makeApp(allowAccess = false, repo = repository) { return new BookingContractApplication(new ContractAndArrivalReleaseManager({ repository: repo, policy: { canReleaseAccessInstructions: () => allowAccess } }), () => new Date("2026-08-25T00:00:00.000Z")); }

describe("Booking Contract application boundary", () => {
  it("authorizes only the tenant-scoped Primary Guest and produces a minimized artifact", () => {
    const artifact = makeApp().getArtifact(contract.contractId, guest);
    assert.equal(artifact.id, "booking-contract:ctr-app");
    assert.equal(artifact.facts.paymentMethod, "bank_transfer");
    const serialized = JSON.stringify(artifact);
    assert.doesNotMatch(serialized, /SECRET ADDRESS|SECRET DOOR CODE|door code|fullAddress|accessInstructions/i);
    assert.match(serialized, /opaque-location|opaque-access/);
    for (const principal of [{ id: "other", role: "guest" as const, tenantId: "tenant-app" }, { id: "payer-app", role: "guest" as const, tenantId: "tenant-app" }, { id: "op-app", role: "operator" as const, tenantId: "tenant-app" }, { id: "guest-app", role: "guest" as const }, { id: "guest-app", role: "guest" as const, tenantId: "wrong" }]) {
      assert.throws(() => makeApp().getArtifact(contract.contractId, principal), /Access denied or resource not found/);
    }
  });

  it("keeps access locked by default and releases each category only through its secure view", () => {
    const locked = makeApp().getProtectedArrivalView(contract.contractId, guest);
    assert.equal(locked.addressAvailability, "available");
    assert.equal(locked.fullAddress, "SECRET ADDRESS");
    assert.equal(locked.accessInstructions, undefined);
    const open = makeApp(true).getProtectedArrivalView(contract.contractId, guest);
    assert.equal(open.accessInstructions, "SECRET DOOR CODE");
  });

  it("uses one generic denial for lifecycle and unknown-resource failures", () => {
    const cancelled: ContractRepository = { ...repository, findReservationById: () => ({ reservationId: contract.reservationId, status: "cancelled" }) };
    const messages = [
      () => makeApp().getProtectedArrivalView("unknown", guest),
      () => makeApp().getProtectedArrivalView(contract.contractId, { id: "guest-app", role: "guest", tenantId: "wrong" }),
      () => makeApp(false, cancelled).getProtectedArrivalView(contract.contractId, guest),
    ].map((operation) => { try { operation(); return "ok"; } catch (error) { return error instanceof Error ? error.message : String(error); } });
    assert.deepEqual(new Set(messages), new Set(["Access denied or resource not found"]));
  });
});

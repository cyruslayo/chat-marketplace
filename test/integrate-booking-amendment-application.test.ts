import test from "node:test";
import assert from "node:assert/strict";
import { BookingAmendmentApplication } from "../apps/web/src/booking-amendment-application.js";
import type { BookingAmendmentManager } from "../domains/shortlet/src/booking-amendment.js";
import type { BookingContract } from "../domains/shortlet/src/card-payment.js";

const contract: BookingContract = { contractId: "c1", reservationId: "r1", offerId: "o1", unitId: "u1", tenantId: "t1", parties: { primaryGuest: { id: "g1", name: "Guest" }, operator: { id: "op" }, distinctPayer: { id: "payer", name: "Payer" } }, dates: { checkIn: "2026-08-20", checkOut: "2026-08-21", nights: 1 }, occupants: [{ name: "Guest" }], quote: { allInStayTotalKobo: 1000, currency: "NGN" }, totalAmountDueNowKobo: 1000, policies: { cancellationPolicy: {}, guestConductRules: [] }, paymentDetails: { paymentMethod: "bank_transfer", transferReference: "tr", amountKobo: 1000, currency: "NGN", paidAt: "2026-08-01T00:00:00Z" }, createdAt: "2026-08-01T00:00:00Z", contractVersion: 1 };
const manager = { getLatestForContract: () => undefined } as unknown as BookingAmendmentManager;
const app = new BookingAmendmentApplication({ manager, contracts: { getContract: () => contract } });

test("Booking Amendment artifact authorization requires the Primary Guest and exact tenant", () => { const authorized = app.getArtifact("c1", { id: "g1", role: "guest", tenantId: "t1" }); assert.equal(authorized.facts.contractId, "c1"); for (const principal of [{ id: "other", role: "guest", tenantId: "t1" }, { id: "payer", role: "guest", tenantId: "t1" }, { id: "op", role: "operator", tenantId: "t1" }, { id: "g1", role: "guest" }, { id: "g1", role: "guest", tenantId: "wrong" }] as const) assert.throws(() => app.getArtifact("c1", principal), /Access denied or resource not found/); });
test("unknown Booking Amendment artifact is denied without resource enumeration", () => { const unknown = new BookingAmendmentApplication({ manager, contracts: { getContract: () => { throw new Error("missing"); } } }); assert.throws(() => unknown.getArtifact("missing", { id: "g1", role: "guest", tenantId: "t1" }), /^Error: Access denied or resource not found$/); });

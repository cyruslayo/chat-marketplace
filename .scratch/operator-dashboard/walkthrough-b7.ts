// B7 walkthrough: a local back office with owner payables in every state. Local test data only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformCommandEnvelope } from "../../packages/platform-core/src/index.js";
import { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/local-owner-environment.js";
import { startLocalOwnerServer } from "../../apps/local-owner/src/local-owner-server.js";
import { CancellationNoShowManager, type BookingContract, type OwnerSettlementSnapshot } from "../../domains/shortlet/src/index.js";
import { guestCardPayments } from "../../test/helpers/guest-card-payment.js";
import { repricedByOwner } from "../../test/helpers/owner-terms.js";

let now = new Date("2026-09-03T10:00:00Z");
const env = new LocalApartmentOwnerEnvironment({ databasePath: join(mkdtempSync(join(tmpdir(), "b7-walk-")), "owner.sqlite"), clock: () => now });
const who = env.getRepresentativePrincipal();

const unit = env.unitRepository.findById(env.config.unitId)!;
env.unitRepository.save({ ...unit, id: "unit-lagos-ikoyi-002", title: "Garden Flat in Old Ikoyi", operator: { ...unit.operator, id: "op-lagos-owner-002", name: "Adaeze Homes Ltd" }, price: repricedByOwner(unit.price, { ownerNightlyKobo: 8_000_000, ownerMandatoryChargesKobo: 0, marginBasisPoints: 1500 }) });
env.grantStore.createGrant(createPlatformCommandEnvelope({ commandName: "operator_representative.grant", principal: { id: env.config.adminId, role: "admin", tenantId: env.config.tenantId }, payload: { actorId: env.config.representativePersonId, operatorId: "op-lagos-owner-002", expiresAtIso: "2027-01-01T00:00:00Z", responsiblePersonVerifiedAtIso: "2026-08-01T00:00:00Z", verificationReference: "walk" }, idempotencyKey: "walk-grant" }));

let n = 0;
function reservation(checkIn: string, checkOut: string, unitId?: string): string {
  n += 1;
  const id = env.createDemoIncomingBookingRequest({ guestId: `walk-${n}`, guestName: `Walk Guest ${n}`, checkIn, checkOut, ...(unitId ? { unitId } : {}) }).facts.requestId;
  env.confirmOperatorRequest(id, who, { attested: true, basedOnVersion: env.operatorRequestDetail(id, who).projectionVersion });
  const guest = guestCardPayments(env);
  try { guest.pay(id); } finally { guest.close(); }
  return id;
}
const access = (id: string) => env.recordVerifiedAccess(id, who, { basis: "guest_confirmed_directly", basedOnVersion: env.operatorReservation(id, who).version });
const contractOf = (id: string) => { const offer = env.interactionStore.findConditionalOfferByRequestId(id)!; return JSON.parse(env.interactionStore.findBookingSnapshotByOfferId(offer.offerId)!.contractJson) as BookingContract & { quote: { ownerSettlement: OwnerSettlementSnapshot } }; };

const due = reservation("2026-09-10", "2026-09-12");
const paid = reservation("2026-09-12", "2026-09-13");
const paused = reservation("2026-09-12", "2026-09-14", "unit-lagos-ikoyi-002");
reservation("2026-09-20", "2026-09-22");
const cancelled = reservation("2026-09-16", "2026-09-18", "unit-lagos-ikoyi-002");

// Cancelled 7–14 days out under the standard policy: half the Cancellation Base is kept.
const contract = contractOf(cancelled);
const s = contract.quote.ownerSettlement;
const outcome = new CancellationNoShowManager().calculateAuthoritative({ reservationId: contract.reservationId, contract, economics: { version: "walk", currency: "NGN", cancellationBaseKobo: s.ownerPayableKobo + s.marginKobo, refundableCleaningKobo: 0, refundableUnprovidedServicesKobo: 0, refundableSecurityDepositKobo: 0, refundableAttributableTaxKobo: 0, refundableDuplicatePaymentKobo: 0, commissionRate: 0 }, policy: { type: "standard", version: "cancellation-v1", policySummary: "" }, checkInWindowStartIso: "2026-09-16T13:00:00Z", at: now, liability: "guest" });
env.ownerPayableLedger.postCancellation({ cancellationId: `cancellation:${contract.reservationId}`, reservationId: contract.reservationId, liability: "guest", amountKobo: outcome.totalRefundKobo, retainedCancellationBaseKobo: outcome.retainedCancellationBaseKobo, retainedCommissionKobo: 0, currency: "NGN" });

now = new Date("2026-09-10T13:30:00Z"); access(due);
now = new Date("2026-09-12T13:30:00Z"); access(paid); access(paused);
env.reportBlockingComplaint(paused, who, { category: "habitability_failure", basedOnVersion: env.operatorReservation(paused, who).version });
now = new Date("2026-09-13T14:00:00Z");
const paidPayable = env.ownerPayable(paid, who);
env.recordOwnerPayout(paid, who, { amount: (paidPayable.payable!.outstandingKobo / 100).toFixed(2), paidOn: "2026-09-13", reference: "GTB-OWNER-0002", basedOnVersion: paidPayable.payable!.version });

const server = startLocalOwnerServer({ port: 3014, environment: env });
await server.listen();
const tokenFile = join(tmpdir(), "b7-walk-token.txt");
const { writeFileSync } = await import("node:fs");
writeFileSync(tokenFile, env.provisionOperatorAccessToken());
console.log(`B7 walkthrough on http://localhost:3014/operator/login (token in ${tokenFile})`);

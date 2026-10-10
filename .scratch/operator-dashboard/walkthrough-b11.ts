// Issue 11 walkthrough: an Owner Overpayment to recover, and another payable of the same owner due. Local test data only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/local-owner-environment.js";
import { startLocalOwnerServer } from "../../apps/local-owner/src/local-owner-server.js";
import { guestCardPayments } from "../../test/helpers/guest-card-payment.js";

let now = new Date("2026-09-03T10:00:00Z");
const env = new LocalApartmentOwnerEnvironment({ databasePath: join(mkdtempSync(join(tmpdir(), "b11-walk-")), "owner.sqlite"), clock: () => now });
const who = env.getRepresentativePrincipal();

function reservation(n: number, checkIn: string, checkOut: string): string {
  const id = env.createDemoIncomingBookingRequest({ guestId: `walk-${n}`, guestName: `Walk Guest ${n}`, checkIn, checkOut }).facts.requestId;
  env.confirmOperatorRequest(id, who, { attested: true, basedOnVersion: env.operatorRequestDetail(id, who).projectionVersion });
  const guest = guestCardPayments(env);
  try { guest.pay(id); } finally { guest.close(); }
  return id;
}
const access = (id: string) => env.recordVerifiedAccess(id, who, { basis: "guest_confirmed_directly", basedOnVersion: env.operatorReservation(id, who).version });

const first = reservation(1, "2026-09-10", "2026-09-11");
const second = reservation(2, "2026-09-12", "2026-09-13");
now = new Date("2026-09-10T13:30:00Z"); access(first);
now = new Date("2026-09-11T14:00:00Z");
const payable = env.ownerPayable(first, who);
env.recordOwnerPayout(first, who, { amount: (payable.payable!.outstandingKobo / 100).toFixed(2), paidOn: "2026-09-11", reference: "GTB-OWNER-0001", basedOnVersion: payable.payable!.version });
// A later operator-failure refund keeps half the Cancellation Base: the owner is now owed less than was paid.
const base = payable.payable!.captured.ownerPayableKobo + payable.payable!.captured.marginKobo;
env.ownerPayableLedger.postCancellation({ cancellationId: `cancellation:${payable.reservationId}`, reservationId: payable.reservationId, liability: "operator_failure", amountKobo: base - Math.floor(base / 2), retainedCancellationBaseKobo: Math.floor(base / 2), retainedCommissionKobo: 0, currency: "NGN" });
now = new Date("2026-09-12T13:30:00Z"); access(second);
now = new Date("2026-09-13T14:00:00Z");

const server = startLocalOwnerServer({ port: 3017, environment: env });
await server.listen();
const tokenFile = join(tmpdir(), "b11-walk-token.txt");
writeFileSync(tokenFile, env.provisionOperatorAccessToken());
console.log(`Issue 11 walkthrough on http://localhost:3017/operator/login (token in ${tokenFile})`);

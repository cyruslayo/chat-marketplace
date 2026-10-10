// Issue 14 walkthrough: a three-night Reservation with an open complaint to uphold. Local test data only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/local-owner-environment.js";
import { startLocalOwnerServer } from "../../apps/local-owner/src/local-owner-server.js";
import { guestCardPayments } from "../../test/helpers/guest-card-payment.js";

let now = new Date("2026-09-03T10:00:00Z");
const env = new LocalApartmentOwnerEnvironment({ databasePath: join(mkdtempSync(join(tmpdir(), "b14-walk-")), "owner.sqlite"), clock: () => now });
const who = env.getRepresentativePrincipal();

const id = env.createDemoIncomingBookingRequest({ guestId: "walk-1", guestName: "Walk Guest 1", checkIn: "2026-09-10", checkOut: "2026-09-13" }).facts.requestId;
env.confirmOperatorRequest(id, who, { attested: true, basedOnVersion: env.operatorRequestDetail(id, who).projectionVersion });
const guest = guestCardPayments(env);
try { guest.pay(id); } finally { guest.close(); }
now = new Date("2026-09-10T13:30:00Z");
env.recordVerifiedAccess(id, who, { basis: "guest_confirmed_directly", basedOnVersion: env.operatorReservation(id, who).version });
now = new Date("2026-09-11T08:00:00Z");
env.reportBlockingComplaint(id, who, { category: "habitability_failure", basedOnVersion: env.operatorReservation(id, who).version });

const server = startLocalOwnerServer({ port: 3018, environment: env });
await server.listen();
const tokenFile = join(tmpdir(), "b14-walk-token.txt");
writeFileSync(join(tmpdir(), "b14-walk-request.txt"), id);
writeFileSync(tokenFile, env.provisionOperatorAccessToken());
console.log(`Issue 14 walkthrough on http://localhost:3018/operator/login (token in ${tokenFile})`);

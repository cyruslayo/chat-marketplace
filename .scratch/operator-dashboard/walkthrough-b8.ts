// B8 walkthrough: a local back office whose calendar shows every night state. Local test data only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/local-owner-environment.js";
import { startLocalOwnerServer } from "../../apps/local-owner/src/local-owner-server.js";
import { guestCardPayments } from "../../test/helpers/guest-card-payment.js";
import { SECOND_UNIT_ID, addSecondOwner } from "../../test/helpers/back-office-page.js";

const now = new Date("2026-09-03T10:00:00Z");
const env = new LocalApartmentOwnerEnvironment({ databasePath: join(mkdtempSync(join(tmpdir(), "b8-walk-")), "owner.sqlite"), clock: () => now });
const who = env.getRepresentativePrincipal();
addSecondOwner(env);

let n = 0;
function request(checkIn: string, checkOut: string, unitId?: string): string {
  n += 1;
  return env.createDemoIncomingBookingRequest({ guestId: `walk-${n}`, guestName: `Walk Guest ${n}`, checkIn, checkOut, ...(unitId ? { unitId } : {}) }).facts.requestId;
}
function confirm(id: string): string {
  env.confirmOperatorRequest(id, who, { attested: true, basedOnVersion: env.operatorRequestDetail(id, who).projectionVersion });
  return id;
}

const booked = confirm(request("2026-09-15", "2026-09-17"));
const guest = guestCardPayments(env);
try { guest.pay(booked); } finally { guest.close(); }
confirm(request("2026-09-10", "2026-09-12"));
request("2026-09-05", "2026-09-07");
request("2026-09-08", "2026-09-09", SECOND_UNIT_ID);
const version = env.operatorCalendar(env.config.unitId, who, "2026-09-03").version;
env.blockOperatorDates(env.config.unitId, who, { firstNight: "2026-09-20", lastNight: "2026-09-21", reason: "owner_use", basedOnVersion: version });
env.calendar.addOperatorBlock({ unitId: env.config.unitId, operatorId: env.config.operatorId, start: "2026-09-25", end: "2026-09-26", reason: "Availability protected due to missed turnover deadline", clock: () => now });

const server = startLocalOwnerServer({ port: 3015, environment: env });
await server.listen();
const tokenFile = join(tmpdir(), "b8-walk-token.txt");
writeFileSync(tokenFile, env.provisionOperatorAccessToken());
console.log(`B8 walkthrough on http://localhost:3015/operator/login (token in ${tokenFile})`);

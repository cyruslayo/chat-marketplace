import assert from "node:assert/strict";
import type { CommandPrincipal } from "../../packages/platform-core/src/index.js";
import { decideRequest, signInOperator, type SignedInOperator } from "./operator-session.js";
import { guestCardPayments } from "./guest-card-payment.js";

/** Shared Reservation fixtures for back-office tests (B7, issue 10). */

/** The fixture unit's Contractual Check-In Window (ADR 0031) opens 2:00 PM WAT on the check-in date. */
export const windowOpens = (checkIn: string) => new Date(`${checkIn}T13:00:00Z`);

/** A jump of days outlives the 12-hour session (ADR 0086), so tests sign in again after moving the clock. */
const cookies = new WeakMap<SignedInOperator, string>();
export const cookieOf = (f: SignedInOperator) => cookies.get(f) ?? f.session.cookie;
export async function travelTo(f: SignedInOperator, instant: Date): Promise<void> {
  f.advance(instant.getTime() - f.now().getTime());
  cookies.set(f, await signInOperator(f.server));
}

let guests = 0;
/** A paid Reservation, confirmed in the back office and paid by card on the Guest side. */
export async function reservation(f: SignedInOperator, checkIn: string, checkOut: string, unitId?: string): Promise<string> {
  guests += 1;
  const id = f.server.environment.createDemoIncomingBookingRequest({ guestId: `payable-guest-${guests}`, guestName: `Payable Guest ${guests}`, checkIn, checkOut, ...(unitId ? { unitId } : {}) }).facts.requestId;
  assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, id, "confirm")).status, 303);
  const guest = guestCardPayments(f.server.environment);
  try { guest.pay(id); } finally { guest.close(); }
  return id;
}

export const principal = (f: SignedInOperator): CommandPrincipal => f.server.environment.getRepresentativePrincipal();

export function recordAccess(f: SignedInOperator, id: string): void {
  const env = f.server.environment;
  env.recordVerifiedAccess(id, principal(f), { basis: "guest_confirmed_directly", basedOnVersion: env.operatorReservation(id, principal(f)).version });
}

export function openComplaint(f: SignedInOperator, id: string, category = "habitability_failure"): void {
  const env = f.server.environment;
  env.reportBlockingComplaint(id, principal(f), { category, basedOnVersion: env.operatorReservation(id, principal(f)).version });
}

import test from "node:test";
import assert from "node:assert/strict";
import { FOREIGN_ORIGIN, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startOperatorServer, startSignedInOperator, signInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { TEST_CARD_LAST4, TEST_PAYER_EMAIL, guestCardPayments } from "./helpers/guest-card-payment.js";
import { formatWat } from "../apps/local-owner/src/back-office-view.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";
import { repricedByOwner } from "./helpers/owner-terms.js";

// B5 — Reservation detail and recording check-in (scratch/operator-dashboard/issues/05-reservation-and-check-in.md).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";
/** The fixture unit's Contractual Check-In Window (ADR 0031) opens 2:00 PM WAT on the check-in date. */
const CHECK_IN = "2026-09-10";
const WINDOW_OPENS = new Date("2026-09-10T13:00:00Z");

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

/** The live session cookie per server: a jump of days outlives the 12-hour session (ADR 0086), so tests sign in again. */
const cookies = new WeakMap<SignedInOperator, string>();
const cookieOf = (f: SignedInOperator) => cookies.get(f) ?? f.session.cookie;
async function travelTo(f: SignedInOperator, instant: Date) {
  f.advance(instant.getTime() - f.now().getTime());
  cookies.set(f, await signInOperator(f.server));
}

let guests = 0;
/** A paid Reservation for the fixture owner, confirmed through the back office and paid through the Guest side. */
async function reservation(f: SignedInOperator, checkIn = CHECK_IN, checkOut = "2026-09-13"): Promise<string> {
  guests += 1;
  const id = f.server.environment.createDemoIncomingBookingRequest({ guestId: `reservation-guest-${guests}`, guestName: `Reservation Guest ${guests}`, checkIn, checkOut }).facts.requestId;
  assert.equal((await decideRequest({ ...f.session, cookie: cookieOf(f) }, id, "confirm")).status, 303);
  const guest = guestCardPayments(f.server.environment);
  try { guest.pay(id); } finally { guest.close(); }
  return id;
}

async function page(f: SignedInOperator, id: string, cookie = cookieOf(f)): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(id)}`, cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

function version(html: string, action: "verified-access" | "blocking-complaint"): string {
  const form = html.match(new RegExp(`<form method="post" action="/operator/bookings/[^"]+/${action}"[\\s\\S]*?</form>`))?.[0];
  assert.ok(form, `${action} form`);
  const value = form.match(/name="basedOnVersion" value="([^"]+)"/)?.[1];
  assert.ok(value, `${action} version`);
  return value;
}

async function act(f: SignedInOperator, id: string, action: "verified-access" | "blocking-complaint", fields: Record<string, string>, options: { cookie?: string; origin?: string; basedOnVersion?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? version((await page(f, id)).html, action);
  return operatorPost(f.session, `/operator/bookings/${encodeURIComponent(id)}/${action}`, options.cookie ?? cookieOf(f), options.origin ? { origin: options.origin } : {}, { basedOnVersion, ...fields });
}

const accessRecords = (f: SignedInOperator, id: string) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_verified_access_recorded" && entry.requestId === id).length;
const complaintRecords = (f: SignedInOperator, id: string) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_blocking_complaint_reported" && entry.requestId === id).length;

/** The standard refusals for a check-in action; none may record anything. */
async function assertStandardRefusals(f: SignedInOperator, id: string, action: "verified-access" | "blocking-complaint", fields: Record<string, string>) {
  const current = version((await page(f, id)).html, action);
  const before = [accessRecords(f, id), complaintRecords(f, id)];
  assert.equal((await act(f, id, action, fields, { cookie: "", basedOnVersion: current })).status, 401, "no session");
  assert.equal((await act(f, id, action, fields, { origin: FOREIGN_ORIGIN, basedOnVersion: current })).status, 403, "cross-origin POST");
  assert.equal((await act(f, id, action, fields, { basedOnVersion: "0000000000000000" })).status, 409, "stale version");
  assert.deepEqual([accessRecords(f, id), complaintRecords(f, id)], before);
}

test("AC1 — The Reservation page shows the owner, apartment, stay dates, party size, arrival window, checkout time, amount paid and payment method from the booking snapshot, without recalculating them", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f);
    const env = f.server.environment;
    const contract = env.operatorReservation(id, env.getRepresentativePrincipal());
    const shown = await page(f, id);
    assert.equal(shown.status, 200);
    assert.match(shown.text, /Reservation confirmed/);
    for (const fact of [OWNER, APARTMENT, "10–13 Sept 2026", "3 nights", "1 occupant", "Arrival window 14:00–22:00 WAT", "Checkout 11:00 WAT", `Amount paid ${formatMoney(contract.amountPaidKobo)}`, "Payment method Card", "Guest phone +2348012345678"]) {
      assert.ok(shown.text.includes(fact), `shows ${fact}`);
    }
    for (const secret of [TEST_CARD_LAST4, TEST_PAYER_EMAIL, "psp_ref_"]) assert.ok(!shown.html.includes(secret), `no ${secret}`);

    // The unit changes after booking; the Reservation keeps its snapshot (ADR 0077).
    const unit = env.unitRepository.findById(env.config.unitId)!;
    env.unitRepository.save({ ...unit, price: repricedByOwner(unit.price, { ownerNightlyKobo: unit.price.ownerTerms!.agreed.nightlyKobo * 2 }), checkInWindow: { earliestAccessTime: "16:00", latestPermittedArrival: "18:00", timezone: "Africa/Lagos" } });
    const after = await page(f, id);
    assert.ok(after.text.includes("Arrival window 14:00–22:00 WAT"));
    assert.ok(after.text.includes(`Amount paid ${formatMoney(contract.amountPaidKobo)}`));

    // A booking that is not yet a Reservation has no Reservation facts or check-in actions.
    const offerOnly = env.createDemoIncomingBookingRequest({ guestId: "reservation-offer-only", checkIn: "2026-09-20", checkOut: "2026-09-22" }).facts.requestId;
    assert.equal((await decideRequest(f.session, offerOnly, "confirm")).status, 303);
    const notYet = await page(f, offerOnly);
    assert.doesNotMatch(notYet.html, /verified-access|blocking-complaint|Amount paid/);
  } finally { await f.close(); }
});

test("AC2 — You can record Verified Access for a Reservation, and the page then shows when the owner payable becomes due", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f);
    await travelTo(f, new Date(WINDOW_OPENS.getTime() + 30 * MINUTE));
    const before = await page(f, id);
    assert.match(before.text, /Awaiting Verified Access/);
    // ADR 0091: the documented bases, and the owner's word is not one.
    assert.match(before.text, /The Guest confirmed access to me directly/);
    assert.match(before.text, /I or platform staff handed over access at the unit/);
    assert.match(before.text, /The owner's word alone is not enough/);

    // A basis is required; no free text rides along.
    for (const fields of [{}, { basis: "owner_said_so" }, { basis: "staff_handover", note: "free text" }] as Record<string, string>[]) {
      assert.equal((await act(f, id, "verified-access", fields)).status, 400);
    }
    assert.equal(accessRecords(f, id), 0);

    await assertStandardRefusals(f, id, "verified-access", { basis: "guest_confirmed_directly" });
    const recorded = await act(f, id, "verified-access", { basis: "guest_confirmed_directly" });
    assert.equal(recorded.status, 303);
    assert.equal(accessRecords(f, id), 1);

    // The Check-In Protection Window starts at the later of contractual check-in and access provision (ADR 0022); due 24 hours later (ADR 0089).
    const due = new Date(f.now().getTime() + 24 * HOUR).toISOString();
    const after = await page(f, id);
    assert.match(after.text, /Verified Access recorded/);
    assert.ok(after.text.includes(`Owner payable Due ${formatWat(due)}`), "owner payable due, absolute WAT");
    assert.ok(after.html.includes(`<time datetime="${due}">`));

    // Durable: a restarted server over the same database still shows it.
    const restarted = await startOperatorServer({ databasePath: f.server.environment.config.databasePath, clock: () => f.now() });
    try {
      const cookie = await signInOperator(restarted);
      const text = visibleText(await (await operatorGet({ base: restarted.base, cookie }, `/operator/bookings/${encodeURIComponent(id)}`, cookie)).text());
      assert.ok(text.includes(`Owner payable Due ${formatWat(due)}`), "survives restart");
    } finally { await restarted.close(); }

    // A revoked grant is denied and records nothing.
    const current = version((await page(f, id)).html, "blocking-complaint");
    revokeRepresentativeGrant(f.server.environment);
    assert.equal((await act(f, id, "blocking-complaint", { category: "access_failure" }, { basedOnVersion: current })).status, 404, "revoked grant");
    assert.equal(complaintRecords(f, id), 0);
  } finally { await f.close(); }
});

test("AC3 — You can report a Blocking Fulfilment Complaint, and while it is open the owner payable is not due", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f);
    await travelTo(f, new Date(WINDOW_OPENS.getTime() + 30 * MINUTE));
    assert.equal((await act(f, id, "verified-access", { basis: "staff_handover" })).status, 303);
    assert.match((await page(f, id)).text, /Owner payable Due/);

    for (const fields of [{}, { category: "noise" }, { category: "access_failure", note: "free text" }] as Record<string, string>[]) {
      assert.equal((await act(f, id, "blocking-complaint", fields)).status, 400);
    }
    await assertStandardRefusals(f, id, "blocking-complaint", { category: "habitability_failure" });

    assert.equal((await act(f, id, "blocking-complaint", { category: "habitability_failure" })).status, 303);
    assert.equal(complaintRecords(f, id), 1);
    const after = await page(f, id);
    assert.match(after.text, /Open Blocking Fulfilment Complaint Habitability failure/);
    assert.match(after.text, /Owner payable Not due while a Blocking Fulfilment Complaint is open/);
    assert.doesNotMatch(after.text, /Owner payable Due \d/);

    // Also blocks a payable before Verified Access is recorded.
    const early = await reservation(f, "2026-09-15", "2026-09-17");
    await travelTo(f, new Date("2026-09-15T13:10:00Z"));
    assert.equal((await act(f, early, "blocking-complaint", { category: "access_failure" })).status, 303);
    assert.equal((await act(f, early, "verified-access", { basis: "staff_handover" })).status, 303);
    assert.match((await page(f, early)).text, /Owner payable Not due while a Blocking Fulfilment Complaint is open/);
  } finally { await f.close(); }
});

test("AC4 — Recording Verified Access before the contractual check-in window, or twice, is refused", async () => {
  const f = await startSignedInOperator();
  try {
    const id = await reservation(f);
    // 1:59 PM WAT: one minute before the window opens.
    await travelTo(f, new Date(WINDOW_OPENS.getTime() - MINUTE));
    const early = await act(f, id, "verified-access", { basis: "guest_confirmed_directly" });
    assert.equal(early.status, 409);
    assert.match(visibleText(await early.text()), /cannot be recorded before the Contractual Check-In Window begins/);
    assert.equal(accessRecords(f, id), 0);

    f.advance(MINUTE);
    const firstVersion = version((await page(f, id)).html, "verified-access");
    assert.equal((await act(f, id, "verified-access", { basis: "guest_confirmed_directly" }, { basedOnVersion: firstVersion })).status, 303);
    // A second tab replays the same form: refused, nothing more recorded, and no second form offered.
    const twice = await act(f, id, "verified-access", { basis: "guest_confirmed_directly" }, { basedOnVersion: firstVersion });
    assert.equal(twice.status, 409);
    assert.equal(accessRecords(f, id), 1);
    assert.doesNotMatch((await page(f, id)).html, /action="[^"]+\/verified-access"/);

    // An unknown booking, or one that is not a Reservation, is not found.
    for (const target of ["request-that-does-not-exist"]) {
      const response = await operatorPost(f.session, `/operator/bookings/${target}/verified-access`, cookieOf(f), {}, { basedOnVersion: firstVersion, basis: "staff_handover" });
      assert.equal(response.status, 404);
    }
  } finally { await f.close(); }
});

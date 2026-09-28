import test from "node:test";
import assert from "node:assert/strict";
import { FOREIGN_ORIGIN, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { guestCardPayments } from "./helpers/guest-card-payment.js";
import { SECOND_OWNER, SECOND_OWNER_ID, SECOND_UNIT_ID, SECOND_UNIT_TITLE, addSecondOwner, visibleText } from "./helpers/back-office-page.js";

// B8 — calendar and date blocks (.scratch/operator-dashboard/issues/08-calendar-and-blocks.md, ADR 0039, 0072, 0078).

const MINUTE = 60_000;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";
/** The shared clock starts 3 Sept 2026, 11:00 AM WAT; the calendar opens on that day. */
const TODAY = "2026-09-03";

const unitOf = (f: SignedInOperator) => f.server.environment.config.unitId;

async function calendarPage(f: SignedInOperator, query = "", cookie = f.session.cookie): Promise<{ status: number; html: string; text: string }> {
  const response = await operatorGet(f.session, `/operator/calendar${query}`, cookie);
  const html = await response.text();
  return { status: response.status, html, text: visibleText(html) };
}

function apartment(html: string, unitId: string): string {
  const match = html.match(new RegExp(`<article class="ui-panel ui-stack bo-apartment" id="unit-${unitId}" data-unit-id="${unitId}">([\\s\\S]*?)</article>`));
  assert.ok(match, `apartment ${unitId} is listed`);
  return match[1]!;
}

/** One owner's section of the page. */
function ownerSection(html: string, ownerName: string): string {
  const section = [...html.matchAll(/<section class="bo-owner"[\s\S]*?<\/section>/g)].map((match) => match[0]).find((candidate) => candidate.includes(`>${ownerName}</h2>`));
  assert.ok(section, `owner section for ${ownerName}`);
  return section;
}

/** Every night row of one apartment: its date, its state code and the state as text. */
function nights(html: string, unitId: string): Map<string, { readonly state: string; readonly text: string }> {
  const rows = [...apartment(html, unitId).matchAll(/<tr data-date="(\d{4}-\d{2}-\d{2})" data-state="([a-z_]+)">([\s\S]*?)<\/tr>/g)];
  return new Map(rows.map((row) => [row[1]!, { state: row[2]!, text: visibleText(row[3]!).trim() }]));
}

function calendarVersion(html: string, unitId: string): string {
  const value = apartment(html, unitId).match(/action="\/operator\/calendar\/[^"]+\/blocks"[\s\S]*?name="basedOnVersion" value="([^"]+)"/)?.[1];
  assert.ok(value, `block form for ${unitId}`);
  return value;
}

interface BlockFields { readonly firstNight: string; readonly lastNight: string; readonly reason: string }
const OWNER_USE: BlockFields = { firstNight: "2026-09-24", lastNight: "2026-09-25", reason: "owner_use" };

async function block(f: SignedInOperator, unitId: string, fields: BlockFields, options: { cookie?: string; origin?: string; basedOnVersion?: string; extra?: Record<string, string> } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? calendarVersion((await calendarPage(f)).html, unitId);
  return operatorPost(f.session, `/operator/calendar/${encodeURIComponent(unitId)}/blocks`, options.cookie ?? f.session.cookie, options.origin ? { origin: options.origin } : {}, { basedOnVersion, ...fields, ...options.extra });
}

function removeVersion(html: string, unitId: string, blockId: string): string {
  const value = apartment(html, unitId).match(new RegExp(`action="/operator/calendar/${unitId}/blocks/${blockId}/remove"[\\s\\S]*?name="basedOnVersion" value="([^"]+)"`))?.[1];
  assert.ok(value, `remove form for ${blockId}`);
  return value;
}

async function remove(f: SignedInOperator, unitId: string, blockId: string, options: { cookie?: string; origin?: string; basedOnVersion?: string } = {}): Promise<Response> {
  const basedOnVersion = options.basedOnVersion ?? removeVersion((await calendarPage(f)).html, unitId, blockId);
  return operatorPost(f.session, `/operator/calendar/${encodeURIComponent(unitId)}/blocks/${encodeURIComponent(blockId)}/remove`, options.cookie ?? f.session.cookie, options.origin ? { origin: options.origin } : {}, { basedOnVersion });
}

/** Active Operator Blocks on the unit, read from the authoritative calendar. */
function activeBlocks(f: SignedInOperator, unitId = unitOf(f)) {
  return f.server.environment.calendar.listActiveCommitments({ unitId, start: TODAY, end: "2026-12-31", clock: f.now }).filter((commitment) => commitment.kind === "operator_block");
}

let guests = 0;
function pendingRequest(f: SignedInOperator, checkIn: string, checkOut: string, unitId?: string): string {
  guests += 1;
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `calendar-guest-${guests}`, guestName: `Calendar Guest ${guests}`, checkIn, checkOut, ...(unitId ? { unitId } : {}) }).facts.requestId;
}

async function paymentPending(f: SignedInOperator, checkIn: string, checkOut: string): Promise<string> {
  const id = pendingRequest(f, checkIn, checkOut);
  assert.equal((await decideRequest(f.session, id, "confirm")).status, 303);
  return id;
}

async function booked(f: SignedInOperator, checkIn: string, checkOut: string): Promise<string> {
  const id = await paymentPending(f, checkIn, checkOut);
  const guest = guestCardPayments(f.server.environment);
  try { guest.pay(id); } finally { guest.close(); }
  return id;
}

const audited = (f: SignedInOperator, type: string) => f.server.environment.audit.entries().filter((entry) => entry.type === type);

test("AC1 — For each apartment, a date range shows every day's state from the authoritative Availability Calendar, as text and not colour alone", async () => {
  const f = await startSignedInOperator();
  try {
    addSecondOwner(f.server.environment);
    await booked(f, "2026-09-15", "2026-09-17");
    await paymentPending(f, "2026-09-10", "2026-09-12");
    pendingRequest(f, "2026-09-05", "2026-09-07");
    f.server.environment.calendar.addOperatorBlock({ unitId: unitOf(f), operatorId: f.server.environment.config.operatorId, start: "2026-09-20", end: "2026-09-22", reason: "maintenance", clock: f.now });
    pendingRequest(f, "2026-09-08", "2026-09-09", SECOND_UNIT_ID);

    const page = await calendarPage(f);
    assert.equal(page.status, 200);
    // Grouped by owner, one calendar per apartment.
    const first = ownerSection(page.html, OWNER);
    assert.ok(first.includes(`data-unit-id="${unitOf(f)}"`) && first.includes(APARTMENT) && !first.includes(SECOND_UNIT_ID));
    assert.ok(ownerSection(page.html, SECOND_OWNER).includes(`data-unit-id="${SECOND_UNIT_ID}"`));
    assert.ok(page.html.indexOf(`>${SECOND_OWNER}</h2>`) < page.html.indexOf(`>${OWNER}</h2>`), "owners in name order");
    assert.match(page.text, new RegExp(SECOND_UNIT_TITLE));

    // Every day of the range has a row, each state written out as text.
    const days = nights(page.html, unitOf(f));
    assert.equal(days.size, 28, "four weeks from today");
    assert.equal([...days.keys()][0], TODAY);
    const expected: Record<string, [string, string]> = {
      "2026-09-03": ["available", "Available"],
      "2026-09-05": ["request_pending", "Request pending"],
      "2026-09-06": ["request_pending", "Request pending"],
      "2026-09-07": ["available", "Available"],
      "2026-09-10": ["payment_pending", "Payment Pending"],
      "2026-09-11": ["payment_pending", "Payment Pending"],
      "2026-09-12": ["available", "Available"],
      "2026-09-15": ["booked", "Booked"],
      "2026-09-16": ["booked", "Booked"],
      "2026-09-20": ["blocked", "Blocked"],
      "2026-09-21": ["blocked", "Blocked"],
      "2026-09-22": ["available", "Available"],
    };
    for (const [date, [state, label]] of Object.entries(expected)) {
      const day = days.get(date);
      assert.ok(day, `${date} is shown`);
      assert.equal(day.state, state, `${date} state`);
      assert.match(day.text, new RegExp(`${label}$`), `${date} says "${label}" in words`);
    }
    // Each apartment's calendar is its own; the second apartment has only its own request.
    const second = nights(page.html, SECOND_UNIT_ID);
    assert.equal(second.get("2026-09-08")!.state, "request_pending");
    assert.equal(second.get("2026-09-15")!.state, "available");
    // A table with headers, so the state is read with its date (ADR 0078).
    assert.match(apartment(page.html, unitOf(f)), /<th scope="col">Night<\/th><th scope="col">State<\/th>/);

    // Another range.
    const later = nights((await calendarPage(f, "?from=2026-09-15")).html, unitOf(f));
    assert.equal([...later.keys()][0], "2026-09-15");
    assert.equal(later.get("2026-09-15")!.state, "booked");
    // A malformed range falls back to today.
    assert.equal([...nights((await calendarPage(f, "?from=15-09-2026")).html, unitOf(f)).keys()][0], TODAY);

    // Expiry is read lazily from the clock: the unanswered request and the unpaid offer release their dates (ADR 0041, 0044).
    f.advance(31 * MINUTE);
    const expired = nights((await calendarPage(f)).html, unitOf(f));
    assert.equal(expired.get("2026-09-05")!.state, "available");
    assert.equal(expired.get("2026-09-10")!.state, "available");
    assert.equal(expired.get("2026-09-15")!.state, "booked");

    // A revoked grant hides that owner's apartments (ADR 0082).
    revokeRepresentativeGrant(f.server.environment, SECOND_OWNER_ID);
    const after = await calendarPage(f);
    assert.doesNotMatch(after.html, new RegExp(`${SECOND_UNIT_ID}|${SECOND_OWNER}`));

    // Without a session the page sends you to sign in (ADR 0086).
    const signedOut = await operatorGet(f.session, "/operator/calendar", "");
    assert.equal(signedOut.status, 303);
    assert.match(signedOut.headers.get("location") ?? "", /^\/operator\/login/);
  } finally { await f.close(); }
});

test("AC2 — You can block free dates and the block takes effect immediately; a block over an unconfirmed request is refused with a prompt to decline it first, and over a confirmed, Payment Pending or booked stay it is refused", async () => {
  const f = await startSignedInOperator();
  try {
    const unitId = unitOf(f);
    const env = f.server.environment;

    // Free dates: blocked at once.
    const done = await block(f, unitId, OWNER_USE);
    assert.equal(done.status, 303);
    assert.equal(done.headers.get("location"), `/operator/calendar?from=2026-09-24#unit-${unitId}`);
    const page = await calendarPage(f, "?from=2026-09-24");
    const days = nights(page.html, unitId);
    assert.equal(days.get("2026-09-24")!.state, "blocked");
    assert.equal(days.get("2026-09-25")!.state, "blocked");
    assert.equal(days.get("2026-09-26")!.state, "available", "the last night is included; the next day is not");
    assert.match(visibleText(apartment(page.html, unitId)), /24 Sept 2026 to 25 Sept 2026 .*Owner use/);
    assert.equal(env.calendar.getAuthoritativeAvailability({ unitId, checkIn: "2026-09-25", checkOut: "2026-09-27", clock: f.now }).isAvailable, false);
    assert.throws(() => pendingRequest(f, "2026-09-25", "2026-09-27"), /unavailable/i, "a Guest can no longer request the blocked dates");
    assert.equal(audited(f, "operator_block_added").length, 1);
    // A replay of the same block records nothing new (ADR 0072).
    const version = calendarVersion((await calendarPage(f)).html, unitId);
    assert.equal((await block(f, unitId, OWNER_USE, { basedOnVersion: "0000000000000000" })).status, 303);
    assert.equal(activeBlocks(f).length, 1);

    // Over an unconfirmed request: refused, with a prompt to decline it first.
    const requestId = pendingRequest(f, "2026-09-05", "2026-09-07");
    let refused = await block(f, unitId, { firstNight: "2026-09-06", lastNight: "2026-09-08", reason: "owner_use" });
    assert.equal(refused.status, 409);
    let html = await refused.text();
    assert.match(visibleText(html), /A Booking Request is waiting for your answer on these dates\. Decline it first, then block the dates\. Nothing was blocked\./);
    assert.match(html, new RegExp(`href="/operator/requests/${requestId}"`));
    // Over Payment Pending (confirmed, awaiting payment): refused; it needs human handling (ADR 0039).
    await paymentPending(f, "2026-09-10", "2026-09-12");
    refused = await block(f, unitId, { firstNight: "2026-09-11", lastNight: "2026-09-11", reason: "off_platform_booking" });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /These dates are confirmed and awaiting payment \(Payment Pending\)\. A block cannot displace them: this needs human handling\. Nothing was blocked\./);
    // Over a booked stay: refused.
    await booked(f, "2026-09-15", "2026-09-17");
    refused = await block(f, unitId, { firstNight: "2026-09-14", lastNight: "2026-09-15", reason: "maintenance" });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /These dates are booked\. A booked stay cannot be overridden\. Nothing was blocked\./);
    // Over dates already blocked: refused.
    refused = await block(f, unitId, { firstNight: "2026-09-25", lastNight: "2026-09-26", reason: "maintenance" });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /These dates are already blocked\. Nothing was blocked\./);
    assert.equal(activeBlocks(f).length, 1, "no refused block was recorded");
    assert.equal(audited(f, "operator_block_refused").length, 4);

    // What was typed: refused with 400, nothing recorded.
    const current = calendarVersion((await calendarPage(f)).html, unitId);
    for (const [fields, message] of [
      [{ ...OWNER_USE, reason: "" }, /Choose why the dates are blocked/],
      [{ ...OWNER_USE, reason: "guest name" }, /Choose why the dates are blocked/],
      [{ ...OWNER_USE, firstNight: "" }, /Enter the first and last blocked nights/],
      [{ ...OWNER_USE, lastNight: "2026-09-31" }, /Enter the first and last blocked nights/],
      [{ firstNight: "2026-09-28", lastNight: "2026-09-27", reason: "owner_use" }, /The last night must be on or after the first night/],
      [{ firstNight: "2026-09-02", lastNight: "2026-09-04", reason: "owner_use" }, /The first night cannot be before today/],
    ] as const) {
      const response = await block(f, unitId, fields, { basedOnVersion: current });
      assert.equal(response.status, 400, JSON.stringify(fields));
      assert.match(visibleText(await response.text()), message);
    }
    assert.equal((await block(f, unitId, OWNER_USE, { basedOnVersion: current, extra: { guestName: "x" } })).status, 400, "an unexpected field");
    assert.equal(activeBlocks(f).length, 1);

    // The standard failure paths.
    const fresh: BlockFields = { firstNight: "2026-09-28", lastNight: "2026-09-28", reason: "owner_use" };
    assert.equal((await block(f, unitId, fresh, { cookie: "", basedOnVersion: current })).status, 401, "no session");
    assert.equal((await block(f, unitId, fresh, { origin: FOREIGN_ORIGIN, basedOnVersion: current })).status, 403, "cross-origin POST");
    refused = await block(f, unitId, fresh, { basedOnVersion: version });
    assert.equal(refused.status, 409, "a stale calendar");
    assert.match(visibleText(await refused.text()), /The calendar changed since you opened it\. Review it and try again\. Nothing was blocked\./);
    assert.equal((await block(f, "unit-unknown", fresh, { basedOnVersion: current })).status, 404, "an unknown apartment");
    revokeRepresentativeGrant(env);
    assert.equal((await block(f, unitId, fresh, { basedOnVersion: current })).status, 404, "a revoked grant");
    assert.equal(activeBlocks(f).length, 1);
  } finally { await f.close(); }
});

test("AC3 — You can remove a block, and the dates become available again unless another commitment holds them", async () => {
  const f = await startSignedInOperator();
  try {
    const unitId = unitOf(f);
    const env = f.server.environment;
    assert.equal((await block(f, unitId, OWNER_USE)).status, 303);
    assert.equal((await block(f, unitId, { firstNight: "2026-09-26", lastNight: "2026-09-27", reason: "maintenance" })).status, 303);
    const [first, second] = activeBlocks(f).sort((a, b) => a.start.localeCompare(b.start));
    assert.ok(first && second);
    const staleVersion = removeVersion((await calendarPage(f)).html, unitId, first.commitmentId);

    const done = await remove(f, unitId, first.commitmentId);
    assert.equal(done.status, 303);
    assert.equal(done.headers.get("location"), `/operator/calendar?from=2026-09-24#unit-${unitId}`);
    const days = nights((await calendarPage(f, "?from=2026-09-24")).html, unitId);
    assert.equal(days.get("2026-09-24")!.state, "available");
    assert.equal(days.get("2026-09-25")!.state, "available");
    // The other block still holds its dates.
    assert.equal(days.get("2026-09-26")!.state, "blocked");
    assert.equal(days.get("2026-09-27")!.state, "blocked");
    assert.equal(audited(f, "operator_block_removed").length, 1);
    // Guests can find and request the freed dates again: the discovery projection no longer lists the removed block.
    const unit = env.unitRepository.findById(unitId)!;
    assert.deepEqual(unit.blockedDates.map((range: { start: string; end: string }) => `${range.start}/${range.end}`), ["2026-09-26/2026-09-28"]);
    const requestId = pendingRequest(f, "2026-09-24", "2026-09-26");
    // Now a request holds them: they are not available, and the request cannot be removed as a block.
    assert.equal(nights((await calendarPage(f, "?from=2026-09-24")).html, unitId).get("2026-09-24")!.state, "request_pending");
    assert.ok(requestId);

    // A block already removed is refused.
    let refused = await remove(f, unitId, first.commitmentId, { basedOnVersion: staleVersion });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This block was already removed\. Nothing was changed\./);

    // A block the platform set (a missed turnover deadline, ADR 0036) has no remove form and cannot be removed here.
    const platform = env.calendar.addOperatorBlock({ unitId, operatorId: env.config.operatorId, start: "2026-09-29", end: "2026-09-30", reason: "Availability protected due to missed turnover deadline", clock: f.now });
    const page = await calendarPage(f, "?from=2026-09-24");
    assert.doesNotMatch(apartment(page.html, unitId), new RegExp(`/blocks/${platform.blockId}/remove`));
    assert.match(visibleText(apartment(page.html, unitId)), /29 Sept 2026 \(one night\) .*Set by the platform/);
    const current = removeVersion(page.html, unitId, second.commitmentId);
    refused = await remove(f, unitId, platform.blockId, { basedOnVersion: current });
    assert.equal(refused.status, 409);
    assert.match(visibleText(await refused.text()), /This block was set by the platform and cannot be removed here\. Nothing was changed\./);

    // The standard failure paths.
    assert.equal((await remove(f, unitId, second.commitmentId, { cookie: "", basedOnVersion: current })).status, 401, "no session");
    assert.equal((await remove(f, unitId, second.commitmentId, { origin: FOREIGN_ORIGIN, basedOnVersion: current })).status, 403, "cross-origin POST");
    refused = await remove(f, unitId, second.commitmentId, { basedOnVersion: staleVersion });
    assert.equal(refused.status, 409, "a stale calendar");
    assert.match(visibleText(await refused.text()), /The calendar changed since you opened it\. Review it and try again\. Nothing was changed\./);
    assert.equal((await remove(f, unitId, "blk-unknown", { basedOnVersion: current })).status, 409, "an unknown block");
    revokeRepresentativeGrant(env);
    assert.equal((await remove(f, unitId, second.commitmentId, { basedOnVersion: current })).status, 404, "a revoked grant");
    assert.equal(activeBlocks(f).length, 2, "the second block and the platform block remain");
  } finally { await f.close(); }
});

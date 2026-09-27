import test from "node:test";
import assert from "node:assert/strict";
import { crossOriginPost, decideRequest, operatorGet, operatorPost, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";
import { formatStayDates } from "../apps/web-agent/src/booking-presentation.js";
import { OPERATOR_RESPONSE_REMINDER_MINUTES, OPERATOR_RESPONSE_WINDOW_MINUTES } from "../domains/shortlet/src/index.js";

// B2 — request inbox: deadlines and owners (scratch/operator-dashboard/issues/02-request-inbox.md).

const MINUTE = 60_000;
const OWNER = "Eko Prime Living Ltd";
const APARTMENT = "Luxury 2-Bedroom Apartment in Old Ikoyi";

let guests = 0;
function request(f: SignedInOperator, input: { checkIn: string; checkOut: string; guestName?: string; delivered?: boolean }) {
  guests += 1;
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `inbox-guest-${guests}`, guestName: input.guestName ?? `Guest ${guests}`, checkIn: input.checkIn, checkOut: input.checkOut, ...(input.delivered === undefined ? {} : { delivered: input.delivered }) });
}

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function inbox(f: SignedInOperator): Promise<string> {
  const response = await operatorGet(f.session, "/operator/requests");
  assert.equal(response.status, 200);
  return response.text();
}

/** Inbox rows in page order, keyed by request id. */
function rows(html: string): { id: string; html: string; text: string }[] {
  return [...html.matchAll(/<li class="bo-request"[^>]*data-request-id="([^"]+)"[\s\S]*?<\/li>/g)].map((match) => ({ id: match[1]!, html: match[0], text: visibleText(match[0]) }));
}

function row(html: string, id: string) {
  const found = rows(html).find((candidate) => candidate.id === id);
  assert.ok(found, `row for ${id}`);
  return found;
}

const status = (f: SignedInOperator, id: string) => f.server.environment.bookingRequestApp.manager.getRequest(id).status;

test("AC1 — Requests awaiting a response come first, ordered by deadline, each showing its owner and apartment, the absolute WAT deadline, and the time left from server time", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const decided = request(f, { checkIn: "2026-09-25", checkOut: "2026-09-27" });
    f.server.environment.confirmBookingRequest(decided.facts.requestId);
    f.advance(MINUTE);
    const first = request(f, { checkIn: "2026-09-10", checkOut: "2026-09-13", guestName: "Adaeze Okafor" }); // disclosed 10:01Z, deadline 10:31Z
    f.advance(5 * MINUTE);
    const second = request(f, { checkIn: "2026-09-20", checkOut: "2026-09-22", guestName: "Tunde Bakare" }); // disclosed 10:06Z, deadline 10:36Z
    f.advance(MINUTE); // server time 10:07Z

    const html = await inbox(f);
    assert.deepEqual(rows(html).map((candidate) => candidate.id), [first.facts.requestId, second.facts.requestId, decided.facts.requestId], "awaiting first by deadline, decided after");

    const a = row(html, first.facts.requestId);
    assert.match(a.text, new RegExp(OWNER));
    assert.match(a.text, new RegExp(APARTMENT));
    assert.match(a.text, /Adaeze Okafor/);
    assert.ok(a.text.includes(formatStayDates("2026-09-10", "2026-09-13")), "stay dates");
    assert.match(a.text, /1 occupant/);
    assert.ok(a.text.includes(formatMoney(first.facts.quote!.allInStayTotalKobo)), "All-In Stay Total");
    assert.match(a.text, /All-In Stay Total/);
    assert.match(a.text, /Respond by 3 Sept 2026, 11:31 WAT/, "absolute WAT deadline");
    assert.match(a.html, /<time datetime="2026-09-03T10:31:00.000Z"/, "projected deadline instant (ADR 0077)");
    assert.match(a.text, /24 minutes left/, "time left from server time");
    assert.match(row(html, second.facts.requestId).text, /29 minutes left/);
    assert.match(visibleText(html), /2 requests need your response/);

    // Time left follows the server clock on the next read, not the moment of disclosure.
    f.advance(20 * MINUTE);
    assert.match(row(await inbox(f), first.facts.requestId).text, /4 minutes left/);
  } finally { await f.close(); }
});

test("AC2 — A request whose window has passed shows as expired on the next read without a background job and cannot be confirmed", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const expiring = request(f, { checkIn: "2026-09-10", checkOut: "2026-09-13" });
    const id = expiring.facts.requestId;
    f.advance(OPERATOR_RESPONSE_WINDOW_MINUTES * MINUTE - 1_000);
    assert.equal(row(await inbox(f), id).html.includes('data-status="disclosed"'), true, "still awaiting one second before the deadline");

    f.advance(1_000);
    // Nothing ran between reads: the stored record is still disclosed until something reads it.
    assert.equal(status(f, id), "disclosed");
    const html = await inbox(f);
    const expired = row(html, id);
    assert.match(expired.html, /data-status="expired"/);
    assert.match(expired.text, /Request expired/);
    assert.doesNotMatch(expired.text, /minutes? left/);
    assert.equal(status(f, id), "expired", "the read resolved expiry lazily");

    // It cannot be confirmed, and the refusal changes nothing.
    const refused = await decideRequest(f.session, id, "confirm", { basedOnVersion: "3" });
    assert.equal(refused.status, 409);
    assert.equal(status(f, id), "expired");
    assert.doesNotMatch(await (await operatorGet(f.session, `/operator/requests/${id}`)).text(), /action="[^"]*\/confirm"/);

    // Standard failure paths on the same target.
    assert.equal((await operatorPost(f.session, `/operator/requests/${id}/confirm`, "")).status, 401);
    assert.equal((await crossOriginPost(f.session, `/operator/requests/${id}/confirm`)).status, 403);
    revokeRepresentativeGrant(f.server.environment);
    assert.doesNotMatch(await inbox(f), new RegExp(id), "a revoked grant hides the owner's requests");
  } finally { await f.close(); }
});

test("AC3 — A request that failed delivery is shown as Delivery Failed, never as a missed response", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const undelivered = request(f, { checkIn: "2026-09-10", checkOut: "2026-09-13", delivered: false });
    const id = undelivered.facts.requestId;
    const pending = row(await inbox(f), id);
    assert.match(pending.text, /Delivery pending/);
    assert.doesNotMatch(pending.text, /minutes? left|Respond by/, "the operator clock has not started (ADR 0041)");

    f.advance(6 * MINUTE); // past the five-minute Technical Delivery Window (ADR 0043)
    const failed = row(await inbox(f), id);
    assert.match(failed.html, /data-status="delivery_failed"/);
    assert.match(failed.text, /Delivery Failed/);
    assert.doesNotMatch(failed.text, /expired|missed|timed out|Respond by|minutes? left/i);

    // Still Delivery Failed after the would-be response deadline, never re-labelled as a timeout.
    f.advance(30 * MINUTE);
    const later = row(await inbox(f), id);
    assert.match(later.text, /Delivery Failed/);
    assert.doesNotMatch(later.text, /expired/i);
    assert.equal(status(f, id), "delivery_failed");

    const events = f.server.environment.audit.entries().filter((entry) => entry.requestId === id).map((entry) => entry.type);
    assert.ok(events.includes("booking_request.delivery_failed"));
    assert.ok(!events.includes("booking_request.expired"), "no operator-timeout record for a delivery failure");

    // It is not waiting on you, and it cannot be decided.
    assert.doesNotMatch(await (await operatorGet(f.session, "/operator")).text(), new RegExp(id));
    assert.equal((await decideRequest(f.session, id, "confirm", { basedOnVersion: "3" })).status, 409);
    assert.equal(status(f, id), "delivery_failed");
  } finally { await f.close(); }
});

test("AC4 — At 10 and 25 minutes the request shows a reminder state announced once, and without JavaScript the absolute deadline is still shown", async () => {
  assert.deepEqual([...OPERATOR_RESPONSE_REMINDER_MINUTES], [10, 25], "ADR 0041 reminder offsets");
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const early = request(f, { checkIn: "2026-09-10", checkOut: "2026-09-13" });
    const id = early.facts.requestId;

    f.advance(10 * MINUTE - 1_000);
    const before = await inbox(f);
    assert.doesNotMatch(row(before, id).html, /data-reminder=/);
    assert.equal(before.match(/role="status"/g)?.length ?? 0, 1, "one live region");
    assert.match(before, /data-announce=""/, "nothing to announce before 10 minutes");

    f.advance(1_000); // 10 minutes after disclosure
    const ten = await inbox(f);
    assert.match(row(ten, id).html, /data-reminder="10"/);
    assert.match(row(ten, id).text, /Reminder: 20 minutes left/);
    assert.equal(ten.match(/role="status"/g)?.length, 1, "a single live region for the page, not one per row");
    assert.doesNotMatch(row(ten, id).html, /role="(status|alert)"|aria-live/, "rows are not live regions");
    assert.match(ten, new RegExp(`data-announce-key="${id}:10"`));
    assert.match(ten, /data-announce="1 request has reached a reminder\./);

    f.advance(15 * MINUTE); // 25 minutes after disclosure
    const twentyFive = await inbox(f);
    assert.match(row(twentyFive, id).html, /data-reminder="25"/);
    assert.match(row(twentyFive, id).text, /Final reminder: 5 minutes left/);
    assert.match(twentyFive, new RegExp(`data-announce-key="${id}:25"`), "a new reminder gets a new announcement key");

    // Announced once: the enhancement only speaks a key it has not spoken before, so a re-render does not repeat it.
    const script = twentyFive.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    assert.match(script, /sessionStorage/);
    assert.match(script, /announceKey/);

    // Without JavaScript the absolute deadline and the reminder are plain server-rendered text.
    const noScript = visibleText(twentyFive);
    assert.match(noScript, /Respond by 3 Sept 2026, 11:30 WAT/);
    assert.match(noScript, /Final reminder: 5 minutes left/);
  } finally { await f.close(); }
});

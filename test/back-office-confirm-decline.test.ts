import test from "node:test";
import assert from "node:assert/strict";
import { crossOriginPost, decideRequest, operatorGet, operatorPost, renderedDecisionVersion, revokeRepresentativeGrant, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";
import { OPERATOR_RESPONSE_WINDOW_MINUTES } from "../domains/shortlet/src/index.js";

// B3 — confirm on the owner's behalf; decline with a reason (scratch/operator-dashboard/issues/03-confirm-and-decline.md).

const MINUTE = 60_000;
const OWNER = "Eko Prime Living Ltd";

let guests = 0;
function request(f: SignedInOperator, checkIn = "2026-09-10", checkOut = "2026-09-13"): string {
  guests += 1;
  return f.server.environment.createDemoIncomingBookingRequest({ guestId: `decision-guest-${guests}`, checkIn, checkOut }).facts.requestId;
}

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

async function detail(f: SignedInOperator, id: string): Promise<string> {
  const response = await operatorGet(f.session, `/operator/requests/${id}`);
  assert.equal(response.status, 200);
  return response.text();
}

function form(html: string, action: "confirm" | "decline"): string {
  const match = html.match(new RegExp(`<form method="post" action="/operator/requests/[^"]+/${action}"[\\s\\S]*?</form>`));
  assert.ok(match, `${action} form`);
  return match[0];
}

const status = (f: SignedInOperator, id: string) => f.server.environment.bookingRequestApp.manager.getRequest(id).status;
const offers = (f: SignedInOperator) => f.server.environment.audit.entries().filter((entry) => entry.type === "operator_request_confirmed").length;
const calendarEvents = (f: SignedInOperator, id: string) => f.server.environment.audit.entries().filter((entry) => entry.type === "calendar_accuracy_event" && entry.requestId === id);
const guestView = (f: SignedInOperator, id: string) => f.server.environment.bookingRequestApp.getArtifact(id, { id: f.server.environment.bookingRequestApp.manager.getRequest(id).primaryGuest.id, role: "guest", tenantId: f.server.environment.config.tenantId });

/** The four standard failure paths for an action, none of which may change the request. */
async function assertStandardRefusals(f: SignedInOperator, id: string, decision: "confirm" | "decline") {
  const version = await renderedDecisionVersion(f.session, id);
  assert.equal((await decideRequest(f.session, id, decision, { cookie: "", basedOnVersion: version })).status, 401, "no session");
  assert.equal((await crossOriginPost(f.session, `/operator/requests/${id}/${decision}`)).status, 403, "cross-origin POST");
  assert.equal((await decideRequest(f.session, id, decision, { basedOnVersion: String(Number(version) - 1) })).status, 409, "stale version");
  assert.equal(status(f, id), "disclosed");
}

test("AC1 — Confirm names the owner, lists what you attest for them (availability, price, included services, arrival, maintenance, access, no external conflict), and fails closed without an explicit affirmative", async () => {
  const f = await startSignedInOperator();
  try {
    const id = request(f);
    const confirm = form(await detail(f, id), "confirm");
    const text = visibleText(confirm);
    assert.match(text, new RegExp(`on behalf of ${OWNER}`));
    for (const item of ["Availability", "Price", "Included services", "Arrival", "Maintenance", "Access", "No external conflict"]) {
      assert.match(text, new RegExp(`\\b${item}\\b`), `attests ${item}`);
    }
    assert.match(confirm, /<input type="checkbox" name="attest" value="yes"[^>]*required/, "explicit affirmative");
    assert.match(confirm, /<input type="hidden" name="basedOnVersion" value="\d+">/);

    // Without the affirmative the server refuses, even with the browser's `required` bypassed.
    const version = await renderedDecisionVersion(f.session, id);
    for (const body of [{ basedOnVersion: version }, { basedOnVersion: version, attest: "" }, { basedOnVersion: version, attest: "no" }] as Record<string, string>[]) {
      const refused = await operatorPost(f.session, `/operator/requests/${id}/confirm`, f.session.cookie, {}, body);
      assert.equal(refused.status, 400);
      assert.match(visibleText(await refused.text()), /Tick the box to attest/);
      assert.equal(status(f, id), "disclosed");
    }
    assert.equal(offers(f), 0);

    await assertStandardRefusals(f, id, "confirm");
    revokeRepresentativeGrant(f.server.environment);
    assert.equal((await decideRequest(f.session, id, "confirm", { basedOnVersion: version })).status, 409, "revoked grant");
    assert.equal(status(f, id), "disclosed");
  } finally { await f.close(); }
});

test("AC2 — Confirm says it creates a Conditional Booking Offer and that the stay becomes a Reservation only after the Guest pays", async () => {
  const f = await startSignedInOperator();
  try {
    const id = request(f);
    const text = visibleText(form(await detail(f, id), "confirm"));
    assert.match(text, /Confirming creates a Conditional Booking Offer for the Guest\./);
    assert.match(text, /The stay becomes a Reservation only after the Guest pays\./);

    const confirmed = await decideRequest(f.session, id, "confirm");
    assert.equal(confirmed.status, 303);
    assert.equal(status(f, id), "confirmed");
    assert.equal(offers(f), 1);
    assert.equal(calendarEvents(f, id).length, 0, "confirming records no calendar-accuracy event");
  } finally { await f.close(); }
});

test("AC3 — Decline requires \"Dates not available\" or \"Other reason\", says the dates are released immediately, records a calendar-accuracy event only for \"Dates not available\", and the Guest never sees the reason", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    const unavailable = request(f, "2026-09-10", "2026-09-13");
    const other = request(f, "2026-09-20", "2026-09-22");
    const decline = form(await detail(f, unavailable), "decline");
    assert.deepEqual([...decline.matchAll(/<input type="radio" name="reason" value="([a-z_]+)"[^>]*required/g)].map((match) => match[1]), ["dates_not_available", "other_reason"]);
    assert.match(visibleText(decline), /Dates not available/);
    assert.match(visibleText(decline), /Other reason/);
    assert.doesNotMatch(decline, /<textarea|type="text"/, "no free text (ADR 0075)");
    assert.match(visibleText(decline), /Declining releases these dates immediately\./);
    assert.match(visibleText(decline), /The Guest never sees the reason\./);

    // A missing or unknown reason is refused and changes nothing.
    const version = await renderedDecisionVersion(f.session, unavailable);
    for (const body of [{ basedOnVersion: version }, { basedOnVersion: version, reason: "" }, { basedOnVersion: version, reason: "Dates unavailable due to private maintenance" }, { basedOnVersion: version, reason: "dates_not_available", note: "free text" }] as Record<string, string>[]) {
      const refused = await operatorPost(f.session, `/operator/requests/${unavailable}/decline`, f.session.cookie, {}, body);
      assert.equal(refused.status, 400, JSON.stringify(body));
      assert.equal(status(f, unavailable), "disclosed");
    }
    await assertStandardRefusals(f, unavailable, "decline");

    f.advance(MINUTE);
    assert.equal((await decideRequest(f.session, unavailable, "decline", { reason: "dates_not_available" })).status, 303);
    assert.equal((await decideRequest(f.session, other, "decline", { reason: "other_reason" })).status, 303);
    assert.equal(status(f, unavailable), "declined");
    assert.equal(status(f, other), "declined");

    // The dates are released immediately: the same dates can be requested again at once.
    assert.doesNotThrow(() => request(f, "2026-09-10", "2026-09-13"));

    const [event, ...extra] = calendarEvents(f, unavailable);
    assert.ok(event, "calendar-accuracy event for Dates not available");
    assert.equal(extra.length, 0);
    const { unitId, operatorId, tenantId } = f.server.environment.config;
    assert.deepEqual(
      Object.fromEntries(Object.entries(event).filter(([key]) => key !== "recordedAt")),
      { type: "calendar_accuracy_event", impactClass: "unavailable_request_decline", requestId: unavailable, unitId, operatorId, tenantId, reasonCode: "dates_not_available", occurredAt: "2026-09-03T10:01:00.000Z" },
      "minimal: no free text and no guest data (ADR 0075)",
    );
    assert.equal(calendarEvents(f, other).length, 0, "no calendar-accuracy event for Other reason");

    // The Guest never sees the reason.
    for (const id of [unavailable, other]) {
      const guest = JSON.stringify(guestView(f, id));
      assert.match(guest, /"status":"declined"/);
      assert.doesNotMatch(guest, /dates_not_available|other_reason|Dates not available|Other reason/i);
    }
  } finally { await f.close(); }
});

test("AC4 — A decision on a request already decided, expired, or at a stale version is refused and the current state is shown", async () => {
  const f = await startSignedInOperator({ start: "2026-09-03T10:00:00Z" });
  try {
    // Already decided: a second decision (or a repeat of the same one) is refused; no second offer.
    const decided = request(f, "2026-09-10", "2026-09-13");
    const version = await renderedDecisionVersion(f.session, decided);
    assert.equal((await decideRequest(f.session, decided, "confirm", { basedOnVersion: version })).status, 303);
    for (const decision of ["confirm", "decline"] as const) {
      const refused = await decideRequest(f.session, decided, decision, { basedOnVersion: version });
      assert.equal(refused.status, 409);
      const page = visibleText(await refused.text());
      assert.match(page, /This request is already confirmed\. Your decision was not applied\./);
      assert.match(page, /Request confirmed/);
    }
    assert.equal(offers(f), 1, "no second Conditional Booking Offer");
    assert.equal(status(f, decided), "confirmed");

    // Stale version: a form rendered from another version is refused and the current state is shown.
    const stale = request(f, "2026-09-20", "2026-09-22");
    const staleResponse = await decideRequest(f.session, stale, "decline", { basedOnVersion: "2" });
    assert.equal(staleResponse.status, 409);
    assert.match(visibleText(await staleResponse.text()), /This request changed since you opened it\. Review it and decide again\./);
    assert.equal(status(f, stale), "disclosed");

    // Two tabs rendered at the same version: exactly one decision lands.
    const raced = request(f, "2026-09-25", "2026-09-27");
    const shared = await renderedDecisionVersion(f.session, raced);
    const [a, b] = await Promise.all([
      decideRequest(f.session, raced, "confirm", { basedOnVersion: shared }),
      decideRequest(f.session, raced, "decline", { basedOnVersion: shared, reason: "other_reason" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [303, 409]);

    // Expired: the window passed between rendering and submitting.
    const expiring = request(f, "2026-10-01", "2026-10-03");
    const rendered = await renderedDecisionVersion(f.session, expiring);
    f.advance(OPERATOR_RESPONSE_WINDOW_MINUTES * MINUTE);
    const expired = await decideRequest(f.session, expiring, "confirm", { basedOnVersion: rendered });
    assert.equal(expired.status, 409);
    assert.match(visibleText(await expired.text()), /This request has expired\. Your decision was not applied\./);
    assert.equal(status(f, expiring), "expired");
  } finally { await f.close(); }
});

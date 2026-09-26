import test from "node:test";
import assert from "node:assert/strict";
import { CRITERIA_EDIT_EVENT, CRITERIA_UNDO_EVENT, criteriaSurfaceId, type GuestCriteria, type GuestStateSnapshot, type GuestSurfacePayload, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { restartFixture } from "./helpers/guest-restart.js";

type Fixture = Awaited<ReturnType<typeof restartFixture>>;

function snapshot(state: GuestStateSnapshot | { ok: false; code: string }): GuestStateSnapshot {
  assert.equal(state.ok, true, JSON.stringify(state));
  return state as GuestStateSnapshot;
}

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function rejected(result: GuestTurnResult, code: string): string {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(!result.ok && result.code, code);
  return result.ok ? "" : result.message;
}

function criteriaEvent(fixture: Fixture, name: string, context: Readonly<Record<string, unknown>>) {
  return fixture.send("/api/event", { name, surfaceId: criteriaSurfaceId(fixture.threadId), sourceComponentId: "criteria-strip", timestamp: new Date().toISOString(), context });
}

/** The unit ids a discovery surface lists, in order. */
function unitIds(surface: GuestSurfacePayload): string[] {
  return [...new Set([...JSON.stringify(surface.a2uiMessages).matchAll(/"unitId":"([^"]+)"/g)].map((match) => match[1]!))];
}

async function criteriaNow(fixture: Fixture): Promise<GuestCriteria> {
  const criteria = snapshot(await fixture.state()).criteria;
  assert.ok(criteria, "the strip is present");
  return criteria;
}

test("AC1: The strip always shows the current server-side criteria after each turn", async () => {
  const fixture = await restartFixture();
  try {
    // Failure path: a greeting establishes no criteria, so there is no strip.
    assert.equal(success(await fixture.send("/api/turn", { text: "hello" })).criteria, undefined);

    const where = success(await fixture.send("/api/turn", { text: "I'm looking for a stay in Ikoyi" })).criteria;
    assert.deepEqual([where?.where?.label, where?.when, where?.guests], ["Old Ikoyi, Lagos", undefined, undefined]);
    assert.equal(where?.where?.area, "old-ikoyi");

    const guests = success(await fixture.send("/api/turn", { text: "2 guests" })).criteria;
    assert.equal(guests?.guests?.label, "2 guests");

    const full = success(await fixture.send("/api/turn", { text: "from 10 Sept for 3 nights" }));
    assert.equal(full.criteria?.when?.label, "10–13 Sept 2026 · 3 nights");
    assert.equal(full.criteria?.when?.checkIn, "2026-09-10");
    assert.equal(full.criteria?.editable, true);
    assert.equal(full.criteria?.canUndo, false, "one search has nothing to undo");

    // A typed change is reflected too, and reload shows the same criteria.
    const changed = success(await fixture.send("/api/turn", { text: "actually make it 4 guests" }));
    assert.equal(changed.criteria?.guests?.count, 4);
    await fixture.restart();
    assert.deepEqual(await criteriaNow(fixture), changed.criteria);
  } finally { await fixture.close(); }
});

test("AC2: Editing a chip re-runs the search and replaces the results surface without a typed message", async () => {
  const fixture = await restartFixture();
  try {
    const search = await fixture.advance("discovery");
    const before = await criteriaNow(fixture);
    const timelineBefore = snapshot(await fixture.state()).timeline.filter((entry) => entry.role === "user").length;

    const guests = success(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 3, basedOn: before.key }));
    const results = guests.surfaces[0]!;
    assert.match(results.surfaceId, /:discovery:results:2$/);
    assert.notEqual(results.surfaceId, search.surfaces[0]!.surfaceId);
    assert.match(results.conventionalRoute ?? "", /partySize=3/);
    assert.equal(guests.criteria?.guests?.count, 3);
    assert.equal(guests.criteria?.canUndo, true);
    assert.match(guests.messages.join(" "), /^I found \d+ eligible place/);

    const where = success(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "where", area: "lekki-phase-1", basedOn: guests.criteria!.key }));
    assert.equal(where.criteria?.where?.label, "Lekki Phase 1, Lagos");
    assert.match(where.surfaces[0]!.conventionalRoute ?? "", /neighbourhood=Lekki\+Phase\+1/);
    assert.notDeepEqual(unitIds(where.surfaces[0]!), unitIds(search.surfaces[0]!));

    const when = success(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-09-12", nights: 2, basedOn: where.criteria!.key }));
    assert.equal(when.criteria?.when?.label, "12–14 Sept 2026 · 2 nights");
    assert.match(when.surfaces[0]!.conventionalRoute ?? "", /checkIn=2026-09-12&checkOut=2026-09-14/);

    // No typed message was added by any edit.
    assert.equal(snapshot(await fixture.state()).timeline.filter((entry) => entry.role === "user").length, timelineBefore);

    // Failure paths: stale criteria, an unknown area, extra keys and a non-integer all fail closed.
    rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2, basedOn: before.key }), "STALE_SURFACE");
    const key = when.criteria!.key;
    rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "where", area: "mars", basedOn: key }), "INVALID_CRITERIA");
    rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 2, basedOn: key, unitId: "x" }), "INVALID_CRITERIA");
    rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 1.5, basedOn: key }), "INVALID_CRITERIA");
    rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-02-30", nights: 2, basedOn: key }), "INVALID_CRITERIA");
    assert.equal((await criteriaNow(fixture)).key, key);
  } finally { await fixture.close(); }

  // Failure path: once a Booking Request is sent, the strip cannot change its search.
  const sent = await restartFixture();
  try {
    await sent.advance("pending");
    const criteria = await criteriaNow(sent);
    assert.equal(criteria.editable, false);
    const message = rejected(await criteriaEvent(sent, CRITERIA_EDIT_EVENT, { field: "guests", partySize: 3, basedOn: criteria.key }), "CRITERIA_LOCKED");
    assert.match(message, /A sent Booking Request can't be changed/);
    assert.equal(sent.environment.interactionStore.listBookingRequestIds().length, 1);
  } finally { await sent.close(); }
});

test("AC3: An edit that breaks policy (for example 15 nights) is rejected inline with the limit stated, and the previous value is kept", async () => {
  const fixture = await restartFixture();
  try {
    const search = await fixture.advance("discovery");
    const before = snapshot(await fixture.state());
    const message = rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-09-10", nights: 15, basedOn: before.criteria!.key }), "CRITERIA_REJECTED");
    assert.equal(message, "Stays can be at most 14 nights. Please choose 14 nights or fewer.");
    const tooFar = rejected(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2027-01-10", nights: 2, basedOn: before.criteria!.key }), "CRITERIA_REJECTED");
    assert.match(tooFar, /at most 90 days ahead/);

    const after = snapshot(await fixture.state());
    assert.deepEqual(after.criteria, before.criteria, "the previous criteria are kept");
    assert.equal(after.surfaces[0]!.surfaceId, search.surfaces[0]!.surfaceId, "the results were not replaced");
    assert.deepEqual(after.timeline, before.timeline, "a refused edit adds nothing to the conversation");
  } finally { await fixture.close(); }
});

test("AC4: \"Undo last change\" restores the previous criteria and results", async () => {
  const fixture = await restartFixture();
  try {
    const search = await fixture.advance("discovery");
    const original = await criteriaNow(fixture);
    // Failure path: with one search there is nothing to undo.
    rejected(await criteriaEvent(fixture, CRITERIA_UNDO_EVENT, { basedOn: original.key }), "NOTHING_TO_UNDO");

    const edited = success(await criteriaEvent(fixture, CRITERIA_EDIT_EVENT, { field: "where", area: "lekki-phase-1", basedOn: original.key }));
    // Undo survives a reload (the history is part of the durable projection).
    await fixture.restart();
    const reloaded = await criteriaNow(fixture);
    assert.equal(reloaded.canUndo, true);
    assert.equal(reloaded.key, edited.criteria!.key);

    const undone = success(await criteriaEvent(fixture, CRITERIA_UNDO_EVENT, { basedOn: reloaded.key }));
    assert.equal(undone.messages[0], "I've undone your last change.");
    assert.deepEqual({ ...undone.criteria, key: undefined }, { ...original, key: undefined });
    assert.equal(undone.criteria?.key, original.key);
    assert.deepEqual(unitIds(undone.surfaces[0]!), unitIds(search.surfaces[0]!));
    assert.equal(undone.surfaces[0]!.conventionalRoute, search.surfaces[0]!.conventionalRoute);
    assert.equal(undone.criteria?.canUndo, false);

    // Failure path: a stale undo is refused.
    rejected(await criteriaEvent(fixture, CRITERIA_UNDO_EVENT, { basedOn: edited.criteria!.key }), "STALE_SURFACE");
  } finally { await fixture.close(); }
});

test("ADR-0080: the conventional search page edits the same criteria without JavaScript", async () => {
  const fixture = await restartFixture();
  try {
    const page = await (await fetch(`${fixture.base}/stays/search?location=Lagos&neighbourhood=Old+Ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`)).text();
    assert.match(page, /<form class="ui-panel search-form" method="get" action="\/stays\/search"/);
    assert.match(page, /<option value="old-ikoyi" selected>Old Ikoyi, Lagos<\/option>/);
    assert.match(page, /name="checkIn" type="date" required value="2026-09-10"/);
    const byArea = await fetch(`${fixture.base}/stays/search?area=lekki-phase-1&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    assert.equal(byArea.status, 200);
    assert.match(await byArea.text(), /<option value="lekki-phase-1" selected>/);
    // Failure paths: an unknown area, or an area mixed with a location, fails closed.
    assert.equal((await fetch(`${fixture.base}/stays/search?area=mars&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`)).status, 400);
    assert.equal((await fetch(`${fixture.base}/stays/search?area=lagos&location=Abuja&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`)).status, 400);
  } finally { await fixture.close(); }
});

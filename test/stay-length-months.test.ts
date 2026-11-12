import test from "node:test";
import assert from "node:assert/strict";
import { searchedFilters, withLiveApp } from "./helpers/stay-length-fixtures.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId, type GuestTurnResult } from "../apps/local-guest/src/guest-server.js";
import { LIVE_LIKE_CLOCK } from "./helpers/guest-date-fixtures.js";
import { LANDING_COPY } from "../apps/local-guest/src/landing-copy.js";

// Issue 19 (ADR 0092 as amended 1 Nov 2026: a month is 30 nights; ADR 0106: guest-authored stay facts). The clock is the
// staging-like 27 Oct 2026, Africa/Lagos. "5 Jan" is the on-or-after 5 January 2027 inside the booking horizon.

function success(result: GuestTurnResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("AC2 On the deterministic path, 'Ikoyi, 2 months from 5 Jan, 2 guests' searches 60 nights (5 Jan to 6 Mar 2027) and the reply shows '60 nights (2 months)'", async () => {
  await withLiveApp(async (app, environment, threadId) => {
    const turn = await app.handleTurn(threadId, "Ikoyi, 2 months from 5 Jan, 2 guests");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    const reply = turn.messages.join(" ");
    assert.match(reply, /60 nights \(2 months\)/);
    const filters = searchedFilters(environment, threadId);
    assert.equal(filters?.checkIn, "2027-01-05");
    assert.equal(filters?.checkOut, "2027-03-06");
  });
});

test("AC4 A vague length ('a few months') gets the nights question on the deterministic path, never a guessed length", async () => {
  await withLiveApp(async (app, environment, threadId) => {
    const turn = await app.handleTurn(threadId, "Ikoyi, a few months from 5 Jan, 2 guests");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.match(turn.messages.join(" "), /how many nights/);
    assert.equal(searchedFilters(environment, threadId), undefined, "no search runs on a guessed length");
  });
});

test("AC5 '7 months' is refused with the existing 180-night message on the deterministic path", async () => {
  await withLiveApp(async (app, environment, threadId) => {
    const turn = await app.handleTurn(threadId, "Ikoyi, 7 months from 5 Jan, 2 guests");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.match(turn.messages.join(" "), /Stays can be at most 180 nights\. Please choose 180 nights or fewer\./);
    assert.equal(searchedFilters(environment, threadId), undefined, "no search runs for 210 nights");
  });
});

test("AC6 The landing chip 'Ikoyi, 2 months from 5 Jan, relocating' with the party added yields a 60-night search with the '(2 months)' show-back", async () => {
  // The chip alone names no party size, and a search needs one (ADR 0015), so the guest's next words ("2 guests") add it here.
  await withLiveApp(async (app, environment, threadId) => {
    const chip = await app.handleTurn(threadId, LANDING_COPY.exampleChips[2]!.text);
    assert.equal(chip.ok, true);
    if (!chip.ok) return;
    assert.match(chip.messages.join(" "), /60 nights \(2 months\)/, "the chip's show-back names the months");
    assert.equal(searchedFilters(environment, threadId), undefined, "the chip alone does not search: no party size yet");
    const turn = await app.handleTurn(threadId, "2 guests");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    assert.match(turn.messages.join(" "), /60 nights \(2 months\)/);
    assert.equal(searchedFilters(environment, threadId)?.checkOut, "2027-03-06");
  });
});

test("AC7 The criteria strip after a months request shows 60 nights (2 months), and its edit chip keeps working (chip edits still override)", async () => {
  await withLiveApp(async (app, _environment, threadId) => {
    const turn = success(await app.handleTurn(threadId, "Ikoyi, 2 months from 5 Jan, 2 guests"));
    assert.equal(turn.criteria?.when?.nights, 60, "the strip's chip value is the number of nights");
    assert.match(turn.criteria?.when?.label ?? "", /60 nights \(2 months\)/, "the strip shows the months after the nights");
    const key = turn.criteria?.key;
    assert.ok(key, "the strip carries its basis key");

    // The edit chip is structured guest input (ADR 0106): three nights from the same check-in replace the months.
    const edited = success(app.handleEvent(threadId, {
      name: CRITERIA_EDIT_EVENT,
      surfaceId: criteriaSurfaceId(threadId),
      sourceComponentId: "criteria-strip",
      timestamp: new Date().toISOString(),
      context: { field: "when", checkIn: "2027-01-05", nights: 3, basedOn: key },
    }));
    assert.equal(edited.criteria?.when?.nights, 3, "the chip edit overrides the stated months");
    assert.doesNotMatch(edited.criteria?.when?.label ?? "", /months/, "the edited stay shows nights only");
  });
});

test("AC8 Existing nights-only behaviour is unchanged: '3 nights' searches 3 nights with the existing reply and no months show-back", async () => {
  await withLiveApp(async (app, environment, threadId) => {
    const turn = success(await app.handleTurn(threadId, "Ikoyi, 3 nights from 5 Jan, 2 guests"));
    const reply = turn.messages.join(" ");
    assert.match(reply, /for your stay from Tue 5 Jan 2027 to Fri 8 Jan 2027\. You can view the details below\./, "the existing search reply, with no months");
    assert.doesNotMatch(reply, /months?\)/, "no months show-back for nights");
    assert.equal(searchedFilters(environment, threadId)?.checkOut, "2027-01-08");
  });
});

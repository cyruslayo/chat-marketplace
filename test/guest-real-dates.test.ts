import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { extractStayRequestFacts, mergeStayRequestContext, resolveStayRequestContext } from "../apps/local-guest/src/concierge.js";
import { BOOKING_HORIZON_DAYS, MAX_STAY_NIGHTS } from "../domains/shortlet/src/index.js";

// The fixture clock: Thursday 3 Sept 2026, 11:00 WAT.
const THURSDAY = new Date("2026-09-03T10:00:00Z");
const SATURDAY = new Date("2026-09-05T10:00:00Z");

function resolve(text: string, now = THURSDAY) {
  const merged = mergeStayRequestContext(null, extractStayRequestFacts(text, { now }), text);
  return resolveStayRequestContext(merged.context, { now });
}

async function withApp(run: (app: LocalGuestApp, environment: LocalGuestEnvironment, threadId: string) => Promise<void>): Promise<void> {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/real-dates-${crypto.randomUUID()}.sqlite` });
  try { await run(new LocalGuestApp(environment), environment, `g-${crypto.randomUUID()}`); } finally { environment.close(); }
}

function searchedDates(environment: LocalGuestEnvironment, threadId: string): { readonly checkIn?: unknown; readonly checkOut?: unknown } | undefined {
  const record = environment.interactionStore.findThread(threadId);
  if (!record) return undefined;
  const projection = JSON.parse(record.threadJson) as { readonly discoveryArtifact?: { readonly facts?: { readonly filters?: { readonly checkIn?: unknown; readonly checkOut?: unknown } } } | null };
  return projection.discoveryArtifact?.facts?.filters;
}

test("AC1: No search runs with dates the guest did not give or confirm", async () => {
  await withApp(async (app, environment, threadId) => {
    // Failure path: a resolved relative phrase is shown back, never searched unconfirmed.
    const proposed = await app.handleTurn(threadId, "I need an apartment in Ikoyi this weekend for 2 people");
    assert.equal(proposed.ok, true); if (!proposed.ok) return;
    assert.deepEqual(proposed.surfaces, []);
    assert.match(proposed.messages.join(" "), /Fri 4 Sept 2026.*Sun 6 Sept 2026/);
    assert.equal(searchedDates(environment, threadId), undefined);

    // Failure path: an unrelated reply does not count as confirmation.
    const unrelated = await app.handleTurn(threadId, "hmm, what is the area like?");
    assert.equal(unrelated.ok, true); if (!unrelated.ok) return;
    assert.deepEqual(unrelated.surfaces, []);

    const confirmed = await app.handleTurn(threadId, "yes");
    assert.equal(confirmed.ok, true); if (!confirmed.ok) return;
    assert.equal(confirmed.surfaces.length, 1);
    const dates = searchedDates(environment, threadId);
    assert.equal(dates?.checkIn, "2026-09-04");
    assert.equal(dates?.checkOut, "2026-09-06");
  });

  await withApp(async (app, environment, threadId) => {
    // Dates the guest gave explicitly run straight away and are shown back concretely.
    const given = await app.handleTurn(threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    assert.equal(given.ok, true); if (!given.ok) return;
    assert.equal(given.surfaces.length, 1);
    assert.match(given.messages.join(" "), /Thu 10 Sept 2026.*Sun 13 Sept 2026/);
    const dates = searchedDates(environment, threadId);
    assert.equal(dates?.checkIn, "2026-09-10");
    assert.equal(dates?.checkOut, "2026-09-13");
  });
});

test("AC2: \"this weekend\" resolves to the Friday–Sunday range after the injected clock, and the reply shows both dates", () => {
  const thursday = resolve("Ikoyi this weekend for 2 guests");
  assert.equal(thursday.kind, "confirm"); if (thursday.kind !== "confirm") return;
  assert.equal(thursday.filters.checkIn, "2026-09-04");
  assert.equal(thursday.filters.checkOut, "2026-09-06");
  assert.match(thursday.reply, /Fri 4 Sept 2026/);
  assert.match(thursday.reply, /Sun 6 Sept 2026/);

  // Failure path: a Saturday clock never resolves to a Friday already in the past.
  const saturday = resolve("Ikoyi this weekend for 2 guests", SATURDAY);
  assert.equal(saturday.kind, "confirm"); if (saturday.kind !== "confirm") return;
  assert.equal(saturday.filters.checkIn, "2026-09-11");
  assert.equal(saturday.filters.checkOut, "2026-09-13");
});

test("AC3: A range longer than 14 nights or beyond the 90-day horizon is refused with a plain explanation that states the limit", () => {
  assert.equal(MAX_STAY_NIGHTS, 14);
  assert.equal(BOOKING_HORIZON_DAYS, 90);

  const tooLong = resolve(`Ikoyi from 10 Sept for ${MAX_STAY_NIGHTS + 1} nights for 2 guests`);
  assert.equal(tooLong.kind, "refuse"); if (tooLong.kind !== "refuse") return;
  assert.match(tooLong.reply, /14 nights/);

  // 90 days after Thu 3 Sept 2026 is Wed 2 Dec 2026; 3 Dec is one day beyond.
  const tooFar = resolve("Ikoyi from 3 Dec for 2 nights for 2 guests");
  assert.equal(tooFar.kind, "refuse"); if (tooFar.kind !== "refuse") return;
  assert.match(tooFar.reply, /90 days/);
  assert.match(tooFar.reply, /Wed 2 Dec 2026/);

  // Failure paths at the boundary: exactly 14 nights and exactly day 90 are allowed.
  assert.equal(resolve("Ikoyi from 10 Sept for 14 nights for 2 guests").kind, "search");
  assert.equal(resolve("Ikoyi from 2 Dec for 14 nights for 2 guests").kind, "search");
});

test("AC4: \"me and my wife\" sets 2 guests, and \"just me\" sets 1", () => {
  assert.equal(extractStayRequestFacts("Ikoyi for me and my wife").partySize, 2);
  assert.equal(extractStayRequestFacts("just me, 2 nights in Lekki").partySize, 1);
  assert.equal(extractStayRequestFacts("a place for a couple").partySize, 2);
  // Failure path: an explicit count wins over a loose phrase, and a bare "me" sets nothing.
  assert.equal(extractStayRequestFacts("me and my wife plus 2 kids, 4 guests").partySize, 4);
  assert.equal(extractStayRequestFacts("show me Ikoyi").partySize, undefined);
});

test("AC5: If only the nights are known, the concierge asks for the start date instead of assuming one", async () => {
  const pure = resolve("Ikoyi for 3 nights for 2 people");
  assert.equal(pure.kind, "clarify"); if (pure.kind !== "clarify") return;
  assert.match(pure.reply, /arriv/i);

  await withApp(async (app, environment, threadId) => {
    const asked = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(asked.ok, true); if (!asked.ok) return;
    // Failure path: no fixture or demo date is assumed.
    assert.deepEqual(asked.surfaces, []);
    assert.match(asked.messages.join(" "), /arriv/i);
    assert.equal(searchedDates(environment, threadId), undefined);

    const answered = await app.handleTurn(threadId, "10 Sept");
    assert.equal(answered.ok, true); if (!answered.ok) return;
    assert.equal(answered.surfaces.length, 1);
    assert.equal(searchedDates(environment, threadId)?.checkOut, "2026-09-13");
  });
});

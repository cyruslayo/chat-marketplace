import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { extractStayRequestFacts, mergeStayRequestContext, resolveStayRequestContext, type DiscoverySearchContext } from "../apps/local-guest/src/concierge.js";

const NOW = new Date("2026-09-03T10:00:00Z");
const QUESTIONS = [/where you want to stay/g, /how many guests are staying/g, /what date you arrive/g, /how many nights you need/g];

function contextFrom(...messages: readonly string[]): DiscoverySearchContext {
  let context: DiscoverySearchContext | null = null;
  for (const message of messages) context = mergeStayRequestContext(context, extractStayRequestFacts(message, { now: NOW }), message).context;
  return context ?? {};
}

function clarify(...messages: readonly string[]): string {
  const resolution = resolveStayRequestContext(contextFrom(...messages), { now: NOW });
  assert.equal(resolution.kind, "clarify", `expected a clarification for ${messages.join(" / ")}`);
  return resolution.kind === "clarify" ? resolution.reply : "";
}

function questionCount(reply: string): number {
  return QUESTIONS.reduce((count, pattern) => count + (reply.match(pattern)?.length ?? 0), 0);
}

async function withApp(run: (app: LocalGuestApp, threadId: string) => Promise<void>): Promise<void> {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/reflective-${crypto.randomUUID()}.sqlite` });
  try { await run(new LocalGuestApp(environment), `g-${crypto.randomUUID()}`); } finally { environment.close(); }
}

test("AC1: Each clarify reply names every criterion that is known", () => {
  const area = clarify("Ikoyi");
  assert.match(area, /Old Ikoyi, Lagos/);

  const areaGuests = clarify("Ikoyi", "me and my wife");
  assert.match(areaGuests, /Old Ikoyi, Lagos/);
  assert.match(areaGuests, /2 guests/);

  const allButNights = clarify("Ikoyi", "2 guests", "two bedrooms", "from 10 Sept");
  for (const known of [/Old Ikoyi, Lagos/, /2 guests/, /arriving Thu 10 Sept 2026/, /2 bedrooms/]) assert.match(allButNights, known);

  const allButArrival = clarify("Lagos", "3 nights", "just me");
  for (const known of [/Lagos/, /1 guest\b/, /3 nights/]) assert.match(allButArrival, known);

  // Failure path: the old generic acknowledgement never replaces the criteria.
  for (const reply of [area, areaGuests, allButNights, allButArrival]) assert.doesNotMatch(reply, /kept what you've already told me/);
});

test("AC2: Each clarify reply asks for exactly one missing criterion", () => {
  assert.match(clarify("hello"), /where you want to stay/);
  assert.match(clarify("Lagos"), /how many guests are staying/);
  assert.match(clarify("Lagos", "2 guests"), /what date you arrive/);
  assert.match(clarify("Lagos", "2 guests", "from 10 Sept"), /how many nights you need/);
  // Failure path: with every criterion missing, only one question is asked.
  for (const reply of [clarify("hello"), clarify("Lagos"), clarify("Lagos", "2 guests"), clarify("Lagos", "2 guests", "from 10 Sept"), clarify("3 nights")]) {
    assert.equal(questionCount(reply), 1, reply);
    assert.equal((reply.match(/\?/g) ?? []).length, 1, reply);
  }
});

test("AC3: A preference word the parser does not support (for example \"quiet\") is acknowledged as not yet filterable, not silently dropped", async () => {
  await withApp(async (app, threadId) => {
    const partial = await app.handleTurn(threadId, "Somewhere quiet in Ikoyi");
    assert.equal(partial.ok, true); if (!partial.ok) return;
    assert.match(partial.messages.join(" "), /can't filter by “quiet” yet/);

    // The note also accompanies a turn that runs the search.
    const searched = await app.handleTurn(threadId, "from 10 Sept for 3 nights for 2 people, with a pool and parking");
    assert.equal(searched.ok, true); if (!searched.ok) return;
    assert.equal(searched.surfaces.length, 1);
    assert.match(searched.messages.join(" "), /can't filter by “pool” or “parking” yet/);
  });

  // Failure path: supported criteria are never reported as unfilterable.
  const supported = extractStayRequestFacts("two bedrooms in Ikoyi for 2 guests", { now: NOW });
  assert.deepEqual(supported.unsupportedPreferences ?? [], []);
});

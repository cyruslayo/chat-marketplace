import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { resolveLocationMention } from "../apps/local-guest/src/concierge.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_TOOL_DEFINITIONS } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { GUEST_AMENITY_IDS } from "../apps/web-agent/src/guest-content.js";
import { clientWith, completion, jsonResponse } from "./helpers/openai-compatible-client.js";
import {
  datedFixture,
  isScopeRequest,
  LIVE_LIKE_CLOCK,
  restartedDatedApp,
  scopeVerdict,
  scriptedPlanner,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";

// Issue 08 (assistant-concierge-parity): closed amenity and area lists on the assistant path. Every turn runs with the assistant
// runtime enabled and a cold restore (a new application over the same store) before the event, on the staging-like clock
// (27 Oct 2026) and a guest with no seeded phone or email (ADR 0106, the assistant cold-restore rule).

const STAY_TEXT = "Ikoyi with steady light for 2 guests, 3 nights from 14 December 2026";
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Ikoyi", requiredAmenities: ["light"], checkIn: "2026-12-14", nights: 3, guests: 2 };
const SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  [STAY_TEXT]: {
    slots: { city: "Lagos", neighbourhood: "Ikoyi", checkIn: "2026-12-14", nights: 3, guests: 2 },
    search: STAY_SEARCH,
  },
};

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** A cold restore before the turn: a new application over the same store, loaded as a page load does. */
function coldTurn(f: DatedFixture, threadId: string, text: string, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]): Promise<GuestTurnResult> {
  const restored = restartedDatedApp(f, model, diagnostics);
  restored.app.getState(threadId);
  return restored.app.handleTurn(threadId, text);
}

/** Records every discovery search the application runs, with the filters it was given (wrapped on the shared environment). */
function recordSearches(f: DatedFixture): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  const query = f.environment.discoveryQuery;
  const original = query.search.bind(query);
  query.search = (filters) => {
    calls.push({ ...filters });
    return original(filters);
  };
  return calls;
}

/** A provider outage for every planner request (the classifier still answers, so the turn reaches the planner). */
function plannerOutage(): AssistantModelClient {
  return clientWith((request) => (isScopeRequest(request)
    ? completion({ content: JSON.stringify(scopeVerdict({}, ["search"])) })
    : jsonResponse(503, { error: "unavailable" }))).client;
}

function plannerWith(turns: Readonly<Record<string, ScriptedTurn>>): AssistantModelClient {
  return scriptedPlanner(turns).client;
}

test("AC1: \"Ikoyi with steady light\" searches with 24_7_power_generator", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const threadId = "g-d1a0000801";
    const result = successOf(await coldTurn(f, threadId, "Ikoyi with steady light", plannerWith({
      "Ikoyi with steady light": { slots: { city: "Lagos", neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", requiredAmenities: ["light"] } },
    })), "steady light search");
    assert.ok(result.ok);
    const filters = searches.at(-1);
    assert.deepEqual(filters?.requiredAmenities, ["24_7_power_generator"], "the guest's word is sent as the catalogue id");
    assert.equal(filters?.neighbourhood, "Old Ikoyi", "Ikoyi is the Old Ikoyi neighbourhood");
    assert.equal(filters?.location, "Lagos");
  } finally { f.close(); }
});

test("AC2: an amenity value outside the catalogue is rejected by schema validation as a tool_denial, never a zero-result search", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const diagnostics: AssistantDiagnosticEvent[] = [];
    const threadId = "g-d1a0000802";
    successOf(await coldTurn(f, threadId, "Ikoyi with a rooftop pool", plannerWith({
      "Ikoyi with a rooftop pool": { slots: { city: "Lagos", neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", requiredAmenities: ["rooftop_pool"] } },
    }), diagnostics), "rooftop search");
    assert.ok(diagnostics.some((event) => event.stage === "tool_execution" && event.succeeded === false
      && event.failureClass === "MODEL_SELECTION_FAILURE"), "the schema rejects the call as a tool_denial");
    assert.equal(searches.some((filters) => filters.requiredAmenities !== undefined), false, "no search carries an amenity outside the catalogue");
  } finally { f.close(); }
});

test("AC2b: a catalogue-less amenity such as gym is dropped and the search still runs without it", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const threadId = "g-d1a0000803";
    successOf(await coldTurn(f, threadId, "Ikoyi with a gym", plannerWith({
      "Ikoyi with a gym": { slots: { city: "Lagos", neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", requiredAmenities: ["gym"] } },
    })), "gym search");
    const filters = searches.at(-1);
    assert.ok(filters, "the search ran");
    assert.equal(filters.requiredAmenities, undefined, "gym is never sent as a filter");
    assert.equal(filters.neighbourhood, "Old Ikoyi");
  } finally { f.close(); }
});

test("AC3: an area alias the deterministic path accepts gives the same city and neighbourhood on the assistant path", async () => {
  const cases = [
    { alias: "VI", city: "Lagos" },
    { alias: "Lekki", city: "Lagos" },
    { alias: "Wuse 2", city: "Abuja" },
    // A bare district names the city only: the deterministic path searches all of Abuja, so the assistant must not send "Wuse".
    { alias: "Wuse", city: "Abuja" },
  ] as const;
  for (const [index, { alias, city }] of cases.entries()) {
    const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
    try {
      const searches = recordSearches(f);
      const expected = resolveLocationMention(alias);
      assert.ok(expected, `the deterministic path accepts ${alias}`);
      const text = `Stay in ${alias} ${city}`;
      successOf(await coldTurn(f, `g-d1a000090${index}`, text, plannerWith({
        [text]: { slots: { city, neighbourhood: alias }, search: { city, neighbourhood: alias } },
      })), `area ${alias}`);
      const filters = searches.at(-1);
      assert.equal(filters?.location, expected.city, `${alias} resolves to the deterministic city`);
      assert.equal(filters?.neighbourhood, expected.neighbourhood, `${alias} resolves to the deterministic neighbourhood`);
    } finally { f.close(); }
  }
});

test("AC4: an unknown area is a tool_denial with the area clarification", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const threadId = "g-d1a0000804";
    const result = successOf(await coldTurn(f, threadId, "A place in Yaba", plannerWith({
      "A place in Yaba": { slots: { city: "Lagos", neighbourhood: "Yaba" }, search: { city: "Lagos", neighbourhood: "Yaba" } },
    })), "unknown area");
    assert.equal(result.assistantControlOutcome, "tool_denial");
    assert.match(result.messages.join(" "), /which area/i, "the guest is asked for an area");
    assert.match(result.messages.join(" "), /Old Ikoyi/, "the examples come from the closed area list");
    assert.equal(searches.length, 0, "no search runs for an unknown area");
  } finally { f.close(); }
});

test("AC5: after a provider outage fallback, the deterministic search keeps the guest's amenities", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const threadId = "g-d1a0000805";
    successOf(await coldTurn(f, threadId, STAY_TEXT, plannerWith(SCRIPT)), "assistant search");
    const callsBefore = searches.length;
    const fallback = successOf(await coldTurn(f, threadId, "Make it 4 guests", plannerOutage()), "fallback turn");
    assert.ok(fallback.ok);
    const fallbackSearches = searches.slice(callsBefore);
    const filters = fallbackSearches.at(-1);
    assert.equal(filters?.partySize, 4, "the deterministic path ran the change");
    assert.deepEqual(filters?.requiredAmenities, ["24_7_power_generator"], "the fallback search keeps the amenity");
  } finally { f.close(); }
});

test("AC6: the assistant and the deterministic fallback run the same search filters for the same criteria", async () => {
  const f = datedFixture(plannerWith({}), undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const searches = recordSearches(f);
    const threadId = "g-d1a0000806";
    successOf(await coldTurn(f, threadId, STAY_TEXT, plannerWith(SCRIPT)), "assistant search");
    const assistantFilters = searches.at(-1);
    const callsBefore = searches.length;
    // The same criteria, re-run by the deterministic path: the guest restates the party size already held.
    successOf(await coldTurn(f, threadId, "2 guests", plannerOutage()), "deterministic re-run");
    const deterministicFilters = searches.slice(callsBefore).at(-1);
    assert.ok(assistantFilters, "the assistant search ran");
    assert.deepEqual(deterministicFilters, assistantFilters, "both paths search with identical filters");
  } finally { f.close(); }
});

test("the search_stays schema allows only catalogue amenity ids", () => {
  const search = ASSISTANT_TOOL_DEFINITIONS.find((tool) => tool.name === "search_stays")!;
  const amenities = search.parametersSchema.properties.requiredAmenities!;
  assert.deepEqual(amenities.items, { type: "string", enum: [...GUEST_AMENITY_IDS] });
});

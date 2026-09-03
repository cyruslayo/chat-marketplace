import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import {
  handleGeminiTurn,
  searchStaysDeclaration,
  validateGeminiStaySearchArguments,
  type GeminiConciergeClient,
  type GeminiModelResponse,
} from "../apps/local-guest/src/gemini-concierge.js";

const now = new Date("2026-08-10T10:00:00Z");
const args = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: 4, guests: 2 };

function fake(...responses: GeminiModelResponse[]): GeminiConciergeClient {
  let index = 0;
  return { async generate() { const response = responses[index++]; if (!response) throw new Error("unexpected fake call"); return response; } };
}

test("Gemini concierge asks a clarification without producing an authoritative surface when stay requirements are incomplete", async () => {
  let searched = false;
  const result = await handleGeminiTurn({ client: fake({ text: "How many nights and how many guests?" }), history: [], text: "I need somewhere in Ikoyi.", demoCheckIn: "2026-08-15", now, search: () => { searched = true; return { resultCount: 0, location: "Lagos", checkIn: "2026-08-15", checkOut: "2026-08-16" }; } });
  assert.equal(result.kind, "clarify");
  assert.equal(searched, false);
});

test("Gemini search_stays tool arguments are validated before authoritative discovery executes", async () => {
  const environment = new LocalGuestEnvironment();
  try {
    const result = await handleGeminiTurn({ client: fake({ functionCalls: [{ name: "search_stays", id: "call-1", args } ] }, { text: "I found one matching stay in Old Ikoyi." }), history: [], text: "Four nights for two people.", demoCheckIn: environment.config.demoCheckIn, now, search: (filters) => { const artifact = environment.discoveryQuery.search({ ...filters }); return { resultCount: artifact.facts.results.length, location: filters.location, neighbourhood: filters.neighbourhood, checkIn: filters.checkIn, checkOut: filters.checkOut }; } });
    assert.equal(result.kind, "search");
    if (result.kind === "search") assert.deepEqual(result.filters, { location: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-08-15", checkOut: "2026-08-19", partySize: 2 });
  } finally { environment.close(); }
});

test("Malformed or unsupported Gemini function calls fail closed without executing a marketplace command", async () => {
  for (const call of [{ name: "unknown", args }, { name: "search_stays", args: { ...args, guests: 0 } }, { name: "search_stays", args: { ...args, nights: 0 } }, { name: "search_stays", args: "bad" }]) {
    let searched = false;
    await assert.rejects(() => handleGeminiTurn({ client: fake({ functionCalls: [call] }), history: [], text: "search", demoCheckIn: "2026-08-15", now, search: () => { searched = true; return { resultCount: 0, location: "Lagos", checkIn: "2026-08-15", checkOut: "2026-08-16" }; } }));
    assert.equal(searched, false);
  }
});

test("Gemini cannot invoke booking payment or Operator commands", () => {
  assert.equal(searchStaysDeclaration.name, "search_stays");
  assert.deepEqual(searchStaysDeclaration.parametersJsonSchema && (searchStaysDeclaration.parametersJsonSchema as { properties: object }).properties && Object.keys((searchStaysDeclaration.parametersJsonSchema as { properties: Record<string, unknown> }).properties), ["city", "neighbourhood", "checkIn", "nights", "guests"]);
});

test("Gemini tool result contains minimized authoritative search metadata rather than raw domain records", async () => {
  let history: unknown[] = [];
  const client: GeminiConciergeClient = { async generate(contents) { history = contents; return history.length === 1 ? { functionCalls: [{ name: "search_stays", args }] } : { text: "I found one stay." }; } };
  await handleGeminiTurn({ client, history: [], text: "search", demoCheckIn: "2026-08-15", now, search: () => ({ resultCount: 1, location: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-08-15", checkOut: "2026-08-19" }) });
  const serialized = JSON.stringify(history);
  assert.equal(serialized.includes("nightlyKobo"), false);
  assert.equal(serialized.includes("unit-lagos"), false);
  assert.ok(serialized.includes("resultCount"));
});

test("Gemini provider errors return a safe guest response without exposing provider details", async () => {
  const environment = new LocalGuestEnvironment();
  try {
    const app = new LocalGuestApp(environment, { geminiClient: { async generate() { throw new Error("secret provider authorization details"); } } });
    const result = await app.handleTurn("g-abcdef01", "hello");
    assert.deepEqual(result, { ok: false, code: "CONCIERGE_UNAVAILABLE", message: "The concierge is temporarily unavailable. Please try again." });
  } finally { environment.close(); }
});

test("Deterministic concierge remains the default and does not require GEMINI_API_KEY", async () => {
  const environment = new LocalGuestEnvironment();
  try {
    const app = new LocalGuestApp(environment);
    const result = await app.handleTurn("g-abcdef02", "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.surfaces.length, 1);
  } finally { environment.close(); }
});

test("Gemini validator uses demo dates when no explicit date is supplied and delegates date policy to StayDateRange", () => {
  assert.deepEqual(validateGeminiStaySearchArguments(args, { demoCheckIn: "2026-08-15", now }), { location: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-08-15", checkOut: "2026-08-19", partySize: 2 });
  assert.throws(() => validateGeminiStaySearchArguments({ ...args, checkIn: "next Friday" }, { demoCheckIn: "2026-08-15", now }));
});

import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { ASSISTANT_TOOL_DEFINITIONS, SHORTLET_PROMPT_SECTION } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { createStayQuote } from "../domains/shortlet/src/index.js";

test("Discovery preserves unknown nights, guests and bedrooms instead of filtering them as zero", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("unknown-search.sqlite") });
  const model = new ScriptedAssistantModel([(request) => {
    if (request.history.at(-1)?.role !== "user") return { text: "See the matching stays." };
    return { toolCalls: [{ id: "unknown-search", name: "search_stays", args: {
      city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: null, nights: null, guests: null, bedrooms: null,
    } }] };
  }]);
  try {
    const runtime = new ShortletAssistantRuntime(environment, model);
    const result = await runtime.handleTurn("unknown-search", "Show me apartments in Ikoyi.");
    const state = runtime.getThread("unknown-search").taskState;
    assert.equal(result.ok, true);
    assert.ok(state.shortlist.length > 0, "unknown fields must not exclude available apartments");
    assert.equal(state.stayIntent.bedrooms, undefined);
    assert.equal(state.stayIntent.nights, undefined);
    assert.equal(state.stayIntent.partySize, undefined);
    assert.equal(state.stayIntent.checkIn, undefined);
    assert.equal(state.shortlist[0]!.allInStayTotalKobo, null, "unknown dates must not create a stay quote");
  } finally { environment.close(); }
});

test("Discovery tool schema represents unknown numeric fields without invented zero or one defaults", () => {
  const search = ASSISTANT_TOOL_DEFINITIONS.find((tool) => tool.name === "search_stays")!;
  for (const field of ["nights", "guests", "bedrooms"]) {
    assert.deepEqual(search.parametersSchema.properties[field]!.type, ["integer", "null"]);
    assert.match(search.parametersSchema.properties[field]!.description ?? "", /null/i);
  }
  assert.match(SHORTLET_PROMPT_SECTION, /zero or one/i);
});

test("Unknown refinement values preserve a prior explicit bedroom count", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("preserve-search.sqlite") });
  let searches = 0;
  const model = new ScriptedAssistantModel([(request) => {
    if (request.history.at(-1)?.role !== "user") return { text: "See the matching stays." };
    return { toolCalls: [{ id: `search-${++searches}`, name: "search_stays", args: {
      city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: searches === 1 ? 2 : null,
    } }] };
  }]);
  try {
    const runtime = new ShortletAssistantRuntime(environment, model);
    await runtime.handleTurn("preserve-search", "Show me two-bedroom apartments in Ikoyi.");
    await runtime.handleTurn("preserve-search", "Show me the options again.");
    const state = runtime.getThread("preserve-search").taskState;
    assert.equal(state.stayIntent.bedrooms, 2);
    assert.ok(state.shortlist.length > 0);
    assert.ok(state.shortlist.every((stay) => stay.bedrooms === 2));
  } finally { environment.close(); }
});

test("An explicit zero-bedroom studio filter remains distinct from an unknown bedroom count", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("studio-search.sqlite") });
  const unit = environment.unitRepository.findAll()[0]!;
  environment.unitRepository.save({ ...unit, bedrooms: 0 });
  const model = new ScriptedAssistantModel([(request) => request.history.at(-1)?.role !== "user"
    ? { text: "See the studios." }
    : { toolCalls: [{ id: "studio", name: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: 0 } }] }]);
  try {
    const runtime = new ShortletAssistantRuntime(environment, model);
    await runtime.handleTurn("studio", "Show me studios in Ikoyi.");
    const state = runtime.getThread("studio").taskState;
    assert.equal(state.stayIntent.bedrooms, 0);
    assert.ok(state.shortlist.length > 0);
    assert.ok(state.shortlist.every((stay) => stay.bedrooms === 0));
  } finally { environment.close(); }
});

test("Unit detail gives the model the same authoritative demo quote shown on its surface", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("detail-quote.sqlite") });
  let detailResult: Record<string, unknown> | undefined;
  const model = new ScriptedAssistantModel([(request) => {
    const step = request.history.at(-1);
    if (step?.role === "tool_results") {
      detailResult = step.results.find((item) => item.name === "get_unit_details")?.result ?? detailResult;
      return { text: "See the authoritative stay details." };
    }
    if (step?.role !== "user") return null;
    return { toolCalls: [{ id: "detail-quote", name: /open/i.test(step.text) ? "get_unit_details" : "search_stays",
      args: /open/i.test(step.text) ? { stayRef: "stay-1" } : { city: "Lagos", neighbourhood: "Old Ikoyi" } }] };
  }]);
  try {
    const runtime = new ShortletAssistantRuntime(environment, model);
    await runtime.handleTurn("detail-quote", "Show me apartments in Ikoyi.");
    const response = await runtime.handleTurn("detail-quote", "Open the first one.");
    const stay = runtime.getThread("detail-quote").taskState.shortlist[0]!;
    const unit = environment.unitRepository.findById(stay.unitId)!;
    const quote = createStayQuote({ unit, checkIn: environment.config.demoCheckIn,
      checkOut: environment.config.demoCheckOut!, partySize: 1, clock: environment.clock });
    assert.equal(response.ok, true);
    assert.equal(detailResult?.allInStayTotalKobo, quote.allInStayTotalKobo);
    assert.equal(detailResult?.mandatoryFeesKobo, quote.lineItems.mandatoryFeesKobo);
    assert.equal(detailResult?.checkIn, environment.config.demoCheckIn);
    assert.equal(detailResult?.checkOut, environment.config.demoCheckOut);
    assert.equal(detailResult?.isDemoDate, true);
  } finally { environment.close(); }
});

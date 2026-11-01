import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { CRITERIA_EDIT_EVENT, criteriaSurfaceId } from "../apps/local-guest/src/shortlet-app.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { assistantToolsForState, createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import type { AssistantTaskState, AssistantStayReference } from "../apps/local-guest/src/assistant/assistant-state.js";
import { MAX_STAY_NIGHTS, EXTENDED_STAY_POLICY } from "../domains/shortlet/src/index.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// ADR 0023 as amended 1 Nov 2026 (Short Stays of 1 to 29 nights), ADR 0092 (Extended Stays of 30 to 180 nights, policy only),
// ADR 0106 (the assistant runtime enabled, a cold restore before every event, out-of-range tool calls are tool_denial).
// Every event below builds a new application over the same store, on a fresh thread, on the staging-like clock (27 Oct 2026).

type Planner = ReturnType<typeof scriptedPlanner>["client"];
type Environment = LocalGuestEnvironment;

const CHECK_IN = "2026-12-14";
const PHONE = "+234 801 234 5678";

/** The guest's own text states the check-in, so the planner's date has guest authority (ADR 0093, date literals). */
const TEXT_21 = "Ikoyi for 21 nights, 2 guests from 14 December 2026";
const TEXT_30 = "Ikoyi for 30 nights, 2 guests from 14 December 2026";
const TEXT_181 = "Ikoyi for 181 nights, 2 guests from 14 December 2026";
const TEXT_3 = "Ikoyi for 3 nights, 2 guests from 14 December 2026";

/** Classifier slots never carry nights for the out-of-range cases, so the planner's own search call is the one under test. */
const SLOTS_NO_NIGHTS = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, guests: 2 };

function scriptFor(text: string, nights: number | null): Record<string, ScriptedTurn> {
  const search = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights, guests: 2 };
  return { [text]: { slots: nights === null ? SLOTS_NO_NIGHTS : { ...SLOTS_NO_NIGHTS, nights }, search } };
}

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** A new application over the same store, loaded as the browser's page load does, before the event is sent. */
function coldFixture(environment: Environment, model: Planner, threadId: string): Omit<DatedFixture, "close"> {
  const fixture = wireDatedApp(environment, model);
  fixture.app.getState(threadId);
  return fixture;
}

function coldApp(environment: Environment, model: Planner, threadId: string) {
  return coldFixture(environment, model, threadId).app;
}

/**
 * A fresh thread's first event. There is no thread to load before it exists, so it is sent through a new application
 * without a page-load read (as test/assistant-cold-journey.test.ts does); every later event is a cold restore.
 */
function firstTurn(environment: Environment, model: Planner, threadId: string, text: string, diagnostics?: AssistantDiagnosticEvent[]): Promise<GuestTurnResult> {
  return wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, text);
}

/**
 * ADR 0106: the planner's search_stays was rejected at tool execution (a schema violation the runtime gate reports as a
 * tool call error), and no search ran. The turn-level outcome can be overwritten by the model's later reply, so the
 * rejection is asserted on the tool-execution diagnostic.
 */
function assertSearchRejected(diagnostics: readonly AssistantDiagnosticEvent[]): void {
  const searches = diagnostics.filter((event) => event.stage === "tool_execution" && event.toolName === "search_stays");
  assert.equal(searches.some((event) => event.succeeded), false, "no search_stays call succeeded");
  assert.equal(searches.filter((event) => event.failureClass === "MODEL_SELECTION_FAILURE").length, 1, "the search_stays call is a rejected tool call");
}

/**
 * The Proxy seam for "no Extended Stay policy at the pack level" (ADR 0092 amended: every composition now supplies the
 * policy, so a policy-less assistant is only reachable through this seam). Methods are bound to the real environment so
 * its private fields keep working; only `extendedStayPolicy` reads as undefined.
 */
function withoutExtendedStayPolicy(environment: Environment): Environment {
  return new Proxy(environment, {
    get(target, property) {
      if (property === "extendedStayPolicy") return undefined;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function emptyTaskState(): AssistantTaskState {
  return { goal: null, stayIntent: {}, shortlist: [] };
}

function stayReference(stayRef: string): AssistantStayReference {
  return {
    stayRef, unitId: "unit-ikoyi", title: "Old Ikoyi apartment", city: "Lagos", neighbourhood: "Old Ikoyi", capacity: 2,
    amenities: [], nightlyKobo: 4_000_000, allInStayTotalKobo: 84_000_000, mandatoryFeesKobo: 0, refundableSecurityDepositKobo: 0,
    amountDueNowKobo: 84_000_000, inspectionStatus: "passed", managementAuthorityStatus: "verified",
  };
}

function maximumNights(tools: ReturnType<typeof assistantToolsForState>, name: string): number | undefined {
  const tool = tools.find((candidate) => candidate.name === name);
  const schema = tool?.parametersSchema as { readonly properties?: { readonly nights?: { readonly maximum?: number } } } | undefined;
  return schema?.properties?.nights?.maximum;
}

/** Runs the 21-night journey: search, View, Request to Book, every event cold-restored. */
async function shortStayDraftJourney(environment: Environment, model: Planner, threadId: string): Promise<void> {
  const search = successOf(await firstTurn(environment, model, threadId, TEXT_21), "search");
  assert.ok(search.surfaces.length > 0, "21 nights shows a discovery surface");

  const detailApp = coldApp(environment, model, threadId);
  const detail = successOf(await detailApp.handleEventAsync(threadId, firstButtonAction(search.surfaces[0]!)), "View");
  assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail");

  const draft = successOf(await coldApp(environment, model, threadId).handleEventAsync(threadId, firstButtonAction(detail.surfaces[0]!)), "Request to Book");
  assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/, "Request to Book reaches a Request Draft");
  assert.match(JSON.stringify(draft.surfaces[0]!.a2uiMessages), /21 nights/, "the Request Draft is for 21 nights");
}

test("AC1: \"Ikoyi for 21 nights, 2 guests\" searches, shows a discovery surface, and reaches a Request Draft as a Short Stay, cold-restored before every event (default composition)", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_21, 21)).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await shortStayDraftJourney(f.environment, model, "g-5b29000101");
  } finally { f.close(); }
});

test("AC1: \"Ikoyi for 21 nights, 2 guests\" searches, shows a discovery surface, and reaches a Request Draft as a Short Stay, cold-restored before every event (production composition, demo off)", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_21, 21)).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, composition: { demo: false, deployment: "production" } });
  try {
    await shortStayDraftJourney(f.environment, model, "g-5b29000102");
  } finally { f.close(); }
});

test("AC2: Without an Extended Stay policy, the search_stays and prepare_request_draft schemas offer a maximum of 29 nights", () => {
  const state: AssistantTaskState = { ...emptyTaskState(), shortlist: [stayReference("stay-1")], selectedStayRef: "stay-1" };
  const tools = assistantToolsForState(state, undefined);
  assert.equal(maximumNights(tools, "search_stays"), MAX_STAY_NIGHTS, "search_stays offers MAX_STAY_NIGHTS without a policy");
  assert.equal(maximumNights(tools, "prepare_request_draft"), MAX_STAY_NIGHTS, "prepare_request_draft offers MAX_STAY_NIGHTS without a policy");
  assert.equal(MAX_STAY_NIGHTS, 29);
});

test("AC2: With the Extended Stay policy (demo policy), the search_stays and prepare_request_draft schemas offer a maximum of 180 nights", () => {
  const state: AssistantTaskState = { ...emptyTaskState(), shortlist: [stayReference("stay-1")], selectedStayRef: "stay-1" };
  const tools = assistantToolsForState(state, EXTENDED_STAY_POLICY);
  assert.equal(maximumNights(tools, "search_stays"), EXTENDED_STAY_POLICY.maximumNights);
  assert.equal(maximumNights(tools, "prepare_request_draft"), EXTENDED_STAY_POLICY.maximumNights);
  assert.equal(EXTENDED_STAY_POLICY.maximumNights, 180);
});

test("AC2: A production composition's assistant offers 180 nights, because every composition supplies the Extended Stay policy", () => {
  const f = datedFixture(scriptedPlanner({}).client, undefined, { clock: LIVE_LIKE_CLOCK, composition: { demo: false, deployment: "production" } });
  try {
    const tools = createShortletAssistantPack(f.environment).toolsForState(emptyTaskState());
    assert.equal(maximumNights(tools, "search_stays"), 180, "the production search_stays maximum is 180");
  } finally { f.close(); }
});

test("AC3: Without a policy, a planner search_stays of 30 nights is a rejected tool call (tool_denial), not CONCIERGE_UNAVAILABLE, and creates no discovery surface", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_30, 30)).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const policyless = withoutExtendedStayPolicy(f.environment);
    const diagnostics: AssistantDiagnosticEvent[] = [];
    const success = successOf(await firstTurn(policyless, model, "g-5b29000103", TEXT_30, diagnostics), "30 nights without a policy");
    assertSearchRejected(diagnostics);
    assert.equal(success.surfaces.length, 0, "no discovery surface is created");
  } finally { f.close(); }
});

test("AC3: With the policy, a planner search_stays of 181 nights is a rejected tool call (tool_denial) and creates no discovery surface", async () => {
  const model = scriptedPlanner(scriptFor(TEXT_181, 181)).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const diagnostics: AssistantDiagnosticEvent[] = [];
    const success = successOf(await firstTurn(f.environment, model, "g-5b29000104", TEXT_181, diagnostics), "181 nights");
    assertSearchRejected(diagnostics);
    assert.equal(success.surfaces.length, 0, "no discovery surface is created");
  } finally { f.close(); }
});

test("AC4: A criteria-strip chip edit to 25 nights reaches thread.assistantContext and the runtime facts, and the next search uses 25 nights", async () => {
  const model = scriptedPlanner({ ...scriptFor(TEXT_3, 3), ...scriptFor("Show the stays again for 25 nights", 25) }).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-5b29000105";
    const first = successOf(await firstTurn(f.environment, model, threadId, TEXT_3), "3 nights");
    const key = first.criteria?.key;
    assert.ok(key, "the criteria strip has a key");

    // The chip edit is structured guest input (ADR 0093, ADR 0106), sent through a cold restore as the page does.
    const edit = successOf(await coldApp(f.environment, model, threadId).handleEventAsync(threadId, {
      name: CRITERIA_EDIT_EVENT,
      surfaceId: criteriaSurfaceId(threadId),
      sourceComponentId: "criteria-chip",
      timestamp: LIVE_LIKE_CLOCK().toISOString(),
      context: { field: "when", checkIn: CHECK_IN, nights: 25, basedOn: key },
    }), "chip edit to 25 nights");
    assert.match(edit.criteria?.when?.label ?? "", /25 nights/, "the strip shows 25 nights");

    const restored = coldFixture(f.environment, model, threadId);
    assert.equal(restored.runtime.getThread(threadId).taskState.stayIntent.nights, 25, "the runtime facts hold 25 nights");
    // thread.assistantContext is the durable projection (the stored thread JSON), as assistant-persistent-continuity reads it.
    const stored = f.environment.interactionStore.findThread(threadId);
    assert.ok(stored, "the thread is stored");
    const durable = JSON.parse(stored!.threadJson) as { readonly assistantContext?: { readonly nights?: number; readonly checkOut?: string } };
    assert.equal(durable.assistantContext?.nights, 25, "thread.assistantContext holds 25 nights");
    assert.equal(durable.assistantContext?.checkOut, "2027-01-08", "thread.assistantContext holds the 25-night checkout");

    const next = successOf(await coldApp(f.environment, model, threadId).handleTurn(threadId, "Show the stays again for 25 nights"), "next search");
    assert.ok(next.surfaces.length > 0, "the next search shows a discovery surface");
    assert.match(JSON.stringify(next.surfaces[0]!.a2uiMessages), /25 nights/, "the next search is for 25 nights");
  } finally { f.close(); }
});

test("AC5: The staging demo (policy present) searches 15 and 29 nights as Short Stays, cold-restored before every event, and still refuses 181 nights", async () => {
  for (const nights of [15, 29]) {
    const text = `Ikoyi for ${nights} nights, 2 guests from 14 December 2026`;
    const model = scriptedPlanner(scriptFor(text, nights)).client;
    const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, composition: { demo: true, deployment: "staging" } });
    try {
      const search = successOf(await firstTurn(f.environment, model, `g-5b29000${String(nights).padStart(3, "0")}`, text), `${nights} nights`);
      assert.ok(search.surfaces.length > 0, `${nights} nights creates a discovery surface as a Short Stay`);
    } finally { f.close(); }
  }

  const model = scriptedPlanner(scriptFor(TEXT_181, 181)).client;
  const f = datedFixture(model, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, composition: { demo: true, deployment: "staging" } });
  try {
    const diagnostics: AssistantDiagnosticEvent[] = [];
    const refused = successOf(await firstTurn(f.environment, model, "g-5b29000181", TEXT_181, diagnostics), "181 nights");
    assertSearchRejected(diagnostics);
    assert.equal(refused.surfaces.length, 0, "181 nights creates no discovery surface");
  } finally { f.close(); }
});

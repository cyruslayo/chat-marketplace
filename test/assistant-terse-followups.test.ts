import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { ModelScopeClassifier } from "../apps/local-guest/src/assistant/scope-classifier.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import {
  classifiedMessage,
  isScopeRequest,
  lastRoleIsTool,
  latestUserText,
  OPENROUTER,
  scopeVerdict,
  searchToolCall,
  wireDatedApp,
} from "./helpers/guest-date-fixtures.js";
import { clientWith, completion, jsonResponse, type CapturedRequest } from "./helpers/openai-compatible-client.js";

// Issue 61 (ADR 0106 amendment): terse follow-ups. Every offline test scripts the classifier verdict, so none catches a live model
// reading "Just me" as unclear. These cases pin the wiring: the classifier request carries the open-question code, the scripted
// in-scope verdict commits the fact, and an unclear verdict falls back to the issue 59 re-ask, not the generic unavailable copy.

const THREAD = "g-af61000001";
const AREA = "Somewhere in Old Ikoyi, Lagos";
const AREA_TURN = { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } };

interface Turn {
  readonly slots?: Readonly<Record<string, unknown>>;
  readonly intents?: readonly string[];
  readonly search?: Record<string, unknown>;
  readonly reply?: "clarify_stay";
  readonly scope?: "unclear";
  /** The planner provider fails, so the runtime reports providerUnavailable and the shell's deterministic path takes the turn. */
  readonly providerDown?: true;
}

function recorder(turns: Readonly<Record<string, Turn>>) {
  const scopeMessages: string[] = [];
  const { client, requests } = clientWith((request: CapturedRequest) => {
    if (isScopeRequest(request)) {
      const message = classifiedMessage(request);
      scopeMessages.push(message);
      const turn = turns[message];
      if (turn?.scope === "unclear") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "unclear", reasonCode: "unclear" }) });
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents)) });
    }
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    if (turn?.providerDown) return jsonResponse(503, { error: { message: "down" } });
    if (lastRoleIsTool(request)) return completion({ content: "Done." });
    if (turn?.reply) return completion({ content: JSON.stringify({ kind: turn.reply, references: [] }) });
    if (turn?.search) return searchToolCall(`search-${text?.length ?? 0}`, turn.search);
    throw new Error(`Unexpected offline fixture turn: ${text ?? "<none>"}`);
  }, OPENROUTER);
  return { client, scopeMessages, requests };
}

function contextOf(request: CapturedRequest): Record<string, unknown> {
  const raw = latestUserText(request);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as { readonly context?: unknown };
    return parsed.context !== null && typeof parsed.context === "object" ? parsed.context as Record<string, unknown> : {};
  } catch { return {}; }
}

function openQuestionSentFor(scopeMessages: readonly string[], requests: readonly CapturedRequest[], message: string): string | null {
  void scopeMessages;
  const request = [...requests].reverse().find((candidate) => isScopeRequest(candidate) && classifiedMessage(candidate) === message);
  assert.ok(request, `a classifier request was made for "${message}"`);
  const value = contextOf(request).openQuestion;
  return typeof value === "string" ? value : null;
}

function card(result: import("../apps/local-guest/src/shortlet-app.js").GuestTurnResult) {
  assertOk(result, "search");
  if (!result.ok) throw new Error("unreachable");
  const surface = result.surfaces.find((candidate) => /:discovery:/.test(candidate.surfaceId));
  assert.ok(surface, "a discovery card");
  return surface;
}

/**
 * Sets up a confirmed check-in with no nights, so the next missing criterion is `nights`. A confirmed check-in with no nights is not
 * reachable through the chip path (the When chip always records both), so the test uses the runtime's own stay setters for warm and
 * seeds the durable projection for cold. Either way the code is server-set and the next turn reads it from the task state.
 */
function setupNightsQuestion(driver: ReturnType<typeof openChipDriver>, cold: boolean): void {
  if (cold) {
    const stored = driver.step().environment.interactionStore.findThread(THREAD);
    if (!stored) throw new Error("the area search did not persist the thread");
    const projection = JSON.parse(stored.threadJson) as { assistantContext?: Record<string, unknown> };
    projection.assistantContext = { ...(projection.assistantContext ?? {}), checkIn: "2026-11-12", isDemoDate: false, partySize: 1, openQuestion: "nights" };
    driver.step().environment.interactionStore.saveThread({ ...stored, threadJson: JSON.stringify(projection) });
    return;
  }
  const runtime = driver.step().runtime;
  runtime.recordGuestStay(THREAD, { partySize: 1 });
  runtime.recordGuestStay(THREAD, { checkIn: "2026-11-12" });
  runtime.recordOpenQuestion(THREAD, "nights");
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(${mode}) party-size answers are read against the party_size open question and commit the party size`, async () => {
    const cases: readonly [text: string, guests: number][] = [["just me", 1], ["2", 2], ["two of us", 2], ["me and my wife", 2]];
    for (const [text, guests] of cases) {
      const environment = stagingGuest();
      try {
        const harness = recorder({ [AREA]: AREA_TURN, [text]: { slots: { guests }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests } } });
        const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
        card(await driver.typed(AREA));
        assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
        assertOk(await driver.typed(text), text);
        assert.equal(openQuestionSentFor(harness.scopeMessages, harness.requests, text), "party_size", `${text}: the classifier sees party_size`);
        assert.equal(driver.stay().partySize, guests, `${text}: the party size is committed`);
      } finally { environment.close(); }
    }
  });

  test(`(${mode}) an unclear terse answer falls back to the issue 59 re-ask, not the generic unavailable copy`, async () => {
    const environment = stagingGuest();
    try {
      const harness = recorder({ [AREA]: AREA_TURN, "just me": { scope: "unclear" } });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      card(await driver.typed(AREA));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      const result = await driver.typed("just me");
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.openQuestion.party_size]);
    } finally { environment.close(); }
  });

  test(`(${mode}) nights answers are read against the nights open question and commit the nights`, async () => {
    const cases: readonly [text: string, nights: number][] = [["a week", 7], ["3", 3]];
    for (const [text, nights] of cases) {
      const environment = stagingGuest();
      try {
        const harness = recorder({ [AREA]: AREA_TURN, [text]: { slots: { nights }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", nights, guests: 1 } } });
        const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
        card(await driver.typed(AREA));
        setupNightsQuestion(driver, cold);
        assertOk(await driver.typed(text), text);
        assert.equal(openQuestionSentFor(harness.scopeMessages, harness.requests, text), "nights", `${text}: the classifier sees nights`);
        assert.equal(driver.step().runtime.getThread(THREAD).taskState.stayIntent.nights, nights, `${text}: the nights are committed`);
      } finally { environment.close(); }
    }
  });

  test(`(${mode}) pick_result answers open the named result`, async () => {
    const cases: readonly [text: string, stayRef: string][] = [["the first one", "stay-1"], ["the second", "stay-2"]];
    for (const [text, stayRef] of cases) {
      const environment = stagingGuest();
      try {
        const harness = recorder({
          "Lagos from 12 November 2026 for 6 nights for 2 people": { slots: { city: "Lagos", checkIn: "2026-11-12", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", checkIn: "2026-11-12", nights: 6, guests: 2 } },
          // The planner provider fails, so the shell's deterministic "which one" / "open the named result" path takes the turn.
          "Show me the apartment.": { slots: {}, intents: ["details"], providerDown: true },
          [text]: { slots: {}, intents: ["details"], providerDown: true },
        });
        const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
        card(await driver.typed("Lagos from 12 November 2026 for 6 nights for 2 people"));
        assertOk(await driver.typed("Show me the apartment."), "ask which");
        assertOk(await driver.typed(text), text);
        assert.equal(openQuestionSentFor(harness.scopeMessages, harness.requests, text), "pick_result", `${text}: the classifier sees pick_result`);
        // Issue 61: a pick_result question is only answerable against a result list, so the request must show that one exists as a
        // closed count (never unit text). A cold restore rebuilds the shortlist from the discovery results before the turn.
        const pickContext = contextOf([...harness.requests].reverse().find((candidate) => isScopeRequest(candidate) && classifiedMessage(candidate) === text)!);
        assert.ok(typeof pickContext.resultCount === "number" && pickContext.resultCount > 0, `${text}: the classifier is told how many results are shown`);
        assert.equal(driver.step().runtime.getThread(THREAD).taskState.selectedStayRef, stayRef, `${text}: opens ${stayRef}`);
      } finally { environment.close(); }
    }
  });

  test(`(${mode}) the date_confirm answer confirms the check-in on a single-candidate show-back`, async () => {
    const environment = stagingGuest();
    try {
      const showBack: Turn = { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkInPhrase: "tomorrow", nights: 6, guests: 2 } };
      const harness = recorder({ [AREA]: AREA_TURN, "Tomorrow please": showBack, yes: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6, guests: 2 } } });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      card(await driver.typed(AREA));
      assertOk(await driver.typed("Tomorrow please"), "date show-back");
      assertOk(await driver.typed("yes"), "yes");
      assert.equal(openQuestionSentFor(harness.scopeMessages, harness.requests, "yes"), "date_confirm", "the classifier sees date_confirm");
      // The clock is 2026-10-27 (Africa/Lagos), so "tomorrow" resolves to 2026-10-28 and the confirmed show-back commits that date.
      assert.equal(driver.step().runtime.getThread(THREAD).taskState.stayIntent.checkIn, "2026-10-28", "the confirmed check-in date is committed");
    } finally { environment.close(); }
  });

}

// The where question with no city yet cannot survive a cold restore: the persisted assistant context requires a city, so nothing is
// stored until the guest names one. Party size (above) exercises the cold-restore persistence of the code.
test("(warm) the where answer is read against the where open question and commits Abuja, Wuse 2", async () => {
  const environment = stagingGuest();
  try {
    const harness = recorder({ "I need a place": { slots: {}, intents: ["clarify"], reply: "clarify_stay" }, "Wuse 2": { slots: { city: "Abuja", neighbourhood: "Wuse 2" }, intents: ["search"], search: { city: "Abuja", neighbourhood: "Wuse 2" } } });
    const driver = openChipDriver(environment, harness.client, { cold: false, threadId: THREAD });
    assertOk(await driver.typed("I need a place"), "clarify_stay");
    assertOk(await driver.typed("Wuse 2"), "Wuse 2");
    assert.equal(openQuestionSentFor(harness.scopeMessages, harness.requests, "Wuse 2"), "where");
    assert.equal(driver.stay().location, "Abuja");
    assert.equal(driver.stay().neighbourhood, "Wuse 2");
  } finally { environment.close(); }
});

// Issue 61 item 1 (nights:week): a fresh thread with only the open-question code must reach the classifier first, and the classifier
// request must carry the code. It rules out a stated-stay or shell path that answers before the classifier and a context that drops
// the code: the first model call is the classifier, and its envelope names `nights`.
test("(fresh thread) openQuestion nights reaches the classifier first and the request carries the code", async () => {
  const environment = stagingGuest();
  try {
    const requests: CapturedRequest[] = [];
    const { client } = clientWith((request: CapturedRequest) => {
      requests.push(request);
      if (isScopeRequest(request)) return completion({ content: JSON.stringify(scopeVerdict({}, ["search"])) });
      return completion({ content: JSON.stringify({ kind: "clarify_stay", references: [] }) });
    }, OPENROUTER);
    const fixture = wireDatedApp(environment, client);
    const threadId = "g-af61trace";
    fixture.runtime.getThread(threadId);
    fixture.runtime.recordOpenQuestion(threadId, "nights");
    await fixture.runtime.handleTurn(threadId, "a week");
    const first = requests[0];
    assert.ok(first, "the turn made a model call");
    assert.equal(isScopeRequest(first), true, "the classifier is the first model call: no path answers before it");
    assert.equal(contextOf(first).openQuestion, "nights", "the classifier request carries the open question");
    assert.equal(contextOf(first).hasShortlist, false);
    assert.equal(contextOf(first).resultCount, 0);
  } finally { environment.close(); }
});

// Issue 61 item 3 (pick_result): the classifier's structured-output schema and its instruction must accept every scope and reason the
// server parser accepts, and state how a positional pick answers the question. A mismatch here makes a valid verdict unreachable.
test("the concierge_scope schema and instruction allow every scope and reason the parser accepts", async () => {
  const requests: AssistantModelRequest[] = [];
  const client: AssistantModelClient = {
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      requests.push(request);
      return { text: JSON.stringify(scopeVerdict()) };
    },
  };
  const classifier = new ModelScopeClassifier(client, 1_000);
  const verdict = await classifier.assess("the first one", {
    domain: "shortlet", description: "shortlet stays", hasShortlist: true, hasSelectedStay: false, hasOffer: false,
    openQuestion: "pick_result", resultCount: 2,
  });
  assert.ok(verdict, "a valid verdict is returned");
  const request = requests[0]!;
  const schema = request.structuredOutput?.schema as {
    readonly properties: { readonly scope: { readonly enum: readonly string[] }; readonly reasonCode: { readonly enum: readonly string[] }; readonly slots: { readonly properties: { readonly nights: { readonly minimum?: number }; readonly guests: { readonly minimum?: number } } } };
  };
  assert.deepEqual(schema.properties.scope.enum, ["in_scope", "mixed", "out_of_scope", "unclear"]);
  assert.deepEqual(schema.properties.reasonCode.enum, ["supported", "mixed", "outside", "unclear"]);
  assert.equal(schema.properties.slots.properties.nights.minimum, 1);
  assert.equal(schema.properties.slots.properties.guests.minimum, 1);
  assert.match(request.systemInstruction, /supported for in_scope, mixed for mixed, outside for out_of_scope, unclear for unclear/);
  assert.match(request.systemInstruction, /openQuestion is pick_result .*'the first one'.*'the second'/);
  // The context envelope itself carries only closed codes and a count; no unit or listing text.
  const user = [...request.history].reverse().find((step) => step.role === "user");
  assert.ok(user && "text" in user);
  const envelope = JSON.parse(user.text) as { readonly context: Record<string, unknown> };
  assert.equal(envelope.context.openQuestion, "pick_result");
  assert.equal(envelope.context.resultCount, 2);
  assert.deepEqual(Object.keys(envelope.context).sort(), ["description", "domain", "hasOffer", "hasSelectedStay", "hasShortlist", "openQuestion", "resultCount"]);
});


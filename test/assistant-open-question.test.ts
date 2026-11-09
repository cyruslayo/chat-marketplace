import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, type GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { openQuestionForCriteria } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import { createInitialTaskState } from "../apps/local-guest/src/assistant/assistant-state.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import {
  OPENROUTER,
  classifiedMessage,
  isScopeRequest,
  lastRoleIsTool,
  latestUserText,
  scopeVerdict,
} from "./helpers/guest-date-fixtures.js";
import { clientWith, completion, jsonResponse, type CapturedRequest } from "./helpers/openai-compatible-client.js";

// Issue 57 (ADR 0106 amendment, 9 Nov 2026): the assistant remembers the question it asked. A closed, server-set open-question code
// reaches the classifier and the planner, so a terse answer ("Just me", "a week", "the first one") is read as an answer. Tests run with
// the assistant enabled, a cold restore before every event, the 2026-10-27 clock and a staging guest with no phone or email.

const THREAD = "g-a570000901";
const AREA = "Somewhere in Old Ikoyi, Lagos";

interface HardenedTurn {
  readonly slots?: Readonly<Record<string, unknown>>;
  readonly intents?: readonly string[];
  readonly search?: Record<string, unknown>;
  readonly reply?: "clarify_stay";
  readonly scope?: "unclear" | "out_of_scope";
  /** The planner (or classifier) provider fails, so the runtime reports `providerUnavailable` and the shell falls back. */
  readonly providerDown?: boolean;
}

/** The classifier's minimal context envelope, parsed from the request's user message. */
function classifierContext(request: CapturedRequest): Record<string, unknown> {
  const raw = latestUserText(request);
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as { readonly context?: unknown };
    return parsed.context !== null && typeof parsed.context === "object" ? parsed.context as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hardened(turns: Readonly<Record<string, HardenedTurn>>) {
  const scopeRequests: CapturedRequest[] = [];
  const plannerRequests: CapturedRequest[] = [];
  const { client } = clientWith((request) => {
    if (isScopeRequest(request)) {
      scopeRequests.push(request);
      const turn = turns[classifiedMessage(request)];
      if (turn?.scope === "unclear") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "unclear", reasonCode: "unclear" }) });
      if (turn?.scope === "out_of_scope") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "out_of_scope", reasonCode: "outside" }) });
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents)) });
    }
    plannerRequests.push(request);
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    if (turn?.providerDown) return jsonResponse(503, { error: { message: "down" } });
    if (lastRoleIsTool(request)) return completion({ content: "Done." });
    if (turn?.reply) return completion({ content: JSON.stringify({ kind: turn.reply, references: [] }) });
    if (turn?.search) {
      return completion({ tool_calls: [{ id: "search", type: "function", function: { name: "search_stays", arguments: JSON.stringify(turn.search) } }] });
    }
    throw new Error(`Unexpected offline fixture turn: ${text ?? "<none>"}`);
  }, OPENROUTER);
  return { client, scopeRequests, plannerRequests };
}

/** The value of `context.openQuestion` in the classifier request for one guest message, or null when none was sent. */
function openQuestionSentFor(scopeRequests: readonly CapturedRequest[], message: string): string | null {
  const request = [...scopeRequests].reverse().find((candidate) => classifiedMessage(candidate) === message);
  assert.ok(request, `a classifier request was made for "${message}"`);
  const value = classifierContext(request).openQuestion;
  return typeof value === "string" ? value : null;
}

function discoveryCard(result: GuestTurnResult) {
  assertOk(result, "search");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:discovery:/.test(surface.surfaceId));
  assert.ok(card, "the search shows a discovery card");
  return card;
}

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(${mode}) after a When chip that only asks for guests, the next classifier request carries openQuestion party_size`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      // Cold restore: the code is persisted with the context, so a fresh application still holds it.
      assert.equal(driver.step().runtime.getThread(THREAD).taskState.openQuestion, "party_size");
      assertOk(await driver.typed("Just me"), "Just me");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Just me"), "party_size");
      assert.equal(driver.stay().partySize, 1);
    } finally { environment.close(); }
  });

  test(`(${mode}) after a planner clarify_stay reply, the next classifier request carries the code for the next missing criterion`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        "Anything else?": { slots: {}, intents: ["clarify"], reply: "clarify_stay" },
        "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.typed("Anything else?"), "clarify_stay");
      assertOk(await driver.typed("Just me"), "Just me");
      // The area search left the party size as the only missing criterion.
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Just me"), "party_size");
    } finally { environment.close(); }
  });

  test(`(${mode}) after a tool_denial for a missing party size, the code is party_size`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        // Stay details (nights) without a party size is a rejected tool call, before any date authority is read.
        "Add dates": { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6 } },
        "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      // A search with stay details but no party size is a rejected tool call answered with the stay clarification.
      const denied = await driver.typed("Add dates");
      assert.equal(denied.ok, true);
      assertOk(await driver.typed("Just me"), "Just me");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Just me"), "party_size");
    } finally { environment.close(); }
  });

  test(`(${mode}) after a date show-back, the code is date_confirm`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        "Next Friday please": { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkInPhrase: "next Friday", nights: 6, guests: 2 } },
        "Yes": { slots: {}, intents: ["search"] },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.typed("Next Friday please"), "relative date show-back");
      await driver.typed("Yes");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Yes"), "date_confirm");
    } finally { environment.close(); }
  });

  test(`(${mode}) after a location show-back, the code is location_confirm`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        "Actually Abuja": { slots: { city: "Abuja" }, intents: ["search"], search: { city: "Abuja" } },
        "Yes": { slots: {}, intents: ["search"] },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.typed("Actually Abuja"), "cross-city search held as a pending change");
      await driver.typed("Yes");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Yes"), "location_confirm");
    } finally { environment.close(); }
  });

  test(`(${mode}) after an askWhich with several results, the code is pick_result`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        // A complete city-wide search returns several results, so "which one" has choices.
        "Lagos from 12 November 2026 for 6 nights for 2 people": { slots: { city: "Lagos", checkIn: "2026-11-12", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", checkIn: "2026-11-12", nights: 6, guests: 2 } },
        // The planner provider fails, so the shell's deterministic "which one" path runs.
        "Show me the apartment.": { slots: {}, intents: ["details"], providerDown: true },
        "The first one": { slots: {}, intents: ["details"] },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed("Lagos from 12 November 2026 for 6 nights for 2 people"));
      await driver.typed("Show me the apartment.");
      // The classifier request is recorded before the planner runs; this turn only needs to carry the code.
      await driver.typed("The first one");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "The first one"), "pick_result");
    } finally { environment.close(); }
  });

  test(`(${mode}) once the question is answered, the next classifier request carries no code`, async () => {
    const environment = stagingGuest();
    try {
      const harness = hardened({
        [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
        "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
        "Thanks": { slots: {}, intents: ["clarify"] },
      });
      const driver = openChipDriver(environment, harness.client, { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      assertOk(await driver.typed("Just me"), "Just me");
      await driver.typed("Thanks");
      assert.equal(openQuestionSentFor(harness.scopeRequests, "Thanks"), null);
    } finally { environment.close(); }
  });
}

test("(cold) a persisted unknown open-question code is dropped on restore, and the classifier request carries none", async () => {
  const environment = stagingGuest();
  try {
    const harness = hardened({
      [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
      "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: true, threadId: THREAD });
    discoveryCard(await driver.typed(AREA));
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
    // Corrupt the persisted code to a value outside the closed set.
    const stored = driver.step().environment.interactionStore.findThread(THREAD);
    assert.ok(stored, "the thread is saved");
    const projection = JSON.parse(stored.threadJson) as { assistantContext: Record<string, unknown> };
    projection.assistantContext.openQuestion = "drop_tables";
    driver.step().environment.interactionStore.saveThread({ ...stored, threadJson: JSON.stringify(projection) });
    assertOk(await driver.typed("Just me"), "Just me");
    assert.equal(openQuestionSentFor(harness.scopeRequests, "Just me"), null);
  } finally { environment.close(); }
});

test("(warm) the planner's canonical-facts line carries the code, and its history still holds no assistant prose", async () => {
  const environment = stagingGuest();
  try {
    const harness = hardened({
      [AREA]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } },
      "Just me": { slots: { guests: 1 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", guests: 1 } },
    });
    const driver = openChipDriver(environment, harness.client, { cold: false, threadId: THREAD });
    discoveryCard(await driver.typed(AREA));
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
    assertOk(await driver.typed("Just me"), "Just me");
    const request = [...harness.plannerRequests].reverse().find((candidate) => latestUserText(candidate) === "Just me");
    assert.ok(request, "a planner request was made for Just me");
    const messages = (request.body.messages ?? []) as readonly { readonly role: string; readonly content?: unknown }[];
    const facts = messages.filter((message) => message.role === "assistant" && typeof message.content === "string" && message.content.startsWith("Canonical task facts:"));
    assert.equal(facts.length, 1, "exactly one canonical-facts line");
    const factsContent = facts[0]!.content as string;
    const payload = JSON.parse(factsContent.slice("Canonical task facts:".length)) as Record<string, unknown>;
    assert.equal(payload.openQuestion, "party_size");
    // No assistant prose reaches the planner: the only assistant text is the facts line; tool-call steps carry null content.
    assert.ok(messages.filter((message) => message.role === "assistant").every((message) => message.content === null || message.content === factsContent));
  } finally { environment.close(); }
});

test("openQuestionForCriteria names nights when the party size and check-in are known and only the length is missing", () => {
  const state = createInitialTaskState();
  state.stayIntent = { location: "Lagos", neighbourhood: "Old Ikoyi", partySize: 2, checkIn: "2026-11-12" };
  assert.equal(openQuestionForCriteria(state), "nights");
});

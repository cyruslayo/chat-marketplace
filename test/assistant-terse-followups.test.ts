import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { assertOk, openChipDriver, stagingGuest } from "./helpers/assistant-chip-session.js";
import {
  classifiedMessage,
  isScopeRequest,
  lastRoleIsTool,
  latestUserText,
  OPENROUTER,
  scopeVerdict,
  searchToolCall,
} from "./helpers/guest-date-fixtures.js";
import { clientWith, completion, type CapturedRequest } from "./helpers/openai-compatible-client.js";

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

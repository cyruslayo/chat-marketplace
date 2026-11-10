import assert from "node:assert/strict";
import test from "node:test";
import { CRITERIA_EDIT_EVENT, type GuestTurnResult } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
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
import { clientWith, completion } from "./helpers/openai-compatible-client.js";

// Issue 59 (ADR 0106 amendment, 9 Nov 2026): the assistant never dead-ends. When a terse answer is unclear or the classifier fails
// (ordinary risk), the turn re-asks the closed question the assistant last asked, with its chips, instead of the generic fallback.
// An out-of-scope redirect and a risk verdict are unchanged. A refused turn leaves a date show-back intact.

const THREAD = "g-ad59000001";
const AREA = "Somewhere in Old Ikoyi, Lagos";

interface Turn {
  readonly slots?: Readonly<Record<string, unknown>>;
  readonly intents?: readonly string[];
  readonly search?: Record<string, unknown>;
  readonly scope?: "unclear" | "out_of_scope";
  /** Both classifier attempts return malformed JSON, so the classifier stage fails. */
  readonly broken?: true;
}

function model(turns: Readonly<Record<string, Turn>>) {
  return clientWith((request) => {
    if (isScopeRequest(request)) {
      const turn = turns[classifiedMessage(request)];
      if (turn?.broken) return completion({ content: "{not json}" });
      if (turn?.scope === "unclear") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "unclear", reasonCode: "unclear" }) });
      if (turn?.scope === "out_of_scope") return completion({ content: JSON.stringify({ ...scopeVerdict({}, []), scope: "out_of_scope", reasonCode: "outside" }) });
      return completion({ content: JSON.stringify(scopeVerdict(turn?.slots ?? {}, turn?.intents)) });
    }
    const text = latestUserText(request);
    const turn = text === undefined ? undefined : turns[text];
    if (lastRoleIsTool(request)) return completion({ content: "Done." });
    if (turn?.search) return searchToolCall(`search-${text?.length ?? 0}`, turn.search);
    throw new Error(`Unexpected offline fixture turn: ${text ?? "<none>"}`);
  }, OPENROUTER).client;
}

function discoveryCard(result: GuestTurnResult) {
  assertOk(result, "search");
  if (!result.ok) throw new Error("unreachable");
  const card = result.surfaces.find((surface) => /:discovery:/.test(surface.surfaceId));
  assert.ok(card, "the search shows a discovery card");
  return card;
}

const AREA_TURN: Turn = { slots: { city: "Lagos", neighbourhood: "Old Ikoyi" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi" } };

for (const cold of [false, true]) {
  const mode = cold ? "cold" : "warm";

  test(`(${mode}) open question party_size plus an unclear verdict re-asks the party-size question with the who chips`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, model({ [AREA]: AREA_TURN, "Just me": { scope: "unclear" } }), { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      const result = await driver.typed("Just me");
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.openQuestion.party_size]);
      assert.equal(result.assistantControlOutcome, "scope_unavailable");
      assert.ok(result.quickReplies?.some((chip) => chip.label === "Just me"), "the who chips are offered again");
    } finally { environment.close(); }
  });

  test(`(${mode}) a classifier failure (invalid JSON on both attempts) gives the same re-ask`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, model({ [AREA]: AREA_TURN, "Just me": { broken: true } }), { cold, threadId: THREAD });
      discoveryCard(await driver.typed(AREA));
      assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
      const result = await driver.typed("Just me");
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.deepEqual(result.messages, [GUEST_ASSISTANT_COPY.openQuestion.party_size]);
      assert.ok(result.quickReplies?.length, "the re-ask offers chips");
    } finally { environment.close(); }
  });

  test(`(${mode}) unclear with no open question gives the generic copy plus recovery chips`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, model({ hmm: { scope: "unclear" } }), { cold, threadId: THREAD });
      const result = await driver.typed("hmm");
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.unavailable]);
      assert.ok(result.quickReplies && result.quickReplies.length > 0, "recovery chips are offered");
    } finally { environment.close(); }
  });

  test(`(${mode}) out_of_scope keeps the redirect copy, with no re-ask`, async () => {
    const environment = stagingGuest();
    try {
      const driver = openChipDriver(environment, model({ "What is the weather?": { scope: "out_of_scope" } }), { cold, threadId: THREAD });
      const result = await driver.typed("What is the weather?");
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("unreachable");
      assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.redirect]);
      assert.equal(result.assistantControlOutcome, "scope_redirect");
      assert.equal(result.quickReplies, undefined);
    } finally { environment.close(); }
  });
}

test("(cold) a tapped Yes on a date show-back that the classifier refuses leaves the show-back intact and commits no check-in", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, model({
      [AREA]: AREA_TURN,
      "Next Friday please": { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", nights: 6, guests: 2 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkInPhrase: "next Friday", nights: 6, guests: 2 } },
      Yes: { scope: "unclear" },
    }), { cold: true, threadId: THREAD });
    discoveryCard(await driver.typed(AREA));
    assertOk(await driver.typed("Next Friday please"), "date show-back");
    const before = driver.step().runtime.getThread(THREAD).taskState.stayIntent;
    assert.ok(before.pendingDate, "the show-back is open");
    const refused = await driver.typed("Yes");
    assert.equal(refused.ok, true);
    const after = driver.step().runtime.getThread(THREAD).taskState.stayIntent;
    assert.deepEqual(after.pendingDate, before.pendingDate, "the show-back is intact after the refusal");
    assert.equal(after.checkIn, undefined, "no check-in was committed");
  } finally { environment.close(); }
});

test("(cold) a re-ask commits no task state", async () => {
  const environment = stagingGuest();
  try {
    const driver = openChipDriver(environment, model({ [AREA]: AREA_TURN, "Just me": { scope: "unclear" } }), { cold: true, threadId: THREAD });
    discoveryCard(await driver.typed(AREA));
    assertOk(await driver.chip(CRITERIA_EDIT_EVENT, { field: "when", checkIn: "2026-11-12", nights: 6 }), "when chip");
    const snapshot = () => {
      const state = driver.step().runtime.getThread(THREAD).taskState;
      return JSON.stringify({ stayIntent: state.stayIntent, openQuestion: state.openQuestion ?? null, shortlistRefs: state.shortlist.map((stay) => stay.stayRef) });
    };
    const before = snapshot();
    await driver.typed("Just me");
    assert.equal(snapshot(), before, "the re-ask commits no task state");
  } finally { environment.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { clientWith, completion, type CapturedRequest } from "./helpers/openai-compatible-client.js";
import { datedFixture, isScopeRequest, lastRoleIsTool, latestUserText, LIVE_LIKE_CLOCK, OPENROUTER, restartedDatedApp, scopeVerdict, scriptedPlanner, searchToolCall, type DatedFixture } from "./helpers/guest-date-fixtures.js";

// ADR 0106 / ADR 0099 / issue 03: the classifier and planner are told today's date, once per turn, in the per-turn request
// context. The line is built by the shortlet pack from the injected clock and BOOKING_HORIZON_DAYS. It grants no date
// authority, and it never enters the system instruction, which must stay byte-identical across days (prompt cache).

/** The line at the staging-like clock, 27 Oct 2026 (Africa/Lagos). The last bookable check-in is today + 90 days. */
const TURN_LINE = "Today is Tuesday 27 October 2026 (Africa/Lagos). The last bookable check-in is 25 January 2027.";
const STAY_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const STAY_SLOTS = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const STAY_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
/** No date in the guest's text: the model may only propose one by inventing it. */
const UNDATED_TEXT = "Apartment in Lekki for 2 guests, 3 nights";
const SCRIPT = { [STAY_TEXT]: { slots: STAY_SLOTS, search: STAY_SEARCH } };

/** The user-role text of a request that carries the per-turn context line, if any. */
function contextLines(request: CapturedRequest): readonly string[] {
  const messages = request.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
  return messages.filter((message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith("Today is "))
    .map((message) => message.content as string);
}

/** The classifier's per-turn envelope, parsed: the message and the minimal task context. */
function classifierEnvelope(request: CapturedRequest): { readonly message: string; readonly context: Record<string, unknown> } {
  const messages = request.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
  const content = messages.filter((message) => message.role === "user").at(-1)?.content;
  return JSON.parse(String(content)) as { readonly message: string; readonly context: Record<string, unknown> };
}

function systemInstructionOf(request: CapturedRequest): string {
  const messages = request.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
  return String(messages.find((message) => message.role === "system")?.content);
}

/** A cold restore before the event: a new application and runtime over the same store (ADR 0106 staging-like journey). */
function coldApp(f: DatedFixture, model: AssistantModelClient, diagnostics?: AssistantDiagnosticEvent[]) {
  return restartedDatedApp(f, model, diagnostics);
}

test("Turn date AC1: a classifier request built at 2026-10-27 contains that date, its weekday and Africa/Lagos", async () => {
  const stub = scriptedPlanner(SCRIPT);
  const f = datedFixture(stub.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    await coldApp(f, stub.client).app.handleTurn("g-d03a000001", STAY_TEXT);
    const classifier = stub.requests.find(isScopeRequest);
    assert.ok(classifier, "the classifier was called");
    assert.deepEqual(contextLines(classifier), [TURN_LINE], "the classifier request carries exactly one turn-context message, after the system message");
    assert.match(TURN_LINE, /Tuesday 27 October 2026/);
    assert.match(TURN_LINE, /Africa\/Lagos/);
    assert.equal(classifierEnvelope(classifier).message, STAY_TEXT, "the guest message is still what the classifier judges");
    assert.ok(!("turnContext" in classifierEnvelope(classifier).context), "the line is not in the classifier's JSON envelope");
  } finally { f.close(); }
});

test("Turn date AC2: a planner request contains the same line and the last bookable check-in date", async () => {
  const stub = scriptedPlanner(SCRIPT);
  const f = datedFixture(stub.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const restored = coldApp(f, stub.client);
    const result = await restored.app.handleTurn("g-d03a000002", STAY_TEXT);
    assert.equal(result.ok, true);
    const planner = stub.requests.filter((request) => !isScopeRequest(request) && !lastRoleIsTool(request)).at(-1);
    assert.ok(planner, "the planner was called");
    assert.deepEqual(contextLines(planner), [TURN_LINE], "the planner request carries exactly one turn-context line");
    const messages = planner.body.messages as readonly { readonly role: string; readonly content?: unknown }[];
    assert.deepEqual([messages[0]?.role, messages[1]], ["system", { role: "user", content: TURN_LINE }], "the line follows the cached system message");
    assert.match(TURN_LINE, /25 January 2027/, "the line names the last bookable check-in (today + 90 days)");
    // The line is request-only: it is never persisted into the thread history.
    assert.ok(!restored.runtime.getThread("g-d03a000002").conversationHistory.some((step) => step.role === "user" && step.text.startsWith("Today is ")), "the line is never persisted");
  } finally { f.close(); }
});

test("Turn date AC3: a planner date the guest did not write is still rejected as tool_denial, though the model now knows the date", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const stub = clientWith((request) => {
    if (isScopeRequest(request)) return completion({ content: JSON.stringify(scopeVerdict({ city: "Lagos", neighbourhood: "Lekki Phase 1", guests: 2, nights: 3 })) });
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    // The planner proposes the last bookable check-in from the context line. The guest never wrote that date.
    if (latestUserText(request) === UNDATED_TEXT) return searchToolCall("unwritten-date", { ...STAY_SEARCH, checkIn: "2027-01-25" });
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER);
  const f = datedFixture(stub.client, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const result = await coldApp(f, stub.client, diagnostics).app.handleTurn("g-d03a000003", UNDATED_TEXT);
    assert.equal(result.ok, true, "a date authority rejection is not CONCIERGE_UNAVAILABLE");
    assert.deepEqual(result.surfaces, []);
    assert.equal(result.messages?.[0], GUEST_ASSISTANT_COPY.datesClarification, "the reply asks for the date in a supported form");
    assert.ok(stub.requests.some((request) => !isScopeRequest(request) && contextLines(request).includes(TURN_LINE)), "the model was shown the line");
    assert.ok(diagnostics.some((event) => event.stage === "turn_stop" && event.stopReason === "tool_denial"), "the turn stops as tool_denial");
    assert.ok(!diagnostics.some((event) => event.stage === "application_operation" && event.succeeded), "no search ran");
  } finally { f.close(); }
});

test("Turn date AC4: the system instruction is byte-identical for classifier and planner requests on two different clock days", async () => {
  const dayOne = scriptedPlanner(SCRIPT);
  const dayTwo = scriptedPlanner(SCRIPT);
  const first = datedFixture(dayOne.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const second = datedFixture(dayTwo.client, undefined, { clock: () => new Date("2026-10-28T10:00:00Z"), stagingGuest: true });
  try {
    await coldApp(first, dayOne.client).app.handleTurn("g-d03a000004", STAY_TEXT);
    await coldApp(second, dayTwo.client).app.handleTurn("g-d03a000005", STAY_TEXT);
    const classifierDayOne = dayOne.requests.find(isScopeRequest);
    const classifierDayTwo = dayTwo.requests.find(isScopeRequest);
    const plannerDayOne = dayOne.requests.find((request) => !isScopeRequest(request));
    const plannerDayTwo = dayTwo.requests.find((request) => !isScopeRequest(request));
    assert.ok(classifierDayOne && classifierDayTwo && plannerDayOne && plannerDayTwo, "both roles were called on both days");
    assert.equal(systemInstructionOf(classifierDayOne), systemInstructionOf(classifierDayTwo), "the classifier system instruction is identical");
    assert.equal(systemInstructionOf(plannerDayOne), systemInstructionOf(plannerDayTwo), "the planner system instruction is identical");
    assert.ok(!systemInstructionOf(plannerDayOne).includes("Today is") && !systemInstructionOf(plannerDayOne).includes("27 October"), "no date in the planner system instruction");
    // The day does change, but only in the per-turn context.
    assert.deepEqual(contextLines(classifierDayOne), [TURN_LINE]);
    assert.deepEqual(contextLines(classifierDayTwo), ["Today is Wednesday 28 October 2026 (Africa/Lagos). The last bookable check-in is 26 January 2027."]);
    assert.deepEqual(contextLines(plannerDayTwo), ["Today is Wednesday 28 October 2026 (Africa/Lagos). The last bookable check-in is 26 January 2027."]);
  } finally { first.close(); second.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { datedFixture, firstButtonAction, isScopeRequest, classifiedMessage, latestUserText, lastRoleIsTool, LIVE_LIKE_CLOCK, OPENROUTER, scopeVerdict, scriptedPlanner, wireDatedApp, type ScopeSlots, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { clientWith, completion } from "./helpers/openai-compatible-client.js";
import { addDays } from "./helpers/demo-extended-journey.js";

// ADR 0023 as amended 1 Nov 2026 (Continuous Occupancy at one Property, 29 nights in total for Short Stays), ADR 0106
// (a refusal is a rejected tool call, tool_denial, never CONCIERGE_UNAVAILABLE; cold restore before every event), ADR 0075
// (the refusal names no guest identifier). Staging-like clock (27 Oct 2026) and a staging-like guest (no seeded contact).

const CHECK_IN = "2026-12-14";
const PRIOR_NIGHTS = 20;
const NIGHTS = 10;
const TEXT = "Ikoyi for 10 nights, 2 guests from 14 December 2026";
const SLOTS = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights: NIGHTS, guests: 2 };
const SEARCH = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights: NIGHTS, guests: 2 };

function scriptFor(): Record<string, ScriptedTurn> {
  return { [TEXT]: { slots: SLOTS, search: SEARCH } };
}

function successOf(result: GuestTurnResult, label: string): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("AC8: With the assistant runtime enabled and a cold restore before every event, the AC1 refusal reaches the guest as a refusal, not CONCIERGE_UNAVAILABLE", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const model = scriptedPlanner(scriptFor()).client;
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const environment: LocalGuestEnvironment = f.environment;
  const threadId = "g-0cc0000801";
  try {
    const search = successOf(await wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, TEXT), "search");
    assert.ok(search.surfaces.length > 0, "the 10-night search shows a discovery surface");

    // The guest already holds 20 nights at this Property, ending on the new check-in. The Booking Request is pending,
    // which counts (ADR 0023 as amended 1 Nov 2026). It is made through the composition's own draft and disclosure.
    const shown = JSON.stringify(search.surfaces[0]!.a2uiMessages);
    const unit = environment.unitRepository.findAll().find((candidate) => shown.includes(candidate.id));
    assert.ok(unit, "the search shows a unit of this composition");
    // Submitting the prior request needs a saved phone (ADR 0085). The journey below stops at the refusal, before its own phone step.
    environment.guestContactApp.submitPhone({ phoneNumber: "+234 801 234 5678" }, environment.guestPrincipal());
    const priorCheckIn = addDays(CHECK_IN, -PRIOR_NIGHTS);
    const prior = environment.bookingRequestApp.createDraft({
      unitId: unit.id,
      primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
      occupants: environment.demoOccupants(1),
      selfBookingAttestation: environment.selfBookingAttestation(),
      checkIn: priorCheckIn,
      checkOut: CHECK_IN,
    }, environment.guestPrincipal());
    environment.bookingRequestApp.disclose(prior.draftId, environment.guestPrincipal());

    const detail = successOf(await wireDatedApp(environment, model, diagnostics).app.handleEventAsync(threadId, firstButtonAction(search.surfaces[0]!)), "View");
    assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, "View opens the unit detail");

    // Request to Book is a button event of the assistant journey (not a planner tool call), so the refusal is an ordinary
    // guest-facing refusal (ADR 0106): a GuestRejection with the server's sentence, never CONCIERGE_UNAVAILABLE.
    const outcome = await wireDatedApp(environment, model, diagnostics).app.handleEventAsync(threadId, firstButtonAction(detail.surfaces[0]!));
    assert.equal(outcome.ok, false, "the refusal is a refusal");
    assert.equal(outcome.ok === false ? outcome.code : undefined, "CONTINUOUS_OCCUPANCY_REFUSED", "the refusal is not CONCIERGE_UNAVAILABLE");
    assert.equal(outcome.ok === false ? outcome.message : undefined, "These dates join another stay of yours at this property, making 30 nights. A stay of 30 nights or more must be booked as one Extended Stay.", "the refusal names the 30-night total");
    assert.notEqual(outcome.ok === false ? outcome.message : "", ASSISTANT_CONTROL_COPY.unavailable, "the control copy is not shown");
  } finally {
    f.close();
  }
});

interface PlannerStep {
  readonly slots: Partial<ScopeSlots>;
  readonly intents: readonly string[];
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/**
 * A scripted OpenRouter-compatible model for a multi-turn planner journey: each listed guest message gets its scope verdict
 * and one planner tool call, and after a tool result the planner closes its round. Stay references are the pack's own
 * sequential "stay-1" (the first result of the search).
 */
function journeyPlanner(steps: Readonly<Record<string, PlannerStep>>) {
  return clientWith((request) => {
    if (isScopeRequest(request)) {
      const step = steps[classifiedMessage(request)];
      return completion({ content: JSON.stringify(scopeVerdict(step?.slots ?? {}, step?.intents)) });
    }
    if (lastRoleIsTool(request)) return completion({ content: "Done." });
    const text = latestUserText(request);
    const step = text === undefined ? undefined : steps[text];
    if (!step || text === undefined) throw new Error("Unexpected offline fixture turn");
    return completion({ tool_calls: [{ id: `planner-${text.length}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } }] });
  }, OPENROUTER).client;
}

const SEARCH_TEXT = "Ikoyi for 10 nights, 2 guests from 14 December 2026";
const VIEW_TEXT = "Tell me about the first stay";
const DRAFT_TEXT = "Prepare a request draft for it";
const SEARCH_SLOTS = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights: NIGHTS, guests: 2 } as const;

test("AC8 (planner): a planner prepare_request_draft that would breach Continuous Occupancy is a tool_denial with the server sentence, not CONCIERGE_UNAVAILABLE", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const model = journeyPlanner({
    [SEARCH_TEXT]: { slots: SEARCH_SLOTS, intents: ["search"], tool: "search_stays", args: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights: NIGHTS, guests: 2 } },
    [VIEW_TEXT]: { slots: {}, intents: ["details"], tool: "get_unit_details", args: { stayRef: "stay-1" } },
    [DRAFT_TEXT]: { slots: {}, intents: ["draft"], tool: "prepare_request_draft", args: { stayRef: "stay-1", nights: NIGHTS, guests: 2 } },
  });
  const f = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const environment: LocalGuestEnvironment = f.environment;
  const threadId = "g-0cc0000802";
  try {
    // Every event is a cold restore: a new application over the same store, on the same thread.
    const search = successOf(await wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, SEARCH_TEXT), "search");
    assert.ok(search.surfaces.length > 0, "the search shows a discovery surface");
    const shown = JSON.stringify(search.surfaces[0]!.a2uiMessages);
    const unit = environment.unitRepository.findAll().find((candidate) => shown.includes(candidate.id));
    assert.ok(unit, "the search shows a unit of this composition");

    successOf(await wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, VIEW_TEXT), "view the first stay");

    // The guest holds 20 nights at this Property ending on the check-in, as a pending Booking Request (ADR 0023 as amended 1 Nov 2026).
    environment.guestContactApp.submitPhone({ phoneNumber: "+234 801 234 5678" }, environment.guestPrincipal());
    const prior = environment.bookingRequestApp.createDraft({
      unitId: unit.id,
      primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
      occupants: environment.demoOccupants(1),
      selfBookingAttestation: environment.selfBookingAttestation(),
      checkIn: addDays(CHECK_IN, -PRIOR_NIGHTS),
      checkOut: CHECK_IN,
    }, environment.guestPrincipal());
    environment.bookingRequestApp.disclose(prior.draftId, environment.guestPrincipal());
    const requestsBefore = environment.interactionStore.listBookingRequestIds().length;

    const draft = successOf(await wireDatedApp(environment, model, diagnostics).app.handleTurn(threadId, DRAFT_TEXT), "prepare the request draft");

    // The planner's tool call was rejected with the server's own sentence: no draft surface, no new request, no hold.
    assert.deepEqual(draft.messages, ["These dates join another stay of yours at this property, making 30 nights. A stay of 30 nights or more must be booked as one Extended Stay."], "the refusal sentence reaches the guest");
    assert.equal(draft.surfaces.length, 0, "no Request Draft surface is created");
    assert.equal(draft.messages.includes(ASSISTANT_CONTROL_COPY.unavailable), false, "the control copy is not shown");
    // The prepare_request_draft call failed in its application operation, and the turn stopped as a tool_denial (ADR 0106).
    const rejected = diagnostics.find((event) => event.stage === "application_operation" && event.toolName === "prepare_request_draft" && event.succeeded === false);
    assert.ok(rejected, "the prepare_request_draft tool call is recorded as rejected");
    assert.ok(diagnostics.some((event) => event.stage === "turn_stop" && event.stopReason === "tool_denial"), "the turn stops as tool_denial");
    assert.equal(environment.interactionStore.listBookingRequestIds().length, requestsBefore, "no new Booking Request is created");
    assert.equal(environment.calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, NIGHTS), clock: LIVE_LIKE_CLOCK }).isAvailable, true, "no nights are held for the refused stay");
  } finally {
    f.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import type { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
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

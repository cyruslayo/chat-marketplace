import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { GuestTurnResult, GuestTurnSuccess } from "../apps/local-guest/src/shortlet-app.js";
import { VIEW_UNIT_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";
import { datedFixture, restartedDatedApp, runtimeDiscoveryArtifact, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { STAGING_LIKE_START, SteppedClock } from "./helpers/assistant-turn-model.js";
import { MAX_ASSISTANT_TOOL_ROUNDS } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { SERVER_TURN_MAX_MS } from "../apps/local-guest/src/turn-budget.js";

// ADR 0106 and ADR 0077/0080: a turn's stop reason is server-side and per turn, but the surfaces and artifacts it leaves must
// survive the browser's next request, which reaches a restored application (a new LocalGuestApp over the same store).
// Staging-like clock (27 Oct 2026), assistant runtime enabled, staging-like guest (no phone or email).

const LEKKI_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const LEKKI_SEARCH = { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 };
const LEKKI_LATER_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 21 December 2026";
const LEKKI_LATER_SEARCH = { ...LEKKI_SEARCH, checkIn: "2026-12-21" };
const SCRIPT = {
  [LEKKI_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-14", nights: 3, guests: 2 }, search: LEKKI_SEARCH },
  [LEKKI_LATER_TEXT]: { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-21", nights: 3, guests: 2 }, search: LEKKI_LATER_SEARCH },
};

interface PlannerOptions {
  /** Runs once, before the first planner request of the turn (the request then answers as the script says). */
  readonly onFirstPlannerRequest?: () => void;
  /** Every planner request asks for the same search, so only the round cap or the summary call can end the turn. */
  readonly searchEveryRound?: boolean;
}

/**
 * The OpenRouter-compatible scripted client (the real adapter path, reservation-aware) with two optional overrides.
 * The override calls the provider attempt hook itself, as an adapter must.
 */
function plannerFor(options: PlannerOptions = {}): AssistantModelClient {
  const scripted = scriptedPlanner(SCRIPT).client;
  let firstPlannerRequest = true;
  return {
    supportsProviderAttemptReservation: true as const,
    async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
      if (request.structuredOutput?.name === "concierge_scope") return scripted.generate(request);
      if (firstPlannerRequest) {
        firstPlannerRequest = false;
        options.onFirstPlannerRequest?.();
      }
      if (options.searchEveryRound && request.tools.length > 0) {
        await request.beforeProviderAttempt?.();
        return { toolCalls: [{ id: `search-round-${request.history.length}`, name: "search_stays", args: LEKKI_SEARCH }] };
      }
      return scripted.generate(request);
    },
  };
}

function stop(round: number, stopReason: string, succeeded: boolean) {
  return { stage: "turn_stop", round, succeeded, stopReason };
}

function stopEvents(diagnostics: readonly AssistantDiagnosticEvent[]) {
  return diagnostics.filter((event) => event.stage === "turn_stop");
}

function successOf(result: GuestTurnResult): GuestTurnSuccess {
  assert.equal(result.ok, true, result.ok ? "" : `expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

/** A new application over the same store, then the browser's page load, before the next event is sent. */
function coldApp(f: DatedFixture, threadId: string, model: AssistantModelClient = plannerFor()) {
  const restored = restartedDatedApp(f, model);
  restored.app.getState(threadId);
  return restored;
}

function viewEvent(surfaceId: string, artifactId: string, unitId: string) {
  return { name: VIEW_UNIT_EVENT, surfaceId, sourceComponentId: "card-view", timestamp: new Date().toISOString(), context: { artifactId, unitId } };
}

function fixture(clock: SteppedClock, model: AssistantModelClient, diagnostics: AssistantDiagnosticEvent[]): DatedFixture {
  return datedFixture(model, diagnostics, { clock: clock.now, stagingGuest: true });
}

test("a planner search that passes the turn deadline is kept after a cold restore, and its superseded ids fail closed", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  // The first planner request spends one second past the turn deadline and asks for the search, which runs.
  const f = fixture(clock, plannerFor({ onFirstPlannerRequest: () => clock.advance(SERVER_TURN_MAX_MS + 1_000) }), diagnostics);
  try {
    const threadId = "g-d1a0000401";
    const turn = successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
    assert.deepEqual(stopEvents(diagnostics), [stop(1, "turn_deadline", false)]);
    const card = turn.surfaces[0];
    assert.ok(card?.surfaceId.includes(":discovery:"), "the fallback returns the search's discovery card");
    const artifactId = runtimeDiscoveryArtifact(f.runtime, threadId)?.id;
    const unitId = runtimeDiscoveryArtifact(f.runtime, threadId)?.facts.results[0]?.id;
    assert.ok(artifactId && unitId, "the search leaves a discovery artifact with a first result");

    // Cold restore: the card's surface and artifact ids are rebuilt, not re-minted.
    const restored = coldApp(f, threadId);
    assert.equal(runtimeDiscoveryArtifact(restored.runtime, threadId)?.id, artifactId, "the restored artifact keeps the id the card holds");
    assert.ok((restored.app.getState(threadId)?.surfaces ?? []).some((surface) => surface.surfaceId === card?.surfaceId), "the restored card keeps its surface id");
    const opened = successOf(await restored.app.handleEventAsync(threadId, viewEvent(card!.surfaceId, artifactId, unitId)));
    assert.match(opened.surfaces[0]?.surfaceId ?? "", /:unit:detail:/, "View opens the unit after the cold restore");

    // A newer search supersedes the first card; after a cold restore the older ids fail closed.
    const later = successOf(await coldApp(f, threadId).app.handleTurn(threadId, LEKKI_LATER_TEXT));
    const newerSurface = later.surfaces[0]!.surfaceId;
    const afterSecondSearch = coldApp(f, threadId);
    const superseded = await afterSecondSearch.app.handleEventAsync(threadId, viewEvent(card!.surfaceId, artifactId, unitId));
    assert.equal(superseded.ok, false);
    assert.equal(superseded.ok ? "" : superseded.code, "STALE_SURFACE", "the superseded surface id is refused");
    const mismatched = await coldApp(f, threadId).app.handleEventAsync(threadId, viewEvent(newerSurface, artifactId, unitId));
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.ok ? "" : mismatched.code, "ARTIFACT_MISMATCH", "the superseded artifact id on the newer card is refused");
  } finally { f.close(); }
});

test("a turn that reaches the round cap is kept after a cold restore, and its card opens", async () => {
  const clock = new SteppedClock(STAGING_LIKE_START);
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = fixture(clock, plannerFor({ searchEveryRound: true }), diagnostics);
  try {
    const threadId = "g-d1a0000402";
    const turn = successOf(await f.app.handleTurn(threadId, LEKKI_TEXT));
    // Four searches and one tool-free summary call: the summary is the fifth planner-level request.
    assert.deepEqual(stopEvents(diagnostics), [stop(5, "round_limit", true)]);
    // Each round's search returns its own card; the turn's last card is the active one, the earlier ones are superseded.
    const card = turn.surfaces.at(-1);
    assert.equal(turn.surfaces.length, MAX_ASSISTANT_TOOL_ROUNDS, "one discovery card per search round");
    assert.ok(card?.surfaceId.includes(":discovery:"), "the round-limit turn keeps its discovery card");
    const artifact = runtimeDiscoveryArtifact(f.runtime, threadId);
    assert.ok(artifact?.facts.results[0], "the search leaves a result");

    const restored = coldApp(f, threadId);
    assert.equal(runtimeDiscoveryArtifact(restored.runtime, threadId)?.id, artifact?.id, "the restored artifact keeps the id the card holds");
    assert.ok((restored.app.getState(threadId)?.surfaces ?? []).some((surface) => surface.surfaceId === card?.surfaceId), "the restored card keeps its surface id");
    const opened = successOf(await restored.app.handleEventAsync(threadId, viewEvent(card!.surfaceId, artifact!.id, artifact!.facts.results[0]!.id)));
    assert.match(opened.surfaces[0]?.surfaceId ?? "", /:unit:detail:/, "View opens the unit after the cold restore");
  } finally { f.close(); }
});

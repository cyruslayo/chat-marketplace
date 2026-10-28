import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type GuestTurnResult, type GuestStateSnapshot } from "../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantTurnRecord } from "../apps/local-guest/src/assistant/assistant-turn-record.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { TurnTransaction } from "../apps/local-guest/src/assistant/assistant-turn-transaction.js";
import { THREAD_BUSY_CODE } from "../apps/local-guest/src/assistant/assistant-thread-lock.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { ModelCallBudget, BudgetedModelClient } from "../apps/local-guest/src/assistant/model-call-budget.js";
import { definitionOf, journeyScriptedModel, PROPOSE_REQUEST, SEARCH_IKOYI, type RecordedJourneyDefinition } from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, firstButtonAction } from "./helpers/guest-date-fixtures.js";

// Issue 06 (ADR 0070): one mutating run per thread, a closed THREAD_BUSY refusal, and task-state commits that cannot restore an
// executed proposal. Staging-like clock (27 Oct 2026), assistant enabled, a guest with a phone (so a Booking Request confirms).
// The in-flight run and the events that interleave with it go to the SAME application and runtime, as a Durable Object instance
// serves them (its runtime is cached per instance, shortlet-pilot-do.ts). The cold-restore check is the last test.

const THREAD = "g-d1a0000601";
const OTHER_THREAD = "g-d1a0000602";
const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
const PROPOSE_TEXT = "Request the first one.";
/** The typed turn held at the planner: a unit-detail read, which runs one planner round after its tool call. */
const HELD_TEXT = "Open the first one.";

/** The recorded confirmation journey, extended with the held planner turn. */
function lockDefinition(threadId: string): RecordedJourneyDefinition {
  return {
    ...definitionOf("confirmation-cancelled"),
    threadId,
    guestTurns: [
      { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: PROPOSE_TEXT, planner: PROPOSE_REQUEST },
      { text: HELD_TEXT, planner: { tool: "get_unit_details", args: { stayRef: "stay-1" } } },
    ],
  };
}

interface Gate {
  /** Resolves when the held planner request has started and is waiting. */
  readonly reached: Promise<void>;
  /** Lets the held planner request continue. */
  release(): void;
  /** Runs when the test releases the held request, before it continues (a deadline passing, for example). */
  beforeRelease?: () => void;
  /** When set, the held request throws instead of answering. */
  failOnRelease?: Error;
}

/** A model that holds the first planner request for `holdText` until the test releases it. Every other request passes through. */
function gatedModel(inner: AssistantModelClient, holdText: string): { model: AssistantModelClient; gate: Gate } {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  let holding = false;
  const gate: Gate = { reached, release: () => release() };
  const model: AssistantModelClient = {
    supportsProviderAttemptReservation: inner.supportsProviderAttemptReservation,
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const last = request.history.at(-1);
      if (!holding && request.structuredOutput?.name !== "concierge_scope" && last?.role === "user" && last.text === holdText) {
        holding = true;
        reach();
        await released;
        gate.beforeRelease?.();
        if (gate.failOnRelease) throw gate.failOnRelease;
      }
      return inner.generate(request);
    },
  };
  return { model, gate };
}

interface LockWorld {
  readonly environment: LocalGuestEnvironment;
  readonly app: LocalGuestApp;
  readonly runtime: ShortletAssistantRuntime;
  readonly records: AssistantTurnRecord[];
  readonly diagnostics: AssistantDiagnosticEvent[];
}

/** One application and runtime over the environment. The records and diagnostics are the runtime's own output. */
function worldOver(environment: LocalGuestEnvironment, model: AssistantModelClient): LockWorld {
  const records: AssistantTurnRecord[] = [];
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const budget = new ModelCallBudget(50, () => environment.clock());
  const runtime = new ShortletAssistantRuntime(environment, new BudgetedModelClient(model, budget), {
    onTurnRecord: (record) => records.push(record),
    onDiagnostic: (event) => diagnostics.push(event),
    modelName: "openai/gpt-6-luna",
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, app, runtime, records, diagnostics };
}

function phoneEnvironment(clock: () => Date = LIVE_LIKE_CLOCK): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock });
}

function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function codeOf(result: GuestTurnResult): string | undefined {
  return result.ok ? undefined : result.code;
}

function pendingId(world: LockWorld, threadId: string): string | undefined {
  return world.runtime.getThread(threadId).taskState.pendingAction?.id;
}

/** The confirm event of the live pending-action card, as the guest's button sends it. */
function confirmEventFor(world: LockWorld, threadId: string, card: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }) {
  const live = firstButtonAction(card);
  return { ...live, name: ASSISTANT_CONFIRM_ACTION_EVENT, context: { ...live.context, actionId: pendingId(world, threadId) } };
}

/** Searches, then proposes a Booking Request on the thread. Returns the proposal's pending-action card. */
async function proposeOn(world: LockWorld, threadId: string) {
  world.app.getState(threadId);
  successOf(await world.app.handleTurn(threadId, SEARCH_TEXT), "search");
  const proposal = successOf(await world.app.handleTurn(threadId, PROPOSE_TEXT), "propose");
  const card = proposal.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "the proposal shows its pending-action card");
  return card;
}

test("a confirm that lands while a typed turn is in flight is refused with THREAD_BUSY and the proposal stays open", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  const card = await proposeOn(world, THREAD);
  const confirm = confirmEventFor(world, THREAD, card);

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const refused = await world.app.handleEventAsync(THREAD, confirm);
  assert.equal(codeOf(refused), THREAD_BUSY_CODE, "the confirm is refused while the typed turn runs");
  assert.notEqual(pendingId(world, THREAD), undefined, "the refused confirm leaves the proposal open");

  gate.release();
  successOf(await inFlight, "the in-flight typed turn completes");
  assert.notEqual(pendingId(world, THREAD), undefined, "the typed turn's commit keeps the still-open proposal");
  successOf(await world.app.handleTurn(THREAD, "Yes"), "a later yes confirms the still-open proposal once");
  assert.equal(pendingId(world, THREAD), undefined, "the confirmed proposal is no longer open");
});

test("the runtime itself refuses a confirm event while a typed run is in flight, for a host that calls it directly", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  const card = await proposeOn(world, THREAD);
  const confirm = confirmEventFor(world, THREAD, card);

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const direct = world.runtime.handleAssistantEvent(THREAD, ASSISTANT_CONFIRM_ACTION_EVENT, confirm.context);
  assert.equal(direct.ok, false, "the runtime refuses the confirm");
  assert.equal(direct.ok ? undefined : direct.code, THREAD_BUSY_CODE, "the refusal is THREAD_BUSY");
  assert.notEqual(pendingId(world, THREAD), undefined, "the proposal is not executed by the refused event");

  gate.release();
  successOf(await inFlight, "the held turn completes");
});

test("a confirm that lands before a typed turn starts cannot be undone by that turn's later commit", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  const card = await proposeOn(world, THREAD);
  successOf(await world.app.handleEventAsync(THREAD, confirmEventFor(world, THREAD, card)), "the button confirms the proposal");
  assert.equal(pendingId(world, THREAD), undefined, "the proposal is executed");

  // The typed turn starts after the confirm, so its candidate holds no proposal and its later commit restores nothing.
  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  gate.release();
  successOf(await inFlight, "the typed turn completes");
  assert.equal(pendingId(world, THREAD), undefined, "the executed proposal is not restored by the typed turn's commit");
  const later = await world.app.handleTurn(THREAD, "Yes").then(
    (result) => ({ threw: false as const, result }),
    (error: unknown) => ({ threw: true as const, error }),
  );
  assert.equal(later.threw, false, "a later Yes does not throw");
});

test("a second typed turn that lands while a typed turn is in flight is refused with THREAD_BUSY and never waits behind the model", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const second = await world.app.handleTurn(THREAD, PROPOSE_TEXT);
  assert.equal(codeOf(second), THREAD_BUSY_CODE, "a second typed turn is refused, not queued");

  gate.release();
  successOf(await inFlight, "the first typed turn completes");
});

test("a later Yes after the proposal was executed returns a closed code and never throws", async () => {
  const environment = phoneEnvironment();
  const world = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  const card = await proposeOn(world, THREAD);
  successOf(await world.app.handleEventAsync(THREAD, confirmEventFor(world, THREAD, card)), "the button confirms the proposal");

  const later = await world.app.handleTurn(THREAD, "Yes").then(
    (result) => ({ threw: false as const, result }),
    (error: unknown) => ({ threw: true as const, error }),
  );
  assert.equal(later.threw, false, "a later Yes does not throw out of the turn");
  if (!later.threw && !later.result.ok) assert.match(later.result.code ?? "", /^[A-Z_]+$/, "the refusal carries a closed code");
});

test("a Yes whose confirmation the domain refuses returns a closed code, drops the proposal and never throws", async () => {
  const environment = phoneEnvironment();
  const world = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  await proposeOn(world, THREAD);
  const refs = world.runtime.getThread(THREAD).taskState.pendingAction?.authoritativeReferences;
  assert.ok(refs?.unitId && refs.checkIn && refs.checkOut, "the proposal names its unit and dates");
  // Another request takes the same Unit and dates first, so the domain refuses the open proposal when it is confirmed.
  const guest = world.environment.guestPrincipal();
  const rival = world.environment.bookingRequestApp.createDraft({
    unitId: refs.unitId,
    primaryGuest: { id: world.environment.config.guestId, name: world.environment.config.guestName },
    occupants: world.environment.demoOccupants(refs.partySize ?? 1),
    selfBookingAttestation: world.environment.selfBookingAttestation(),
    checkIn: refs.checkIn,
    checkOut: refs.checkOut,
  }, guest);
  world.environment.bookingRequestApp.disclose(rival.draftId, guest);

  const yes = await world.app.handleTurn(THREAD, "Yes").then(
    (result) => ({ threw: false as const, result }),
    (error: unknown) => ({ threw: true as const, error }),
  );
  assert.equal(yes.threw, false, "the domain refusal does not throw out of the turn");
  if (!yes.threw) assert.equal(yes.result.ok, false, "the domain refusal is a closed refusal");
  assert.equal(pendingId(world, THREAD), undefined, "the refused proposal is dropped, so a later Yes cannot retry it");
});

test("THREAD_BUSY clears after the run ends, including a run that threw inside the planner (finally)", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  gate.failOnRelease = new Error("the planner transport broke");
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT).then(
    (result) => ({ threw: false as const, result }),
    (error: unknown) => ({ threw: true as const, error }),
  );
  await gate.reached;
  assert.equal(codeOf(await world.app.handleTurn(THREAD, PROPOSE_TEXT)), THREAD_BUSY_CODE, "busy while the run is in flight");
  gate.release();
  await inFlight;

  const after = await world.app.handleTurn(THREAD, PROPOSE_TEXT);
  assert.notEqual(codeOf(after), THREAD_BUSY_CODE, "the lock is free after the run ended");
});

test("THREAD_BUSY clears after a turn that stops at its whole-turn deadline (finally)", async () => {
  let now = LIVE_LIKE_CLOCK().getTime();
  const environment = phoneEnvironment(() => new Date(now));
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  // The whole-turn deadline passes while the held planner call runs, so the turn's next planner call never starts.
  gate.beforeRelease = () => { now += 10 * 60 * 1000; };
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");

  const diagnosticsBefore = world.diagnostics.length;
  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  gate.release();
  await inFlight;
  assert.ok(world.diagnostics.slice(diagnosticsBefore).some((event) => event.stage === "turn_stop" && event.stopReason === "turn_deadline"), "the held turn stopped at its deadline");

  const next = await world.app.handleTurn(THREAD, PROPOSE_TEXT);
  assert.notEqual(codeOf(next), THREAD_BUSY_CODE, "the lock is free after a deadline stop");
});

test("two different threads do not block each other", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  world.app.getState(OTHER_THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search on the held thread");

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const other = await world.app.handleTurn(OTHER_THREAD, SEARCH_TEXT);
  assert.notEqual(codeOf(other), THREAD_BUSY_CODE, "a turn on another thread is not refused");
  successOf(other, "the other thread's search completes while this thread's turn is in flight");

  gate.release();
  successOf(await inFlight, "the held thread's turn completes");
});

test("read-only calls are never refused while a turn is in flight", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const state: GuestStateSnapshot | undefined = world.app.getState(THREAD);
  assert.ok(state, "getState answers while the turn runs");
  assert.equal(state.ok, true, "the snapshot is not refused");
  assert.ok(Array.isArray(world.runtime.getTaskRail(THREAD)), "the task rail is readable while the turn runs");

  gate.release();
  successOf(await inFlight, "the held turn completes");
});

test("a refused busy turn writes exactly one turn record, and no turn_stop reaches the running turn", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");
  const recordsBefore = world.records.length;
  const stopsBefore = world.diagnostics.filter((event) => event.stage === "turn_stop").length;

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  assert.equal(codeOf(await world.app.handleTurn(THREAD, PROPOSE_TEXT)), THREAD_BUSY_CODE);

  assert.equal(world.records.length, recordsBefore + 1, "the refused turn writes one record while the held turn is still running");
  const refusedRecord = world.records.at(-1);
  assert.equal(refusedRecord?.["error.type"], THREAD_BUSY_CODE, "the refusal is recorded with its closed code");
  assert.equal("assistant.stop_reason" in (refusedRecord ?? {}), false, "the refused turn has no stop reason");
  assert.equal(world.diagnostics.filter((event) => event.stage === "turn_stop").length, stopsBefore, "the refusal emits no turn_stop");

  gate.release();
  successOf(await inFlight, "the held turn completes");
  assert.equal(world.records.length, recordsBefore + 2, "the held turn writes its own single record when it ends");
  assert.equal(world.diagnostics.filter((event) => event.stage === "turn_stop").length, stopsBefore + 1, "exactly one turn_stop, from the held turn");
});

test("a stale clone cannot restore an executed pending action, whatever the commit order (seeded interleavings)", async () => {
  const environment = phoneEnvironment();
  const world = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  await proposeOn(world, THREAD);
  const base = world.runtime.getThread(THREAD);
  const open = base.taskState.pendingAction;
  assert.ok(open, "a proposal is open before the interleavings");

  let seed = 20261027;
  const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let run = 0; run < 200; run++) {
    base.taskState.pendingAction = { ...open };
    const stale = new TurnTransaction(base);
    const confirm = new TurnTransaction(base);
    confirm.clearPendingAction();
    confirm.supersede("pending_action");
    const staleFirst = next() % 2 === 0;
    const commitStale = () => stale.commit(base, { state: true, tasks: false, discovery: false, lastSurfaces: stale.lastSurfaces });
    const commitConfirm = () => confirm.commit(base, { state: true, tasks: false, discovery: false, lastSurfaces: confirm.lastSurfaces });
    if (staleFirst) { commitStale(); commitConfirm(); } else { commitConfirm(); commitStale(); }
    assert.equal(base.taskState.pendingAction, null, `run ${run}: the executed proposal is not restored by a stale clone`);
    assert.equal(base.activeSurfaces.has("pending_action"), false, `run ${run}: its card is not re-armed`);
  }
});

test("a restore or a stay edit that lands during a run changes nothing, and the run commits its own delta", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = gatedModel(journeyScriptedModel(lockDefinition(THREAD)), HELD_TEXT);
  const world = worldOver(environment, model);
  const card = await proposeOn(world, THREAD);
  const confirm = confirmEventFor(world, THREAD, card);
  const stayBefore = JSON.stringify(world.runtime.getThread(THREAD).taskState.stayIntent);

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const restored = world.runtime.restoreShortletState(THREAD, {
    principalId: environment.guestPrincipal().id,
    tenantId: environment.config.tenantId,
    taskState: { goal: null, stayIntent: {}, shortlist: [], pendingAction: null },
    canonicalUserFacts: [],
  });
  assert.equal(restored, false, "a restore is refused while the run is in flight");
  assert.equal(world.runtime.recordGuestStay(THREAD, { nights: 9 }), false, "a stay edit is refused while the run is in flight");
  assert.equal(JSON.stringify(world.runtime.getThread(THREAD).taskState.stayIntent), stayBefore, "the stay is unchanged while the run is in flight");
  assert.equal(codeOf(await world.app.handleEventAsync(THREAD, confirm)), THREAD_BUSY_CODE, "the confirm is still refused");

  gate.release();
  successOf(await inFlight, "the held turn completes");
  assert.notEqual(pendingId(world, THREAD), undefined, "the proposal survives the refused restore");
  assert.equal(JSON.stringify(world.runtime.getThread(THREAD).taskState.stayIntent), stayBefore, "the run's commit leaves the stay as it was");
});

test("a cold restore keeps the shortlist, the open card, the pending confirmation and the task rail, but not conversation history", async () => {
  const environment = phoneEnvironment();
  const first = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  await proposeOn(first, THREAD);
  const before = first.runtime.getThread(THREAD);
  assert.ok(before.taskState.shortlist.length > 0, "the search filled the shortlist");

  // A new application and runtime over the same store, as a cold restore before the guest's next request.
  const restored = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  const state = restored.app.getState(THREAD);
  assert.ok(state, "the thread is readable after the cold restore");
  assert.equal(restored.runtime.getThread(THREAD).taskState.shortlist.length, before.taskState.shortlist.length, "the shortlist is restored");
  assert.ok(state.surfaces.some((surface) => /:pending-action:/.test(surface.surfaceId)), "the open card is restored");
  assert.equal(restored.runtime.getThread(THREAD).taskState.pendingAction?.id, before.taskState.pendingAction?.id, "the pending confirmation is restored");
  assert.ok((state.tasks ?? []).length > 0, "the task rail is restored");
  assert.equal(restored.runtime.getThread(THREAD).conversationHistory.length, 0, "the model's conversation history is not restored");
});

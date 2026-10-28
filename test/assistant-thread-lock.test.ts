import assert from "node:assert/strict";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import type { GuestStateSnapshot } from "../apps/local-guest/src/shortlet-app.js";
import { TurnTransaction } from "../apps/local-guest/src/assistant/assistant-turn-transaction.js";
import { THREAD_BUSY_CODE } from "../apps/local-guest/src/assistant/assistant-thread-lock.js";
import { PENDING_ACTION_STAGE } from "../apps/local-guest/src/assistant/assistant-stage-handler.js";
import { journeyScriptedModel } from "./helpers/assistant-recordings.js";
import { LIVE_LIKE_CLOCK, firstButtonAction } from "./helpers/guest-date-fixtures.js";
import {
  HELD_TEXT,
  PROPOSE_TEXT,
  SEARCH_TEXT,
  THREAD,
  codeOf,
  confirmEventFor,
  lockDefinition,
  lockModel,
  pendingId,
  phoneEnvironment,
  proposeOn,
  sampleProposal,
  checkoutActionOn,
  checkoutWorld,
  coldCheckoutApp,
  reachCheckout,
  successOf,
  worldOver,
} from "./helpers/assistant-thread-lock-fixtures.js";

// Issue 06 (ADR 0070): one mutating run per thread, a closed THREAD_BUSY refusal, and task-state commits that cannot restore an
// executed proposal. Staging-like clock (27 Oct 2026), assistant enabled, a guest with a phone (so a Booking Request confirms).
// Every event here goes to the SAME application and runtime, as one tenant's runtime serves its in-flight run and the next request.
// Session-level behaviour (per-session runtimes, eviction) is in test/assistant-session-thread-lock.test.ts.

const OTHER_THREAD = "g-d1a0000602";
const PROBE_THREAD = "g-d1a0000603";
const PENDING = PENDING_ACTION_STAGE;

/** The open proposal id a thread holds now (a function, so TypeScript does not keep the narrowing of an earlier assignment). */
function pendingIdOf(thread: { readonly taskState: { readonly pendingAction?: { readonly id: string } | null } }): string | undefined {
  return thread.taskState.pendingAction?.id;
}

test("a confirm that lands while a typed turn is in flight is refused with THREAD_BUSY and the proposal stays open", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
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
  const { model, gate } = lockModel();
  const world = worldOver(environment, model);
  const card = await proposeOn(world, THREAD);
  const confirm = confirmEventFor(world, THREAD, card);

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  const direct = world.runtime.handleAssistantEvent(THREAD, confirm.name, confirm.context);
  assert.equal(direct.ok, false, "the runtime refuses the confirm");
  assert.equal(direct.ok ? undefined : direct.code, THREAD_BUSY_CODE, "the refusal is THREAD_BUSY");
  assert.notEqual(pendingId(world, THREAD), undefined, "the proposal is not executed by the refused event");

  gate.release();
  successOf(await inFlight, "the held turn completes");
});

test("a confirm that lands before a typed turn starts cannot be undone by that turn's later commit", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
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
  const { model, gate } = lockModel();
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

test("a shell event that starts before a run and resumes during it is refused after its await", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");
  const search = world.app.getState(THREAD);
  assert.ok(search, "the search is readable");
  const view = firstButtonAction(search.surfaces[0]!);

  // The turn suspends on its own hydrate await before it takes the lock. The event starts while the thread is still free, so its
  // synchronous check passes and it suspends on its own await. The turn then takes the lock and reaches the held planner call. Only
  // the recheck after the event's await can refuse the event, so this test exercises that recheck.
  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  const event = world.app.handleEventAsync(THREAD, view);
  await gate.reached;
  assert.equal(world.runtime.threadBusy(THREAD), true, "the typed turn holds the lock while the event is suspended");
  const eventResult = await event;
  assert.equal(codeOf(eventResult), THREAD_BUSY_CODE, "the event that resumes during the run is refused by the recheck after its await");
  gate.release();
  successOf(await inFlight, "the held turn completes");
});

test("a shell event with no await in flight is refused at its own check when a run is already held", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");
  const search = world.app.getState(THREAD);
  assert.ok(search, "the search is readable");
  const view = firstButtonAction(search.surfaces[0]!);

  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  assert.equal(codeOf(await world.app.handleEventAsync(THREAD, view)), THREAD_BUSY_CODE, "a new shell event is refused at once");
  gate.release();
  successOf(await inFlight, "the held turn completes");
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
  if (!yes.threw) {
    assert.equal(yes.result.ok, false, "the domain refusal is a closed refusal");
    assert.equal(yes.result.ok ? undefined : yes.result.code, "STALE_SURFACE", "a domain refusal is reported as a stale proposal");
  }
  assert.equal(pendingId(world, THREAD), undefined, "the refused proposal is dropped, so a later Yes cannot retry it");
});

test("a non-domain throw after a side effect is not reported as STALE_SURFACE, and the proposal is dropped", async () => {
  const environment = phoneEnvironment();
  const world = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  await proposeOn(world, THREAD);
  // The draft is created, then the disclosure fails for a reason that is not a domain refusal.
  world.environment.bookingRequestApp.disclose = () => { throw new TypeError("disclosure store unavailable"); };

  const yes = await world.app.handleTurn(THREAD, "Yes").then(
    (result) => ({ threw: false as const, result }),
    (error: unknown) => ({ threw: true as const, error }),
  );
  assert.equal(yes.threw, false, "the failure does not throw out of the turn");
  if (!yes.threw) {
    assert.equal(yes.result.ok, false, "the failure is a closed refusal");
    assert.equal(yes.result.ok ? undefined : yes.result.code, "CONCIERGE_UNAVAILABLE", "the failure is the closed unavailable code, not a stale proposal");
  }
  assert.equal(pendingId(world, THREAD), undefined, "the proposal is dropped, so a later Yes cannot create a second request");
});

test("a non-domain confirm throw on the event path returns the closed unavailable code, drops the proposal and is not reported as stale", async () => {
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(THREAD)));
  const card = await proposeOn(world, THREAD);
  world.environment.bookingRequestApp.disclose = () => { throw new TypeError("disclosure store unavailable"); };
  const confirm = confirmEventFor(world, THREAD, card);

  const result = world.runtime.handleAssistantEvent(THREAD, confirm.name, confirm.context);
  assert.equal(result.ok, false, "the failed confirm is a refusal, not a throw");
  assert.equal(result.ok ? undefined : result.code, "CONCIERGE_UNAVAILABLE", "the event reports the closed unavailable code");
  assert.equal(pendingId(world, THREAD), undefined, "the proposal is dropped and the drop is committed");
});

test("an absent proposal field and a null one are the same empty base, so a run that opened nothing keeps another run's proposal", async () => {
  const open = await sampleProposal();
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);
  delete (thread.taskState as { pendingAction?: unknown }).pendingAction;

  const candidate = new TurnTransaction(thread);
  const other = new TurnTransaction(thread);
  other.taskState.pendingAction = { ...open };
  other.place(PENDING, `thread-${PROBE_THREAD}:pending-action:${open.id}`);
  other.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: other.lastSurfaces });

  candidate.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: candidate.lastSurfaces });
  assert.equal(pendingIdOf(thread), open.id, "the proposal survives a candidate whose base was an absent field");
});

test("THREAD_BUSY clears after the run ends, including a run that threw inside the planner (finally)", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
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
  const { model, gate } = lockModel();
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

test("a planner call that never resolves and ignores abort ends the turn, releases the lock, and writes one record", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
  gate.neverResolve = true;
  // A short whole-turn budget (the lower runtime bound), so the outer bound on a stuck call is reached in about a second.
  const world = worldOver(environment, model, { turnDeadlineMs: 1000 });
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");
  const recordsBefore = world.records.length;

  const timeout = new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 15_000));
  const stuck = await Promise.race([world.app.handleTurn(THREAD, HELD_TEXT).then(() => "returned" as const), timeout]);
  assert.equal(stuck, "returned", "the stuck turn returns instead of waiting for the provider");
  assert.equal(world.records.length, recordsBefore + 1, "the stuck turn writes exactly one record");
  assert.equal(world.runtime.threadBusy(THREAD), false, "the lock is released");

  const next = await world.app.handleTurn(THREAD, PROPOSE_TEXT);
  assert.notEqual(codeOf(next), THREAD_BUSY_CODE, "a later turn is accepted");
});

test("two different threads do not block each other", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
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

test("two runtimes over one shared database refuse each other, because the lock is keyed on the store and not the environment", async () => {
  const first = phoneEnvironment();
  // A second environment over the same store handle, as each browser session's environment is built (guest-server.ts).
  const second = new LocalGuestEnvironment({ ...first.config }, {
    database: first.database,
    unitRepository: first.unitRepository,
    guestData: first.guestData,
    guestDataIsRemote: first.guestDataIsRemote,
  });
  const { model, gate } = lockModel();
  const held = worldOver(first, model);
  const other = worldOver(second, journeyScriptedModel(lockDefinition(THREAD)));
  held.app.getState(THREAD);
  successOf(await held.app.handleTurn(THREAD, SEARCH_TEXT), "search");

  const inFlight = held.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  assert.equal(codeOf(await other.app.handleTurn(THREAD, PROPOSE_TEXT)), THREAD_BUSY_CODE, "a second runtime on the same store is refused");
  assert.equal(other.runtime.threadBusy(THREAD), true, "the other runtime sees the run in flight");

  gate.release();
  successOf(await inFlight, "the held turn completes");
});

test("read-only calls are never refused while a turn is in flight", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
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
  const { model, gate } = lockModel();
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

test("a shell run held across an external await refuses a typed turn, and releases when it finishes", async () => {
  const environment = phoneEnvironment();
  const world = worldOver(environment, journeyScriptedModel(lockDefinition(THREAD)));
  world.app.getState(THREAD);
  const release = world.runtime.beginShellRun(THREAD);
  assert.ok(release, "the shell run starts on a free thread");
  assert.equal(codeOf(await world.app.handleTurn(THREAD, SEARCH_TEXT)), THREAD_BUSY_CODE, "a typed turn is refused while the shell run is held");
  assert.equal(world.runtime.beginShellRun(THREAD), undefined, "a second shell run is refused");
  release?.();
  assert.equal(world.runtime.threadBusy(THREAD), false, "the shell run releases");
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "a typed turn is accepted after the shell run");
});

test("reset refuses while a run is in flight, so a fixture reset cannot drop a run's thread", async () => {
  const environment = phoneEnvironment();
  const { model, gate } = lockModel();
  const world = worldOver(environment, model);
  world.app.getState(THREAD);
  successOf(await world.app.handleTurn(THREAD, SEARCH_TEXT), "search");
  const inFlight = world.app.handleTurn(THREAD, HELD_TEXT);
  await gate.reached;
  assert.throws(() => world.runtime.reset(), /run is in flight/, "reset is refused during a run");
  gate.release();
  successOf(await inFlight, "the held turn completes");
  world.runtime.reset();
});

test("a stale clone cannot restore an executed pending action, whatever the commit order (seeded interleavings)", async () => {
  const open = await sampleProposal();
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);

  let seed = 20261027;
  const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let run = 0; run < 200; run++) {
    thread.taskState.pendingAction = { ...open };
    thread.activeSurfaces.set(PENDING, `thread-${PROBE_THREAD}:pending-action:${open.id}`);
    const stale = new TurnTransaction(thread);
    const confirm = new TurnTransaction(thread);
    confirm.clearPendingAction();
    confirm.supersede(PENDING);
    const commitStale = () => stale.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: stale.lastSurfaces });
    const commitConfirm = () => confirm.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: confirm.lastSurfaces });
    if (next() % 2 === 0) { commitStale(); commitConfirm(); } else { commitConfirm(); commitStale(); }
    assert.equal(thread.taskState.pendingAction, null, `run ${run}: the executed proposal is not restored by a stale clone`);
    assert.equal(thread.activeSurfaces.has(PENDING), false, `run ${run}: its card is not re-armed`);
  }
});

test("a candidate that started with no proposal does not overwrite a proposal another run opened", async () => {
  const open = await sampleProposal();
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);
  thread.taskState.pendingAction = null;
  thread.activeSurfaces.delete(PENDING);

  const candidate = new TurnTransaction(thread);
  const other = new TurnTransaction(thread);
  other.taskState.pendingAction = { ...open };
  other.place(PENDING, `thread-${PROBE_THREAD}:pending-action:${open.id}`);
  other.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: other.lastSurfaces });

  candidate.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: candidate.lastSurfaces });
  assert.equal(pendingIdOf(thread), open.id, "the proposal another run opened survives a candidate that never had one");
  assert.equal(thread.activeSurfaces.get(PENDING), `thread-${PROBE_THREAD}:pending-action:${open.id}`, "its card survives too");
});

test("a candidate that cleared one proposal does not overwrite a different proposal another run opened", async () => {
  const x = await sampleProposal();
  const y = { ...x, id: `${x.id}-y` };
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);
  thread.taskState.pendingAction = { ...x };

  const candidate = new TurnTransaction(thread);
  candidate.clearPendingAction();
  const other = new TurnTransaction(thread);
  other.clearPendingAction();
  other.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: other.lastSurfaces });
  const opener = new TurnTransaction(thread);
  opener.taskState.pendingAction = { ...y };
  opener.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: opener.lastSurfaces });

  candidate.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: candidate.lastSurfaces });
  assert.equal(thread.taskState.pendingAction?.id, y.id, "the new proposal survives a candidate that cleared the old one");
});

test("a proposal cleared by a run stays cleared when a stale candidate that still held it commits", async () => {
  const x = await sampleProposal();
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);
  thread.taskState.pendingAction = { ...x };

  const stale = new TurnTransaction(thread);
  const cleared = new TurnTransaction(thread);
  cleared.clearPendingAction();
  cleared.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: cleared.lastSurfaces });
  stale.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: stale.lastSurfaces });
  assert.equal(thread.taskState.pendingAction, null, "the executed proposal stays cleared");
});

test("randomised interleavings of turn, confirm, cancel and search never restore a closed proposal or change one a candidate did not touch (seeded)", async () => {
  const sample = await sampleProposal();
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition(PROBE_THREAD)));
  world.app.getState(PROBE_THREAD);
  const thread = world.runtime.getThread(PROBE_THREAD);
  let seed = 72_026_1027;
  const next = (modulus: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % modulus; };

  for (let run = 0; run < 300; run++) {
    let counter = 0;
    const propose = (): typeof sample => { counter += 1; return { ...sample, id: `pa-run${run}-${counter}` }; };
    thread.taskState.pendingAction = propose();
    thread.activeSurfaces.set(PENDING, `thread-${PROBE_THREAD}:pending-action:${thread.taskState.pendingAction!.id}`);
    const closed = new Set<string>();
    const pool: TurnTransaction[] = [];
    for (let step = 0; step < 40; step++) {
      const op = next(4);
      if (op === 0) {
        // A turn starts: its candidate is taken from the thread as it is now.
        pool.push(new TurnTransaction(thread));
      } else if (op === 1 && pool.length > 0) {
        // A stale candidate commits: it may keep its proposal, clear it, or (when it had none) open one.
        const [candidate] = pool.splice(next(pool.length), 1);
        const choice = next(3);
        const before = pendingIdOf(thread);
        let changed = false;
        if (choice === 1 && candidate!.taskState.pendingAction) {
          closed.add(candidate!.taskState.pendingAction.id);
          candidate!.clearPendingAction();
          changed = true;
        } else if (choice === 2 && candidate!.taskState.pendingAction === null) {
          candidate!.taskState.pendingAction = propose();
          changed = true;
        }
        candidate!.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: candidate!.lastSurfaces });
        if (!changed) assert.equal(thread.taskState.pendingAction?.id, before, `run ${run} step ${step}: a candidate that changed nothing leaves the proposal as it was`);
      } else if (op === 2) {
        // A confirm or cancel lands now: the open proposal is executed (or cancelled) and committed.
        const tx = new TurnTransaction(thread);
        if (tx.taskState.pendingAction) closed.add(tx.taskState.pendingAction.id);
        tx.clearPendingAction();
        tx.supersede(PENDING);
        tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: tx.lastSurfaces });
      } else if (op === 3) {
        // A search replaces the proposal: the old one is closed and a new one is opened.
        const tx = new TurnTransaction(thread);
        if (tx.taskState.pendingAction) closed.add(tx.taskState.pendingAction.id);
        tx.clearPendingAction();
        tx.taskState.pendingAction = propose();
        tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: tx.lastSurfaces });
      }
      const pendingNow = pendingIdOf(thread);
      assert.ok(pendingNow === undefined || pendingNow === null || !closed.has(pendingNow), `run ${run} step ${step}: a closed proposal is never restored`);
    }
  }
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

// Issue 06 (gap M12): the Paystack initialize-checkout path awaits the provider while it holds the thread's run. These drive that
// await with the provider call held open (the checkout world's gate), on the staging-like clock, with a cold restore before each event.

test("the Paystack checkout holds the thread's run across the provider call: a concurrent typed turn and event are refused THREAD_BUSY, then the lock releases after success", async () => {
  const world = checkoutWorld();
  const payment = await reachCheckout(world, THREAD);
  const checkout = checkoutActionOn(payment.surfaces[0]!);
  assert.ok(checkout, "the payment surface starts Paystack checkout");

  world.gate.armed = true;
  const holder = coldCheckoutApp(world, THREAD);
  const inFlight = holder.app.handleEventAsync(THREAD, checkout);
  await world.gate.reached;

  assert.equal(holder.runtime.threadBusy(THREAD), true, "the checkout holds the thread's run while the provider call is open");
  assert.equal(codeOf(await coldCheckoutApp(world, THREAD).app.handleTurn(THREAD, "Show me another one")), THREAD_BUSY_CODE, "a typed turn on another request is refused while checkout is held");
  assert.equal(codeOf(await coldCheckoutApp(world, THREAD).app.handleEventAsync(THREAD, checkout)), THREAD_BUSY_CODE, "a second checkout event is refused while checkout is held");

  world.gate.release();
  const done = successOf(await inFlight, "the held checkout completes");
  assert.match(done.surfaces[0]!.summary ?? "", /payment handoff/i, "the checkout opens the payment handoff");
  assert.equal(holder.runtime.threadBusy(THREAD), false, "the checkout releases the thread's run after success");

  // The lock is free: the same checkout event now reaches the handler, which reports the surface superseded, not THREAD_BUSY.
  const following = await coldCheckoutApp(world, THREAD).app.handleEventAsync(THREAD, checkout);
  assert.equal(codeOf(following), "STALE_SURFACE", "an event after the checkout reaches the handler, not the lock");
});

test("the Paystack checkout releases the thread's run when the provider call fails, so a following checkout event runs", async () => {
  const world = checkoutWorld();
  const payment = await reachCheckout(world, THREAD);
  const checkout = checkoutActionOn(payment.surfaces[0]!);
  assert.ok(checkout, "the payment surface starts Paystack checkout");

  world.gate.armed = true;
  world.gate.failOnRelease = new Error("the Paystack connection dropped");
  const holder = coldCheckoutApp(world, THREAD);
  const inFlight = holder.app.handleEventAsync(THREAD, checkout);
  await world.gate.reached;
  assert.equal(codeOf(await coldCheckoutApp(world, THREAD).app.handleTurn(THREAD, "Show me another one")), THREAD_BUSY_CODE, "a typed turn is refused while the failing provider call is open");

  world.gate.release();
  const failed = await inFlight;
  assert.equal(failed.ok, false, "a failed provider call is returned as a closed refusal, not thrown");
  assert.equal(holder.runtime.threadBusy(THREAD), false, "the failed checkout releases the thread's run");

  // The failed attempt superseded the ready surface, so the same event now reaches the handler and is answered STALE_SURFACE. That
  // proves it ran past the lock; a THREAD_BUSY here would mean the failed checkout kept the run.
  const following = await coldCheckoutApp(world, THREAD).app.handleEventAsync(THREAD, checkout);
  assert.equal(codeOf(following), "STALE_SURFACE", "a following event reaches the handler after the failed checkout, not the lock");
  assert.equal(coldCheckoutApp(world, THREAD).runtime.threadBusy(THREAD), false, "no run is left holding the thread");
});

// Issue 06 (M13): the provider await is bounded. A Paystack call that never resolves and ignores its abort ends the event with the
// closed refusal after the bound, releases the run, and lets the next typed turn and event through. The bound is injected
// (paystackCheckoutTimeoutMs), so the timeout is observed without real waiting. The node timeout only bounds a regression.

const SHORT_CHECKOUT_BOUND_MS = 20;
const REGRESSION_GUARD_MS = 15_000;

test("a Paystack checkout whose provider call never resolves is refused with the closed copy after the bound, and releases the run", { timeout: REGRESSION_GUARD_MS }, async () => {
  const world = checkoutWorld();
  const payment = await reachCheckout(world, THREAD);
  const checkout = checkoutActionOn(payment.surfaces[0]!);
  assert.ok(checkout, "the payment surface starts Paystack checkout");

  world.gate.armed = true;
  world.gate.neverResolve = true;
  const holder = coldCheckoutApp(world, THREAD, { paystackCheckoutTimeoutMs: SHORT_CHECKOUT_BOUND_MS });
  const refused = await holder.app.handleEventAsync(THREAD, checkout);
  assert.equal(refused.ok, false, "a provider call that never resolves ends the event at the bound, not with a success");
  assert.equal(codeOf(refused), "ACTION_NOT_AUTHORIZED", "the timed-out checkout returns the existing closed refusal");
  assert.equal(refused.ok ? undefined : refused.message, "The secure card checkout could not be started.", "the refusal reuses the existing copy");
  assert.equal(holder.runtime.threadBusy(THREAD), false, "the timed-out checkout releases the thread's run");

  // The lock is free: a typed turn and the same event reach their handlers, not THREAD_BUSY.
  const bounded = { paystackCheckoutTimeoutMs: SHORT_CHECKOUT_BOUND_MS };
  assert.notEqual(codeOf(await coldCheckoutApp(world, THREAD, bounded).app.handleTurn(THREAD, "Show me another one")), THREAD_BUSY_CODE, "a typed turn after the timed-out checkout is not refused as busy");
  assert.equal(codeOf(await coldCheckoutApp(world, THREAD, bounded).app.handleEventAsync(THREAD, checkout)), "STALE_SURFACE", "a following event reaches its handler after the timed-out checkout, not the lock");
});

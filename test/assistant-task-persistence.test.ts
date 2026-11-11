import assert from "node:assert/strict";
import test from "node:test";
import { datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { SCRIPT, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT, type AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import type { AssistantTaskRailEntry, TaskRestoreRefusal } from "../apps/local-guest/src/assistant/assistant-runtime.js";

// Issue 03b (ADR 0106 cold restore before every event, ADR 0107 decisions 2 and 11, ADR 0075 and 0093 minimal projection,
// ADR 0074 fail-closed ids). Every event goes to a NEW application over the same store, on a fresh thread, on the staging-like
// clock (27 Oct 2026), with the assistant runtime enabled and a guest with no seeded phone or email.

const THREAD = "g-b03b0001";
const OTHER_THREAD = "g-b03b0002";
const SHOP = createFakeShopPack();

interface StoredTask { readonly taskId: string; readonly domain: string }

/** The shared fixture for this file: the runtime is enabled with the stays pack and the given extra packs. */
function openFixture(packs: readonly AssistantDomainPack[] = [SHOP]): DatedFixture {
  return datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, additionalPacks: packs });
}

/** A new application over the same store with the given packs, loaded as a page load does before the event is sent. */
function coldApp(f: DatedFixture, threadId: string, packs: readonly AssistantDomainPack[] = [SHOP]) {
  const restored = restartedDatedApp(f, scriptedPlanner({}).client, undefined, packs);
  restored.app.getState(threadId);
  return restored;
}

function taskEvent(threadId: string, name: string, context: Readonly<Record<string, unknown>>) {
  return { name, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: "2026-10-27T10:00:00.000Z", context: { ...context } };
}

/** Starts the shop task on a fresh thread, cold-restored first. */
async function startShop(f: DatedFixture, threadId: string, packs: readonly AssistantDomainPack[] = [SHOP]) {
  return successOf(await coldApp(f, threadId, packs).app.handleEventAsync(threadId, taskEvent(threadId, TASK_START_EVENT, { domain: "shop" })), "start the shop task");
}

function storedRecord(f: DatedFixture, threadId: string) {
  const record = f.environment.interactionStore.findThread(threadId);
  assert.ok(record, "the thread is stored");
  return record;
}

function storedProjection(f: DatedFixture, threadId: string): Record<string, unknown> {
  return JSON.parse(storedRecord(f, threadId).threadJson) as Record<string, unknown>;
}

/** Rewrites the stored projection in place, as a tampered or legacy store would hold it. */
function rewriteStored(f: DatedFixture, threadId: string, mutate: (projection: Record<string, unknown>) => void): void {
  const record = storedRecord(f, threadId);
  const projection = JSON.parse(record.threadJson) as Record<string, unknown>;
  mutate(projection);
  f.environment.interactionStore.saveThread({ ...record, threadJson: JSON.stringify(projection) });
}

function storedTasks(f: DatedFixture, threadId: string): { readonly activeTaskId: string; readonly tasks: readonly StoredTask[] } {
  const projection = storedProjection(f, threadId);
  assert.equal(typeof projection.activeTaskId, "string", "the stored projection names the active task");
  assert.ok(Array.isArray(projection.tasks), "the stored projection lists the tasks");
  return { activeTaskId: projection.activeTaskId as string, tasks: projection.tasks as StoredTask[] };
}

function activeRailEntry(entries: readonly AssistantTaskRailEntry[]): AssistantTaskRailEntry | undefined {
  return entries.find((entry) => entry.active);
}

test("AC1: The stored projection holds activeTaskId and tasks with taskId and domain only; the stored JSON has no state, timeline or conversationHistory under a task.", async () => {
  const f = openFixture();
  try {
    const started = await startShop(f, THREAD);
    const active = activeRailEntry(started.tasks ?? []);
    assert.equal(active?.domain, "shop");

    const { activeTaskId, tasks } = storedTasks(f, THREAD);
    assert.equal(activeTaskId, active?.taskId, "the stored active id is the shop task the guest holds");
    assert.ok(tasks.some((task) => task.taskId === activeTaskId && task.domain === "shop"));
    for (const task of tasks) assert.deepEqual(Object.keys(task).sort(), ["domain", "taskId"], "a stored task holds an id and a domain only");
    assert.doesNotMatch(JSON.stringify(tasks), /"(state|timeline|conversationHistory|items)"/, "no task state, timeline or history is stored");
  } finally { f.close(); }
});

test("AC2: With the fake shop task active, a cold restore (new LocalGuestApp over the same store) leaves the shop task active.", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const restored = coldApp(f, THREAD);
    assert.equal(activeRailEntry(restored.runtime.getTaskRail(THREAD))?.domain, "shop", "the shop task is active after the cold restore");
    assert.equal(restored.runtime.getTaskRail(THREAD).length, 2, "the stays task and the shop task are both restored");
  } finally { f.close(); }
});

test("AC3: A legacy stored blob with neither activeTaskId nor tasks restores to one shortlet task, active.", async () => {
  const f = openFixture();
  try {
    successOf(await f.app.handleTurn(THREAD, STAY_TEXT), "search on a stays thread");
    rewriteStored(f, THREAD, (projection) => {
      delete projection.activeTaskId;
      delete projection.tasks;
    });
    assert.equal("tasks" in storedProjection(f, THREAD), false, "the blob is a legacy blob with neither field");

    const restored = coldApp(f, THREAD);
    const rail = restored.runtime.getTaskRail(THREAD);
    assert.equal(rail.length, 1, "one task is restored");
    assert.equal(rail[0]?.domain, "shortlet", "the task is the stays task");
    assert.equal(rail[0]?.active, true, "the stays task is active");
    assert.equal(rail[0]?.taskId, "task-1", "the legacy task keeps the id a new thread starts with");
  } finally { f.close(); }
});

test("AC4: A cold restore keeps the persisted taskId unchanged; it does not mint a new id.", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const persistedId = storedTasks(f, THREAD).activeTaskId;
    const first = activeRailEntry(coldApp(f, THREAD).runtime.getTaskRail(THREAD));
    const second = activeRailEntry(coldApp(f, THREAD).runtime.getTaskRail(THREAD));
    assert.equal(first?.taskId, persistedId, "the first cold restore keeps the persisted id");
    assert.equal(second?.taskId, persistedId, "a second cold restore keeps the persisted id");
    assert.equal(storedTasks(f, THREAD).activeTaskId, persistedId, "the store still holds the same id");
  } finally { f.close(); }
});

test("AC5: A stored activeTaskId that is not in tasks is ignored: no task is created, and the stays progress is restored as a legacy blob is (owner decision, 12 Nov 2026).", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const { tasks } = storedTasks(f, THREAD);
    rewriteStored(f, THREAD, (projection) => { projection.activeTaskId = "task-missing"; });

    const restored = coldApp(f, THREAD);
    assert.equal(restored.runtime.taskListRefusal(tasks, "task-missing"), "INVALID_TASK_LIST", "the list names no active task");
    // This shop-only thread holds no stays progress, so it restores as a legacy blob without stays context does: not at all.
    assert.equal(restored.runtime.hasThread(THREAD), false, "no partial restore of the list");
    assert.deepEqual(restored.runtime.getTaskRail(THREAD), [], "no task is created");
  } finally { f.close(); }
});

test("AC6: A stored task whose domain is not registered is ignored with UNKNOWN_DOMAIN: no unregistered task is created (owner decision, 12 Nov 2026).", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const { activeTaskId, tasks } = storedTasks(f, THREAD);

    // The restart composes no shop pack, so the shop task's domain is unregistered on this host.
    const restored = coldApp(f, THREAD, []);
    assert.equal(restored.runtime.taskListRefusal(tasks, activeTaskId), "UNKNOWN_DOMAIN");
    assert.equal(restored.runtime.hasThread(THREAD), false, "no partial restore of the list");
    assert.deepEqual(restored.runtime.getTaskRail(THREAD), []);
  } finally { f.close(); }
});

test("AC7: A malformed tasks list (non-string id, extra key, array instead of object) rejects the projection, as an invalid projection is rejected today.", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const valid = storedRecord(f, THREAD).threadJson;
    const malformed: readonly { readonly label: string; readonly tasks: unknown }[] = [
      { label: "a non-string id", tasks: [{ taskId: 7, domain: "shop" }] },
      { label: "an extra key", tasks: [{ taskId: storedTasks(f, THREAD).activeTaskId, domain: "shop", state: { items: [] } }] },
      { label: "an array instead of an object", tasks: [["task-x", "shop"]] },
    ];
    for (const { label, tasks } of malformed) {
      f.environment.interactionStore.saveThread({ ...storedRecord(f, THREAD), threadJson: JSON.stringify({ ...JSON.parse(valid) as Record<string, unknown>, tasks }) });
      assert.equal(coldApp(f, THREAD).app.getState(THREAD), undefined, `a tasks list with ${label} is not restored`);
    }
  } finally { f.close(); }
});

test("AC8: A client platform.task.switch naming a task id from another thread returns UNKNOWN_TASK after a cold restore.", async () => {
  const f = openFixture();
  try {
    await startShop(f, THREAD);
    const ownTaskId = storedTasks(f, THREAD).activeTaskId;
    await startShop(f, OTHER_THREAD);
    const otherTaskId = storedTasks(f, OTHER_THREAD).activeTaskId;
    assert.notEqual(otherTaskId, ownTaskId);

    const result = await coldApp(f, THREAD).app.handleEventAsync(THREAD, taskEvent(THREAD, TASK_SWITCH_EVENT, { taskId: otherTaskId }));
    assert.equal(result.ok, false, "the switch is refused");
    assert.equal(result.ok ? "" : result.code, "UNKNOWN_TASK");
    assert.equal(activeRailEntry(coldApp(f, THREAD).runtime.getTaskRail(THREAD))?.taskId, ownTaskId, "the thread keeps its own active task");
  } finally { f.close(); }
});

test("a restore that cannot parse its state creates no task", async () => {
  // The pack's own initial state does not parse under its parseState, so the restore is refused whole (ADR 0075, fail closed).
  const unparseable: AssistantDomainPack = { ...createFakeShopPack(), initialState: () => ({ unparseable: true }) };
  const f = openFixture([unparseable]);
  try {
    await startShop(f, THREAD, [unparseable]);
    const { activeTaskId, tasks } = storedTasks(f, THREAD);

    const restored = coldApp(f, THREAD, [unparseable]);
    const refusal: TaskRestoreRefusal | undefined = restored.runtime.taskListRefusal(tasks, activeTaskId);
    assert.equal(refusal, "UNPARSEABLE_STATE");
    assert.equal(restored.runtime.hasThread(THREAD), false, "the thread is not restored");
    assert.deepEqual(restored.runtime.getTaskRail(THREAD), [], "no task is created");
  } finally { f.close(); }
});

// Owner decision (12 Nov 2026): an invalid persisted task list is ignored and the thread restores as a legacy blob does. The stays
// progress (search, shortlist, unit view) survives the cold restore, no unknown or invalid task is created, and one closed
// diagnostic records the refusal (ADR 0075: no ids, text or tokens in it).
const INVALID_LISTS: readonly { readonly label: string; readonly reason: string; readonly mutate: (projection: Record<string, unknown>) => void }[] = [
  { label: "no active task", reason: "INVALID_TASK_LIST", mutate: (projection) => { projection.activeTaskId = "task-missing"; } },
  { label: "a repeated domain", reason: "INVALID_TASK_LIST", mutate: (projection) => { projection.tasks = [{ taskId: "task-1", domain: "shortlet" }, { taskId: "task-dup", domain: "shortlet" }]; } },
  { label: "an unregistered domain", reason: "UNKNOWN_DOMAIN", mutate: (projection) => { projection.tasks = [{ taskId: "task-1", domain: "shortlet" }, { taskId: "task-ghost", domain: "ghost" }]; } },
];

test("an invalid persisted task list leaves the stays progress intact after a cold restore, creates no task, and records one closed diagnostic", async () => {
  const f = openFixture();
  const events: object[] = [];
  const telemetry = f.environment.telemetry as { track(event: object): void };
  const originalTrack = telemetry.track.bind(telemetry);
  telemetry.track = (event: object) => { events.push(event); originalTrack(event); };
  try {
    for (const [index, invalid] of INVALID_LISTS.entries()) {
      const threadId = `g-b03b010${index + 1}`;
      const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), `search (${invalid.label})`);
      rewriteStored(f, threadId, invalid.mutate);
      events.length = 0;

      const restored = coldApp(f, threadId);
      const rail = restored.runtime.getTaskRail(threadId);
      assert.deepEqual(rail.map((entry) => [entry.taskId, entry.domain, entry.active]), [["task-1", "shortlet", true]], `${invalid.label}: only the stays task is restored, active`);
      assert.ok((restored.runtime.getThread(threadId).taskState.shortlist.length ?? 0) > 0, `${invalid.label}: the shortlist survives the restore`);

      const refusals = events.filter((event) => (event as { type?: unknown }).type === "assistant.task.restore.refused.v1");
      assert.deepEqual(refusals.map((event) => (event as { reason?: unknown }).reason), [invalid.reason], `${invalid.label}: one closed diagnostic with the closed reason`);
      const diagnostic = JSON.stringify(refusals);
      for (const forbidden of [threadId, "task-missing", "task-dup", "task-ghost", STAY_TEXT]) assert.equal(diagnostic.includes(forbidden), false, `${invalid.label}: the diagnostic carries no ids or text`);

      // The guest keeps going after the cold restore: the search's unit view still opens (cold restore before the event).
      const detail = await tap(f, threadId, search.surfaces[0]!, `View after ${invalid.label}`);
      assert.match(detail.surfaces[0]!.surfaceId, /:unit:detail:/, `${invalid.label}: the stays progress still answers a guest event`);
    }
  } finally {
    telemetry.track = originalTrack;
    f.close();
  }
});

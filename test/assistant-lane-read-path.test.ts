import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { PHONE, SCRIPT, STAY_TEXT, coldApp, successOf as successOfJourney, tap } from "./helpers/assistant-cold-journey-harness.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, STAGING_GUEST_CONFIG } from "./helpers/guest-date-fixtures.js";
import { readLaneRows, type StoredLaneRow } from "./helpers/lane-event-fixtures.js";
import { coldModeApp, rewriteStoredProjection, type ColdModeApp } from "./helpers/mode-follows-task-harness.js";
import {
  SHOP_PRICE_TEXT,
  SHOP_TEXT,
  cold,
  deleteLaneRows,
  insertLaneRow,
  laneModel,
  recordDiagnostics,
  refusalReasons,
  relaxLaneTable,
  startShopEvent,
  successOf,
  taskEvent,
  withRawDatabase,
} from "./helpers/lane-read-harness.js";
import { TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type GuestTimelineEntry } from "../apps/local-guest/src/shortlet-app.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";

// Issue 03h (ADR 0107 decision 11, ADR 0106 cold restore, ADR 0075, ADR 0079, owner decisions 1 to 4). The lane read path: a cold
// restore reads the active lane's rows; a switch loads the target lane's rows; a lane whose rows fail a check is refused alone; the
// legacy projection timelines are migrated once. Every event runs on a NEW application over the same store (a cold restore), on a
// fresh thread, with the assistant runtime enabled, the staging-like clock (27 Oct 2026) and a guest with no seeded phone or email.

const CAP_FOUR = 4;

/** A cold restore that records its diagnostics. The timeline and the closed diagnostics come back; the application is closed. */
function restoreWithDiagnostics(path: string, threadId: string, options: { readonly laneTimelineCap?: number } = {}): { readonly timeline: readonly GuestTimelineEntry[]; readonly events: object[] } {
  const app: ColdModeApp = coldModeApp(path, laneModel(), options);
  try {
    const events = recordDiagnostics(app);
    const timeline = app.app.getState(threadId)?.timeline ?? [];
    return { timeline, events };
  } finally {
    app.close();
  }
}

/** The lane's rows as the restore must read them: oldest first, by seq. Only the tests read the table directly (AC9). */
function laneRows(path: string, threadId: string, taskId: string): StoredLaneRow[] {
  return readLaneRows(path, threadId).filter((row) => row.taskId === taskId).sort((left, right) => left.seq - right.seq);
}

function asTimeline(rows: readonly StoredLaneRow[]): GuestTimelineEntry[] {
  return rows.map((row) => ({ role: row.role as GuestTimelineEntry["role"], text: row.textRedacted }));
}

/** The stored projection as a JSON object (the thread row, read as a test). */
function storedProjection(path: string, threadId: string): Record<string, unknown> {
  return withRawDatabase(path, (database) => {
    const row = database.prepare("SELECT thread_json FROM guest_threads WHERE thread_id = $threadId").get({ $threadId: threadId });
    assert.ok(row && typeof row.thread_json === "string", "the thread is stored");
    return JSON.parse(row.thread_json) as Record<string, unknown>;
  });
}

/** Builds a thread with a stays lane and a shop lane, the shop lane active, with at least one shop turn. */
async function stayAndShopThread(path: string, threadId: string, options: { readonly laneTimelineCap?: number } = {}): Promise<{ readonly staysId: string; readonly shopId: string }> {
  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, STAY_TEXT), options), "stays search");
  const staysId = await cold(path, threadId, (app) => app.runtime.activeTaskIdFor(threadId) ?? "", options);
  successOf(await cold(path, threadId, (app) => app.app.handleEventAsync(threadId, startShopEvent(threadId)), options), "start the shop task");
  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, SHOP_TEXT), options), "a shop turn");
  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, SHOP_PRICE_TEXT), options), "a second shop turn");
  const shopId = await cold(path, threadId, (app) => app.runtime.activeTaskIdFor(threadId) ?? "", options);
  assert.notEqual(shopId, staysId, "the shop task has its own lane");
  return { staysId, shopId };
}

/** Switches the thread to the given task (a server TASK_SWITCH_EVENT on a cold request) and returns that request's active timeline. */
async function switchTo(path: string, threadId: string, taskId: string, options: { readonly laneTimelineCap?: number } = {}): Promise<readonly GuestTimelineEntry[]> {
  return cold(path, threadId, async (app) => {
    successOf(await app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId })), "switch task");
    return app.app.getState(threadId)?.timeline ?? [];
  }, options);
}

test("AC1: A cold restore loads the active lane's timeline from its rows in seq order, and the stored projection carries no timeline or lanes", async () => {
  const path = temporaryDatabasePath("lane-read-ac1.sqlite");
  const threadId = "g-03b00001";
  const { shopId } = await stayAndShopThread(path, threadId);

  const rows = laneRows(path, threadId, shopId);
  assert.ok(rows.length >= 2, "the shop lane holds rows");
  assert.deepEqual(rows.map((row) => row.seq), rows.map((_, index) => index + 1), "the rows run 1..n");
  const restored = restoreWithDiagnostics(path, threadId).timeline;
  assert.deepEqual(restored, asTimeline(rows), "the restored active lane is its rows, in seq order");

  const projection = storedProjection(path, threadId);
  assert.deepEqual(projection.timeline, [], "the projection carries no timeline");
  assert.equal("lanes" in projection, false, "the projection carries no lanes");
});

test("AC2: A lane whose rows have a seq gap is refused alone, restores empty, and its diagnostic names no task id", async () => {
  const path = temporaryDatabasePath("lane-read-ac2.sqlite");
  const threadId = "g-03b00002";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);
  const staysRows = laneRows(path, threadId, staysId);
  assert.ok(staysRows.length >= 1, "the stays lane holds rows");
  const shopRows = laneRows(path, threadId, shopId);
  assert.ok(shopRows.length >= 3, "the shop lane holds at least three rows");

  withRawDatabase(path, (database) => {
    database.prepare("DELETE FROM guest_thread_lane_events WHERE thread_id = $threadId AND task_id = $taskId AND seq = 2").run({ $threadId: threadId, $taskId: shopId });
  });

  const shop = restoreWithDiagnostics(path, threadId);
  assert.deepEqual(shop.timeline, [], "the gapped lane restores empty");
  assert.deepEqual(refusalReasons(shop.events), ["LANE_SEQUENCE_GAP"], "one closed diagnostic with the closed reason");
  const diagnostic = JSON.stringify(shop.events);
  assert.equal(diagnostic.includes(shopId) || diagnostic.includes(threadId) || diagnostic.includes(staysId), false, "the diagnostic names no task or thread id");
  assert.equal(shopRows.some((row) => diagnostic.includes(row.textRedacted)), false, "the diagnostic carries no lane text");

  // The other lane is kept: switching to the stays task restores its rows.
  assert.deepEqual(await switchTo(path, threadId, staysId), asTimeline(staysRows), "the stays lane still restores from its rows");
});

test("AC3: A lane whose rows repeat a (task_id, seq) pair is refused alone (fail closed); the other lanes still restore", async () => {
  const path = temporaryDatabasePath("lane-read-ac3.sqlite");
  const threadId = "g-03b00003";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);
  const staysRows = laneRows(path, threadId, staysId);
  const shopRows = laneRows(path, threadId, shopId);

  // The table's UNIQUE (thread_id, task_id, seq) is the database's guard. A copy without it stores the repeated pair this check refuses.
  relaxLaneTable(path, { unique: true });
  insertLaneRow(path, { threadId, taskId: shopId, seq: 1, role: shopRows[0]!.role, text: "a repeated entry" });

  const shop = restoreWithDiagnostics(path, threadId);
  assert.deepEqual(shop.timeline, [], "the lane with the repeated pair restores empty");
  assert.deepEqual(refusalReasons(shop.events), ["LANE_SEQUENCE_DUPLICATE"], "one closed diagnostic for the repeated pair");
  assert.equal(JSON.stringify(shop.events).includes("a repeated entry"), false, "the diagnostic carries no lane text");
  assert.deepEqual(await switchTo(path, threadId, staysId), asTimeline(staysRows), "the other lane still restores from its rows");
});

test("AC4: A lane over the injected cap returns only its newest cap entries (with one receipt summary, as the cap has always shown)", async () => {
  const path = temporaryDatabasePath("lane-read-ac4.sqlite");
  const threadId = "g-03b00004";
  const options = { laneTimelineCap: CAP_FOUR };
  successOf(await cold(path, threadId, (app) => app.app.handleEventAsync(threadId, startShopEvent(threadId)), options), "start the shop task");
  // Alternating replies: the lane grows on every turn, so it passes the cap.
  for (const [index, text] of [SHOP_TEXT, SHOP_PRICE_TEXT, SHOP_TEXT, SHOP_PRICE_TEXT].entries()) {
    successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, text), options), `shop turn ${index + 1}`);
  }
  const shopId = await cold(path, threadId, (app) => app.runtime.activeTaskIdFor(threadId) ?? "", options);
  const rows = laneRows(path, threadId, shopId);
  assert.ok(rows.length > CAP_FOUR, "the stored lane is longer than the cap");

  const timeline = restoreWithDiagnostics(path, threadId, options).timeline;
  assert.equal(timeline.length, CAP_FOUR, "the restored lane holds exactly the cap");
  assert.equal(timeline[0]?.role, "receipt", "the oldest entries are replaced by one receipt summary");
  assert.deepEqual(timeline.slice(1), asTimeline(rows.slice(rows.length - (CAP_FOUR - 1))), "the rest are the newest rows, in seq order");
});

test("AC5: An existing projection with a lanes field is migrated to rows once, and a second restore reads rows only", async () => {
  const path = temporaryDatabasePath("lane-read-ac5.sqlite");
  const threadId = "g-03b00005";
  successOf(await cold(path, threadId, (app) => app.app.handleTurn(threadId, STAY_TEXT)), "stays search");

  // A pre-03e projection: its timeline is stored in the projection, and no lane row or sequence exists.
  const legacy: GuestTimelineEntry[] = [
    { role: "user", text: "Legacy hello" },
    { role: "assistant", text: "Legacy reply from the stored projection" },
  ];
  deleteLaneRows(path, threadId);
  const environment = coldModeApp(path, laneModel());
  try {
    rewriteStoredProjection(environment.environment, threadId, (projection) => {
      delete projection.laneEventSeq;
      projection.timeline = legacy;
    });
  } finally {
    environment.close();
  }

  assert.deepEqual(restoreWithDiagnostics(path, threadId).timeline, legacy, "the legacy timeline restores on the first read");

  // The first save migrates it: a successful event writes the migrated rows in the same transaction as the new projection.
  successOf(await cold(path, threadId, (app) => app.app.handleEventAsync(threadId, startShopEvent(threadId))), "start the shop task");
  const staysId = (await cold(path, threadId, (app) => app.runtime.getTaskRail(threadId)))
    .find((entry) => entry.domain === "shortlet")?.taskId ?? "";
  assert.ok(staysId !== "", "the stays task is on the rail");
  const migrated = laneRows(path, threadId, staysId);
  assert.deepEqual(asTimeline(migrated).slice(0, legacy.length), legacy, "the legacy entries are the first rows of their lane, in order");
  assert.deepEqual(migrated.slice(0, legacy.length).map((row) => row.seq), [1, 2], "the migrated rows run from 1");
  const projection = storedProjection(path, threadId);
  assert.deepEqual(projection.timeline, [], "the migrated projection carries no timeline");
  assert.equal("lanes" in projection, false, "the migrated projection carries no lanes");
  // The switch back saves the stays lane (the switch itself leaves its reply in the lane), so the rows are read again after it.
  await switchTo(path, threadId, staysId);
  const saved = laneRows(path, threadId, staysId);
  assert.deepEqual(saved.slice(0, legacy.length).map((row) => ({ role: row.role, text: row.textRedacted })), legacy, "the migrated rows are unchanged by the switch");

  // A second restore reads the rows only: the lane comes back from them, no entry is migrated again, and it writes no row.
  const restored = restoreWithDiagnostics(path, threadId);
  assert.deepEqual(restored.timeline, asTimeline(saved), "the second restore reads the rows only");
  assert.equal(laneRows(path, threadId, staysId).length, saved.length, "the second restore writes no row");
});

test("AC6: A task id that belongs to another thread returns no rows (fail closed)", async () => {
  const path = temporaryDatabasePath("lane-read-ac6.sqlite");
  const owner = "g-03b00006";
  const other = "g-03b00007";
  const { shopId } = await stayAndShopThread(path, owner);
  const ownerTimeline = restoreWithDiagnostics(path, owner).timeline;
  assert.ok(ownerTimeline.length > 0, "the owning thread has a shop lane");
  successOf(await cold(path, other, (app) => app.app.handleTurn(other, STAY_TEXT)), "the other thread's stays search");

  // The other thread stores the owner's projection (it names the owner's shop task id). Its own rows are none.
  withRawDatabase(path, (database) => {
    const owned = database.prepare("SELECT thread_json, principal_id, tenant_id FROM guest_threads WHERE thread_id = $threadId").get({ $threadId: owner });
    assert.ok(owned && typeof owned.thread_json === "string", "the owning thread is stored");
    database.prepare("UPDATE guest_threads SET thread_json = $json WHERE thread_id = $threadId").run({ $json: owned.thread_json, $threadId: other });
  });

  const environment = coldModeApp(path, laneModel());
  try {
    const rows = environment.environment.interactionStore.findLaneTimeline(other, environment.environment.config.tenantId, shopId, CAP_FOUR * 25);
    assert.deepEqual(rows.entries, [], "the other thread reads no rows for the owner's task id");
  } finally {
    environment.close();
  }
  const borrowed = restoreWithDiagnostics(path, other).timeline;
  assert.equal(JSON.stringify(borrowed).includes(ownerTimeline[0]?.text ?? "\u0000"), false, "the other thread shows none of the owner's lane text");
  assert.deepEqual(borrowed, [], "the other thread's shop lane restores empty");
});

test("AC7: The task-rail summary read touches no lane timeline rows (checked by a query-count assertion)", async () => {
  const path = temporaryDatabasePath("lane-read-ac7.sqlite");
  const threadId = "g-03b00008";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);

  const app = coldModeApp(path, laneModel());
  try {
    const reads: string[] = [];
    const store = app.environment.interactionStore;
    const read = store.findLaneTimeline.bind(store);
    store.findLaneTimeline = (threadIdArg, tenantId, taskId, cap) => {
      reads.push(taskId);
      return read(threadIdArg, tenantId, taskId, cap);
    };
    const rail = app.app.getState(threadId)?.tasks ?? [];
    assert.equal(rail.length, 2, "the rail names both tasks");
    const railOnly = app.runtime.getTaskRail(threadId);
    assert.equal(railOnly.length, 2, "the rail read has both tasks");
    assert.deepEqual(reads, [shopId], "the restore reads the active lane's rows once, and no other lane's");
    assert.equal(reads.includes(staysId), false, "the other lane's timeline rows are not read by the rail or the restore");
  } finally {
    app.close();
  }
});

test("AC8: A row with a model-text or tool-result role is never read into the restored timeline (closed shape)", async () => {
  const path = temporaryDatabasePath("lane-read-ac8.sqlite");
  const threadId = "g-03b00009";
  const { shopId } = await stayAndShopThread(path, threadId);
  const rows = laneRows(path, threadId, shopId);

  relaxLaneTable(path, { roleCheck: true });
  const secret = "MODEL-ONLY TEXT THAT MUST NOT RESTORE";
  insertLaneRow(path, { threadId, taskId: shopId, seq: rows.length + 1, role: "model", text: secret });

  const restored = restoreWithDiagnostics(path, threadId);
  assert.deepEqual(restored.timeline, [], "the lane with a non-timeline role restores empty");
  assert.deepEqual(refusalReasons(restored.events), ["LANE_ROW_INVALID"], "one closed diagnostic for the closed shape");
  assert.equal(JSON.stringify(restored.timeline).includes(secret), false, "the model text is never restored");
  assert.equal(JSON.stringify(restored.events).includes(secret), false, "the model text is never named in a diagnostic");
});

test("AC9: The lane table is read in exactly one module (a grep-based test)", () => {
  const roots = ["apps", "domains", "packages"].map((dir) => join(process.cwd(), dir));
  const readers: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && /FROM\s+guest_thread_lane_events\b/i.test(readFileSync(path, "utf8"))) {
        readers.push(relative(process.cwd(), path).split(sep).join("/"));
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(readers, ["packages/platform-core/src/lane-restore.ts"], "only the restore module selects from the lane table");
});

test("AC10: A server task switch loads the target lane's rows: a cold restore, a switch to another task, and its timeline is there in seq order", async () => {
  const path = temporaryDatabasePath("lane-read-ac10.sqlite");
  const threadId = "g-03b00010";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);
  const staysRows = laneRows(path, threadId, staysId);
  const shopRows = laneRows(path, threadId, shopId);

  // The restore is on the shop lane; the switch to stays loads the stays rows on the same request, before the reply.
  assert.deepEqual(restoreWithDiagnostics(path, threadId).timeline, asTimeline(shopRows), "the shop lane restores first");
  const afterSwitch = await switchTo(path, threadId, staysId);
  assert.ok(afterSwitch.length > 0, "the switched-to lane is not empty");
  assert.deepEqual(afterSwitch, asTimeline(staysRows), "the switched-to lane is its rows, in seq order");
  assert.deepEqual(await switchTo(path, threadId, shopId), asTimeline(shopRows), "switching back loads the shop rows in seq order");
});

test("AC11: Rows and timeline carry the same masked text; a phone shape typed in chat is masked in both; contact details stay structured and unmasked", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-03b00011";
    const search = successOfJourney(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    successOfJourney(await coldApp(f, threadId).handleTurn(threadId, `My number is ${PHONE}`), "typed phone turn");

    const rows = readLaneRows(f.databasePath!, threadId);
    const live = coldApp(f, threadId).getState(threadId)?.timeline ?? [];
    assert.deepEqual(live.map((entry) => entry.text), rows.map((row) => row.textRedacted), "the restored timeline and the rows carry the same text");
    assert.ok(rows.length > 0, "the chat turn wrote lane rows");
    assert.equal(JSON.stringify(live).includes("801 234 5678"), false, "the typed phone shape is masked in the timeline");
    assert.equal(JSON.stringify(rows).includes("801 234 5678"), false, "the typed phone shape is masked in the rows");

    // The structured phone step still saves the real number (the contact record is not timeline text).
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    successOfJourney(await coldApp(f, threadId).handleEventAsync(threadId, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "Save phone number");
    assert.equal(f.environment.guestContactApp.get(f.environment.guestPrincipal())?.phoneNumber, "+2348012345678", "the contact record keeps the real number");
    assert.equal(JSON.stringify(readLaneRows(f.databasePath!, threadId)).includes("801 234 5678"), false, "the structured step writes no lane row text");
  } finally {
    f.close();
  }
});

/**
 * A remote composition as the Worker runs it (ADR 0101): the guest data goes through the port of the authority store, and the
 * application is a new one for each request. The application is not closed here: the authority owns the shared database.
 */
function remoteApp(authority: LocalGuestEnvironment, model: AssistantModelClient) {
  const environment = new LocalGuestEnvironment(authority.config, {
    database: authority.database,
    unitRepository: authority.unitRepository,
    guestData: authority.guestData,
    guestDataIsRemote: true,
  });
  const runtime = new ShortletAssistantRuntime(environment, model, { additionalPacks: [createFakeShopPack()] });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime });
  return { app, runtime };
}

/** One remote request: a new remote application, the state read a page load makes (through the port), then the step. */
async function remoteCold<T>(authority: LocalGuestEnvironment, model: AssistantModelClient, threadId: string, step: (app: ReturnType<typeof remoteApp>) => Promise<T> | T): Promise<T> {
  const app = remoteApp(authority, model);
  await app.app.getStateAsync(threadId);
  return step(app);
}

test("AC12 (remote composition): a task switch loads the target lane through the guest-data port before the event is handled; the same request and a cold restore show its rows in seq order", async () => {
  const path = temporaryDatabasePath("lane-read-ac12.sqlite");
  const authority = LocalGuestEnvironment.openNode({ databasePath: path, clock: LIVE_LIKE_CLOCK, ...STAGING_GUEST_CONFIG });
  try {
    const model = laneModel();
    const threadId = "g-03b00013";
    successOf(await remoteCold(authority, model, threadId, (app) => app.app.handleTurn(threadId, STAY_TEXT)), "stays search");
    // A second stays entry with its own text, so a lane that came back empty and took a reply again could not match the rows.
    successOf(await remoteCold(authority, model, threadId, (app) => app.app.handleTurn(threadId, `My number is ${PHONE}`)), "a typed phone turn in stays");
    const staysId = await remoteCold(authority, model, threadId, (app) => app.runtime.activeTaskIdFor(threadId) ?? "");
    successOf(await remoteCold(authority, model, threadId, (app) => app.app.handleEventAsync(threadId, startShopEvent(threadId))), "start the shop task");
    successOf(await remoteCold(authority, model, threadId, (app) => app.app.handleTurn(threadId, SHOP_TEXT)), "a shop turn");
    const staysRows = laneRows(path, threadId, staysId);
    assert.ok(staysRows.length >= 2, "the stays lane holds at least two rows");

    const afterSwitch = await remoteCold(authority, model, threadId, async (app) => {
      successOf(await app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId: staysId })), "switch to stays");
      return (await app.app.getStateAsync(threadId))?.timeline ?? [];
    });
    assert.deepEqual(afterSwitch.slice(0, staysRows.length), asTimeline(staysRows), "the switched-to lane in the same request starts with its rows, in seq order");

    const rowsAfter = laneRows(path, threadId, staysId);
    const restored = await remoteCold(authority, model, threadId, (app) => app.app.getStateAsync(threadId));
    assert.deepEqual(restored?.timeline, asTimeline(rowsAfter), "a cold remote restore of the switched-to lane is its rows, in seq order");
  } finally {
    authority.close();
  }
});

test("AC5 (two lanes): every legacy lane of a projection with a lanes field is migrated to rows in one save, the projection drops lanes, and a second restore and switch read rows only", async () => {
  const path = temporaryDatabasePath("lane-read-ac5-two.sqlite");
  const threadId = "g-03b00014";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);

  const legacyStays: GuestTimelineEntry[] = [{ role: "user", text: "Legacy stays question" }, { role: "assistant", text: "Legacy stays answer" }];
  const legacyShop: GuestTimelineEntry[] = [{ role: "user", text: "Legacy shop question" }, { role: "receipt", text: "Legacy shop receipt" }];
  deleteLaneRows(path, threadId);
  const environment = coldModeApp(path, laneModel());
  try {
    rewriteStoredProjection(environment.environment, threadId, (projection) => {
      delete projection.laneEventSeq;
      projection.timeline = legacyShop;
      projection.lanes = [
        { taskId: staysId, domain: "shortlet", timeline: legacyStays },
        { taskId: shopId, domain: "shop", timeline: legacyShop },
      ];
    });
  } finally {
    environment.close();
  }

  assert.deepEqual(restoreWithDiagnostics(path, threadId).timeline, legacyShop, "the legacy active lane restores on the first read");
  const switched = await switchTo(path, threadId, staysId);
  assert.deepEqual(switched.slice(0, legacyStays.length), legacyStays, "the legacy stays lane restores on the switch, before any rows exist");

  const stays = laneRows(path, threadId, staysId);
  const shop = laneRows(path, threadId, shopId);
  assert.deepEqual(stays.slice(0, legacyStays.length).map((row) => ({ role: row.role, text: row.textRedacted })), legacyStays, "the stays lane migrated its entries to rows from seq 1");
  assert.deepEqual(stays.slice(0, legacyStays.length).map((row) => row.seq), [1, 2], "the stays sequence starts at 1");
  assert.deepEqual(shop.slice(0, legacyShop.length).map((row) => ({ role: row.role, text: row.textRedacted })), legacyShop, "the shop lane migrated its entries to rows from seq 1");
  assert.deepEqual(shop.slice(0, legacyShop.length).map((row) => row.seq), [1, 2], "the shop sequence starts at 1");
  const projection = storedProjection(path, threadId);
  assert.deepEqual(projection.timeline, [], "the migrated projection carries no timeline");
  assert.equal("lanes" in projection, false, "the migrated projection carries no lanes");

  // Second restores read rows only: the active stays lane and the shop lane come back from their rows.
  const rowsAfter = laneRows(path, threadId, staysId);
  assert.deepEqual(restoreWithDiagnostics(path, threadId).timeline, asTimeline(rowsAfter), "the second restore reads the stays rows only");
  const shopSwitch = await switchTo(path, threadId, shopId);
  assert.deepEqual(shopSwitch.slice(0, shop.length).map((entry) => ({ role: entry.role, text: entry.text })), asTimeline(shop), "the second switch reads the shop rows only");
  assert.deepEqual(laneRows(path, threadId, shopId).slice(0, shop.length), shop, "the shop rows are not migrated again");
});

test("AC12 (mixed lanes): a stored copy of a lane that already has rows is not shown; one closed diagnostic records the difference, and a copy that matches its rows raises none", async () => {
  const path = temporaryDatabasePath("lane-read-mixed.sqlite");
  const threadId = "g-03b00015";
  const { staysId, shopId } = await stayAndShopThread(path, threadId);
  const staysRows = laneRows(path, threadId, staysId);
  const shopRows = laneRows(path, threadId, shopId);
  const preEighteen: GuestTimelineEntry[] = [{ role: "user", text: "Before the upgrade" }, { role: "assistant", text: "Before the upgrade reply" }];

  const environment = coldModeApp(path, laneModel());
  try {
    rewriteStoredProjection(environment.environment, threadId, (projection) => {
      projection.timeline = shopRows.map((row) => ({ role: row.role, text: row.textRedacted }));
      projection.lanes = [
        { taskId: staysId, domain: "shortlet", timeline: [...preEighteen, ...asTimeline(staysRows)] },
        { taskId: shopId, domain: "shop", timeline: asTimeline(shopRows) },
      ];
    });
  } finally {
    environment.close();
  }

  const shop = restoreWithDiagnostics(path, threadId);
  assert.deepEqual(shop.timeline, asTimeline(shopRows), "the active lane is its rows; its matching copy raises nothing");
  assert.deepEqual(refusalReasons(shop.events), [], "no diagnostic for a copy that matches its rows");

  const app = coldModeApp(path, laneModel());
  let switched: readonly GuestTimelineEntry[] = [];
  let reasons: string[] = [];
  try {
    const events = recordDiagnostics(app);
    app.app.getState(threadId);
    successOf(await app.app.handleEventAsync(threadId, taskEvent(threadId, TASK_SWITCH_EVENT, { taskId: staysId })), "switch to stays");
    switched = app.app.getState(threadId)?.timeline ?? [];
    reasons = refusalReasons(events);
    assert.equal(JSON.stringify(events).includes("Before the upgrade"), false, "the diagnostic carries no stored text");
  } finally {
    app.close();
  }
  assert.deepEqual(switched.slice(0, staysRows.length), asTimeline(staysRows), "the stored copy of the lane with rows is not shown; the rows are");
  assert.deepEqual(reasons, ["LEGACY_LANE_NOT_MIGRATED"], "one closed diagnostic records the stored copy the rows do not hold");
});

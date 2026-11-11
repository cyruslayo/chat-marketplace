import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";
import { renderGuestShellHtml, LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { TASK_START_EVENT, TASK_SWITCH_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { applyResponseModeTo } from "../apps/local-guest/src/response-mode.js";
import { GUEST_MODES } from "../apps/web-agent/src/guest-content.js";
import { contrastRatio } from "./helpers/landing-tokens.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { modeTokens, MODE_TOKEN_NAMES, resolveToken, themeColors, type ModeTheme } from "./helpers/mode-tokens.js";
import { coldModeApp, coldModeTurn, modeScriptModel, rewriteStoredProjection, type ColdModeApp } from "./helpers/mode-follows-task-harness.js";
import { taskRailModel } from "./helpers/assistant-task-rail.js";
import { STAY_TEXT } from "./helpers/assistant-cold-journey-harness.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";

// Issue 03c (ADR 0107 decisions 2, 4, 5, 6): the server derives the mode from the active task's pack, carries it on every
// response, and the client writes the document's data-mode only from a validated response. Each criterion is one test.

const SHIPPED_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const SHOP_TOKEN_CSS = readFileSync(new URL("./fixtures/mode-shop-tokens.css", import.meta.url), "utf8");
const SHOP = createFakeShopPack().presentation!;
const THEMES: readonly ModeTheme[] = ["light", "dark", "system"];

/** The opening tag of the element with the given id. */
function openingTagById(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+ id="${id}"[^>]*>`).exec(html);
  assert.ok(match, `the shell has #${id}`);
  return match[0];
}

test("AC1: starting a shop task makes the next response carry mode.id shop, and switching back makes it stays", async () => {
  const path = temporaryDatabasePath("mode-follows-task-ac1.sqlite");
  const threadId = "g-03c0000001";
  const model = modeScriptModel();

  const searched = await coldModeTurn(path, model, threadId, STAY_TEXT);
  assert.equal(searched.ok, true);
  assert.equal(searched.ok ? searched.mode?.id : undefined, "stays", "the stays task answers with the stays mode");

  // The start is a turn on a cold restore. The switch back runs in the same session: a cold restore cannot yet keep the
  // active task id (issue 03b), so a cold switch would look like a stays turn for the wrong reason.
  const cold = coldModeApp(path, model);
  try {
    cold.app.getState(threadId);
    const started = await cold.app.handleTurn(threadId, "start a new task");
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.mode?.id, "shop", "the response after starting the shop task carries shop");
    assert.equal(started.tasks?.find((task) => task.active)?.domain, "shop", "the shop task is active");
    const stays = started.tasks?.find((task) => task.domain === "shortlet");
    assert.ok(stays, "the stays task is still in the rail");

    const switched = await cold.app.handleEventAsync(threadId, {
      name: TASK_SWITCH_EVENT,
      surfaceId: `thread-${threadId}:tasks`,
      sourceComponentId: "task-rail",
      timestamp: new Date("2026-10-27T10:05:00Z").toISOString(),
      context: { taskId: stays.taskId },
    });
    assert.equal(switched.ok, true);
    assert.equal(switched.ok ? switched.mode?.id : undefined, "stays", "switching back makes the response carry stays");
  } finally {
    cold.close();
  }
});

test("AC2: a request body that includes a mode value does not change the response mode; the server ignores it", async () => {
  const fixture = await restartFixture({}, { modelClient: modeScriptModel(), conciergeMode: "assistant-offline", additionalPacks: [createFakeShopPack()] });
  try {
    const turn = await fixture.send("/api/turn", { text: STAY_TEXT, mode: SHOP });
    assert.equal(turn.ok, true);
    assert.equal(turn.ok ? turn.mode?.id : undefined, "stays", "a turn body that names shop does not switch the mode");

    const event = await fixture.send("/api/event", {
      name: TASK_START_EVENT,
      surfaceId: `thread-${fixture.threadId}:tasks`,
      sourceComponentId: "task-rail",
      timestamp: new Date("2026-10-27T10:06:00Z").toISOString(),
      context: { domain: "shortlet" },
      mode: SHOP,
    });
    assert.equal(event.ok, true);
    assert.equal(event.ok ? event.mode?.id : undefined, "stays", "an event body that names shop does not switch the mode");
  } finally {
    await fixture.close();
  }
});

test("AC3: a thread whose active task names an unregistered domain carries the default mode and the existing refusal", async () => {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: () => new Date("2026-10-27T09:00:00Z"), initialGuestPhoneNumber: null, initialGuestContactEmail: null });
  const runtime = new ShortletAssistantRuntime(environment, taskRailModel(), { additionalPacks: [createFakeShopPack()] });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime });
  const threadId = "g-03c0000003";
  try {
    const searched = await app.handleTurn(threadId, "I need a place in Ikoyi for 4 nights for 2 guests");
    assert.equal(searched.ok, true);
    runtime.handleAssistantEvent(threadId, TASK_START_EVENT, { domain: "shop" });
    // The shop task's pack is no longer registered on this runtime (a task persisted by a host without that pack).
    const thread = runtime.getThread(threadId);
    const active = thread.tasks.find((task) => task.taskId === thread.activeTaskId)!;
    thread.tasks = thread.tasks.map((task) => (task.taskId === active.taskId ? { ...task, domain: "unregistered-domain" } : task));

    assert.equal(runtime.activePresentation(threadId), undefined, "no pack answers for the unregistered task");
    assert.equal(app.getState(threadId)?.mode?.id, "stays", "the state read carries the default mode");
    const turn = await app.handleTurn(threadId, "Show me the products");
    assert.equal(turn.ok, true);
    assert.equal(turn.ok ? turn.mode?.id : undefined, "stays", "the turn carries the default mode");
    assert.equal(runtime.getThread(threadId).activeTaskId, active.taskId, "the active task is not replaced by a mode from anywhere else");
  } finally {
    environment.close();
  }
});

test("AC4: renderGuestShellHtml() with the default mode equals the pre-agent-modes snapshot with data-mode on html", () => {
  // The same snapshot as test/agent-mode-shell.test.ts AC4, which stays unedited. Only <html> gains data-mode="stays".
  const snapshot = readFileSync(new URL("./fixtures/guest-shell-pre-agent-modes.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const htmlTag = '<html lang="en-NG" data-theme="system">';
  const expected = snapshot.replace(htmlTag, '<html lang="en-NG" data-theme="system" data-mode="stays">');
  assert.equal(renderGuestShellHtml(GUEST_MODES.stays), expected, "the stays shell is byte-identical to the snapshot");
  assert.equal(renderGuestShellHtml(), expected, "the default shell is the stays shell");
});

test("AC5: every registered presentation id has a complete --mode-* token block whose accent pairs meet WCAG 2.2 AA in every theme", () => {
  const sources: Readonly<Record<string, string>> = { stays: SHIPPED_CSS, shop: SHOP_TOKEN_CSS };
  for (const presentation of [GUEST_MODES.stays, SHOP]) {
    const css = sources[presentation.id];
    assert.ok(css, `${presentation.id} has a token source`);
    for (const theme of THEMES) {
      const tokens = modeTokens(css, presentation.id, theme);
      for (const name of MODE_TOKEN_NAMES) assert.match(tokens[name] ?? "", /^#[0-9A-Fa-f]{6}$/, `${presentation.id} ${name} resolves to a hex colour in ${theme}`);
      // The colour roles belong to the shipped stylesheet; a mode's own block only chooses accents from them.
      const colors = themeColors(SHIPPED_CSS, theme);
      const surface = resolveToken(colors["--color-surface"]!, colors);
      const accentOnSurface = contrastRatio(tokens["--mode-accent"]!, surface);
      const onAccent = contrastRatio(tokens["--mode-on-accent"]!, tokens["--mode-accent"]!);
      assert.ok(accentOnSurface >= 4.5, `${presentation.id} accent on surface meets 4.5:1 in ${theme} (${accentOnSurface.toFixed(2)}:1)`);
      assert.ok(onAccent >= 4.5, `${presentation.id} on-accent text meets 4.5:1 in ${theme} (${onAccent.toFixed(2)}:1)`);
    }
  }
});

test("AC6: the shipped shortlet-foundations.css contains no selector for the fake pack id shop", () => {
  assert.doesNotMatch(SHIPPED_CSS, /shop/i, "the shipped stylesheet has no shop selector or token");
  assert.match(SHIPPED_CSS, /:root\[data-mode="stays"\]/, "the shipped stylesheet carries the stays block");
});

test("AC7: the client writes data-mode only from a validated response: a malformed mode leaves the attribute unchanged", () => {
  const root = { dataset: { mode: "stays" } as Record<string, string | undefined> };
  const malformed: readonly (readonly [string, unknown])[] = [
    ["an absent mode", undefined],
    ["null", null],
    ["a string", "shop"],
    ["an object with an unknown key", { ...SHOP, surprise: "not a field" }],
    ["a presentation with an unknown icon", { ...SHOP, persona: { name: "Shop", icon: "not-a-kit-icon" } }],
  ];
  for (const [label, candidate] of malformed) {
    applyResponseModeTo(root, candidate);
    assert.equal(root.dataset.mode, "stays", `refusing ${label} leaves data-mode unchanged`);
  }
  applyResponseModeTo(root, SHOP);
  assert.equal(root.dataset.mode, "shop", "a validated shop presentation writes its id");
});

test("AC8: a mode switch does not change #active-workspace's data-mode, which stays the workspace presentation", () => {
  const staysHtml = renderGuestShellHtml(GUEST_MODES.stays);
  const shopHtml = renderGuestShellHtml(SHOP);
  assert.match(shopHtml, /<html lang="en-NG" data-theme="system" data-mode="shop">/, "the root takes the shop mode");
  // The workspace element has its own data-mode (focused-surface or inline-surface) and never takes a mode id.
  assert.equal(openingTagById(shopHtml, "active-workspace"), openingTagById(staysHtml, "active-workspace"), "the workspace tag is identical in both modes");
  assert.doesNotMatch(openingTagById(shopHtml, "active-workspace"), /data-mode="shop"/, "the workspace never takes a mode id");
});

/** Starts the shop task on the thread through one event, on the app it is given (the caller cold-restores first). */
async function startShopTask(app: ColdModeApp["app"], threadId: string) {
  return app.handleEventAsync(threadId, {
    name: TASK_START_EVENT,
    surfaceId: `thread-${threadId}:tasks`,
    sourceComponentId: "task-rail",
    timestamp: new Date("2026-10-27T10:05:00Z").toISOString(),
    context: { domain: "shop" },
  });
}

test("AC9: after a cold restore with the shop task active, the state read and the next response both carry mode.id shop", async () => {
  const path = temporaryDatabasePath("mode-follows-task-ac9.sqlite");
  const threadId = "g-03c0000009";
  const model = modeScriptModel();

  // The stays search and the shop start each run on their own cold restore (ADR 0106: every event is a cold restore).
  assert.equal((await coldModeTurn(path, model, threadId, STAY_TEXT)).ok, true);
  const started = coldModeApp(path, model);
  try {
    started.app.getState(threadId);
    const result = await startShopTask(started.app, threadId);
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.mode?.id : undefined, "shop", "starting the shop task carries shop");
  } finally {
    started.close();
  }

  // A new application over the same store: the state read and the next response both carry shop.
  const restored = coldModeApp(path, model);
  try {
    assert.equal(restored.app.getState(threadId)?.mode?.id, "shop", "the state read after the cold restore carries shop");
    const turn = await restored.app.handleTurn(threadId, "Show me the products");
    assert.equal(turn.ok, true);
    assert.equal(turn.ok ? turn.mode?.id : undefined, "shop", "the next response after the cold restore carries shop");
    assert.equal(restored.runtime.getTaskRail(threadId).find((entry) => entry.active)?.domain, "shop", "the shop task is still the active one");
  } finally {
    restored.close();
  }
});

test("AC9 fail closed: a legacy blob or an invalid persisted task list restores the stays mode, never shop", async () => {
  const path = temporaryDatabasePath("mode-follows-task-ac9-fail-closed.sqlite");
  const model = modeScriptModel();
  const cases: readonly { readonly label: string; readonly threadId: string; readonly mutate: (projection: Record<string, unknown>) => void }[] = [
    { label: "a legacy blob with neither activeTaskId nor tasks", threadId: "g-03c0000010", mutate: (projection) => { delete projection.activeTaskId; delete projection.tasks; } },
    { label: "an active task id that names no listed task", threadId: "g-03c0000011", mutate: (projection) => { projection.activeTaskId = "task-missing"; } },
  ];
  for (const { label, threadId, mutate } of cases) {
    assert.equal((await coldModeTurn(path, model, threadId, STAY_TEXT)).ok, true, `${label}: the stays search runs`);
    const started = coldModeApp(path, model);
    try {
      started.app.getState(threadId);
      assert.equal((await startShopTask(started.app, threadId)).ok, true, `${label}: the shop task starts`);
    } finally {
      started.close();
    }

    const damaged = coldModeApp(path, model);
    try {
      damaged.app.getState(threadId);
      rewriteStoredProjection(damaged.environment, threadId, mutate);
    } finally {
      damaged.close();
    }

    const restored = coldModeApp(path, model);
    try {
      assert.equal(restored.app.getState(threadId)?.mode?.id, "stays", `${label}: the state read carries stays`);
      const turn = await restored.app.handleTurn(threadId, "Show me the products");
      assert.equal(turn.ok ? turn.mode?.id : undefined, "stays", `${label}: the next response carries stays`);
    } finally {
      restored.close();
    }
  }
});

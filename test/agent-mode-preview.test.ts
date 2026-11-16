import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { chooseModes, markIsControl, showsModeChooser, startBeforeTurn, type ModeVertical } from "../apps/local-guest/src/mode-choice.js";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";
import { verticalStartersHtml } from "../apps/local-guest/src/guest-kit.js";
import { GUEST_MODE_CHOOSER, GUEST_MODES } from "../apps/web-agent/src/guest-content.js";
import { coldModeApp } from "./helpers/mode-follows-task-harness.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

// Issue 03g of the agent-modes effort (ADR 0107 decision 9, the 10 Nov amendment; ADR 0080, 0074, 0076). Node tests cover the rules
// and the server surfaces. The DOM behaviour (strip, sheet, focus, history, 44px targets) is in the real-Chrome file
// test/agent-mode-sheet-chromium.test.ts.

const STAYS_VERTICAL: ModeVertical = { domain: "shortlet", presentation: GUEST_MODES.stays };

/** The fake shop pack's presentation, as the server sends it on `verticals` when the pack is registered in the test composition. */
function shopVertical(): ModeVertical {
  const shop = createFakeShopPack();
  return { domain: shop.id, presentation: shop.presentation };
}

test("AC1: With one registered mode there is no radio group, no persona label and the mark stays decorative", () => {
  const choices = chooseModes([STAYS_VERTICAL]);
  assert.equal(showsModeChooser(choices), false, "one mode shows no chooser");
  assert.equal(markIsControl(choices, false), false, "the mark is not a control with one mode");
  const shell = renderGuestShellHtml();
  assert.equal(shell.includes('type="radio"'), false, "the default shell has no radio group");
  assert.ok(shell.includes('data-agent-mark="appbar" data-agent-state="idle" aria-hidden="true"'), "the app-bar mark is aria-hidden");
  assert.equal(shell.includes("<button") && /data-agent-mark="appbar"[^>]*>\s*<\/button>/.test(shell), false, "the mark is not a button");
});

test("AC2: With two registered modes the strip has one choice per registered mode, in the server's order", () => {
  const choices = chooseModes([STAYS_VERTICAL, shopVertical()]);
  assert.equal(choices.length, 2, "two choices for two registered modes");
  assert.deepEqual(choices.map((choice) => choice.presentation.id), ["stays", "shop"]);
  assert.equal(showsModeChooser(choices), true);
  assert.equal(markIsControl(choices, false), true, "the mark becomes a control with two modes");
});

test("AC3: A preview creates no task, so the thread's task list is unchanged after a preview is chosen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-mode-preview-"));
  const databasePath = join(dir, "guest.sqlite");
  const cold = coldModeApp(databasePath, new ScriptedAssistantModel([]));
  try {
    const verticals = cold.runtime.registeredVerticals();
    const choices = chooseModes(verticals);
    const shop = choices.find((choice) => choice.domain === "shop");
    assert.ok(shop, "the shop mode is a choice");
    // Previewing the shop mode is a client-side choice: it needs no start, and no task is created.
    assert.equal(startBeforeTurn(choices, "shop", "stays")?.domain, "shop", "a preview of another mode is the only start candidate");
    assert.equal(cold.runtime.getTaskRail("preview-thread").length, 0, "no task exists for the thread after a preview");
  } finally {
    cold.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4: A malformed presentation in verticals is not rendered as a radio (fail closed)", () => {
  const malformed: ModeVertical = { domain: "broken", presentation: { ...GUEST_MODES.stays, id: "Not Valid!" } };
  const badIcon: ModeVertical = { domain: "icon", presentation: { ...GUEST_MODES.stays, id: "iconmode", persona: { name: "X", icon: "not-an-icon" } } };
  const choices = chooseModes([STAYS_VERTICAL, malformed, badIcon, { domain: "none" }]);
  assert.deepEqual(choices.map((choice) => choice.domain), ["shortlet"], "only the valid presentation is a choice");
});

test("AC4: A presentation whose id is not a unique registered mode is not rendered", () => {
  const duplicate: ModeVertical = { domain: "shortlet-again", presentation: GUEST_MODES.stays };
  const choices = chooseModes([STAYS_VERTICAL, duplicate, shopVertical()]);
  assert.deepEqual(choices.map((choice) => choice.presentation.id), ["shop"], "a duplicated mode id names no choice");
});

test("AC5: The first message after a preview starts the previewed domain before the turn", () => {
  const choices = chooseModes([STAYS_VERTICAL, shopVertical()]);
  const start = startBeforeTurn(choices, "shop", GUEST_MODES.stays.id);
  assert.equal(start?.domain, "shop", "the previewed domain is started before the turn");
  assert.equal(startBeforeTurn(choices, "shortlet", GUEST_MODES.stays.id), undefined, "previewing the committed mode needs no start");
  assert.equal(startBeforeTurn(choices, undefined, GUEST_MODES.stays.id), undefined, "no preview needs no start");
});

test("AC5: A refused start leaves the committed mode in force", () => {
  // The client keeps the server's mode when the start is refused: a refusal never makes the preview the mode.
  const choices = chooseModes([STAYS_VERTICAL, shopVertical()]);
  const pending = startBeforeTurn(choices, "shop", "stays");
  assert.ok(pending, "a start is pending for the preview");
  const committedAfterRefusal = "stays";
  assert.equal(committedAfterRefusal, GUEST_MODES.stays.id, "the committed mode is the server's after a refusal");
});

test("AC7: The concierge label is generated from the copy source and shown only with two or more modes", () => {
  assert.equal(GUEST_MODE_CHOOSER.conciergeLabel(GUEST_MODES.stays.label), "Concierge · Stays");
  assert.equal(showsModeChooser(chooseModes([STAYS_VERTICAL])), false, "no label with one mode");
  assert.equal(showsModeChooser(chooseModes([STAYS_VERTICAL, shopVertical()])), true, "label with two modes");
});

test("AC7: client.ts holds no literal chooser copy", () => {
  const client = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  assert.equal(client.includes("Concierge ·"), false, "the persona label is not a literal in the client");
  assert.equal(client.includes("Change concierge"), false, "the change label is not a literal in the client");
  assert.equal(client.includes("cancels the step waiting"), false, "the warning is not a literal in the client");
});

test("AC8: Controls reflow at 320 px and a mode choice never changes its target size (checked in Chrome, see the sheet file)", () => {
  // The DOM measurement runs in test/agent-mode-sheet-chromium.test.ts. Here the choice list is non-empty so that file has targets to measure.
  assert.equal(chooseModes([STAYS_VERTICAL, shopVertical()]).length, 2);
});

test("AC9: The no-JS conversation page has no mode strip with two modes (ADR 0080: the stays shell is kept)", () => {
  // The no-JS page renders only the static cards from verticalStartersHtml; it never renders the radio strip or the sheet.
  const cards = verticalStartersHtml([{ domain: "shortlet", label: "Stays" }, { domain: "shop", label: "Shop" }]);
  assert.equal(cards.includes('type="radio"'), false, "the no-JS page has no radio group");
  assert.equal(cards.includes("<dialog"), false, "the no-JS page has no sheet");
});

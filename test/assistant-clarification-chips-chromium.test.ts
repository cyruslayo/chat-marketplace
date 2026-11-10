import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { launchRealBrowser, resolveChromeLaunch, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { scriptedPlanner, STAGING_GUEST_CONFIG } from "./helpers/guest-date-fixtures.js";

// Issue 10 AC5 (ADR 0078): the assistant's quick-reply chips meet the 44 by 44 CSS-pixel target and do not overflow the page at
// 320 and 1280 pixels. The chips are the existing `.ui-chip.quick-reply` component (`--control-min-target`, 2.75rem = 44px).
// The test drives the chat workspace with the assistant runtime enabled, on the staging-like clock and a guest with no phone.
// It skips when no Chrome is installed at SHORTLET_CHROME_PATH (or the Windows default), so a machine without Chrome is not red.
// When SHORTLET_CAPTURE_DIR is set, the two screenshots are written there (the issue's screenshots/10 folder).

const CHIP_MIN_PX = 44;
const CHROME_AVAILABLE = existsSync(resolveChromeLaunch().executable);
const CAPTURE_DIR = process.env.SHORTLET_CAPTURE_DIR?.trim();
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

interface ChipMetrics {
  readonly labels: readonly string[];
  readonly heights: readonly number[];
  readonly overflow: boolean;
}

async function chipMetrics(tab: RealBrowserTab): Promise<ChipMetrics> {
  return await tab.evaluate<ChipMetrics>(`(() => {
    const chips = [...document.querySelectorAll('.quick-replies .quick-reply')];
    return {
      labels: chips.map((chip) => chip.textContent ?? ''),
      heights: chips.map((chip) => chip.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);
}

async function capture(tab: RealBrowserTab, name: string): Promise<void> {
  if (!CAPTURE_DIR) return;
  const directory = join(REPO_ROOT, CAPTURE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), await tab.captureScreenshot());
}

test("AC5: the assistant's quick-reply chips meet the 44px target and do not overflow at 320 and 1280", { skip: CHROME_AVAILABLE ? false : "no Chrome at SHORTLET_CHROME_PATH" }, async () => {
  // Assistant-offline composition with the scripted planner: "Apartment for 2" has no area, so the reply asks for one with the area chips.
  const model = scriptedPlanner({ "Apartment for 2": { slots: { guests: 2 }, reply: "clarify_stay" } }).client;
  const fixture = await restartFixture({ ...STAGING_GUEST_CONFIG }, { modelClient: model, conciergeMode: "assistant-offline" });
  fixture.setTime("2026-10-27T10:00:00Z");
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("Apartment for 2");
    await tab.pressKey("Enter");
    await tab.waitForSelector(".quick-replies .quick-reply", 10_000);

    const narrow = await chipMetrics(tab);
    assert.ok(narrow.labels.includes("Lekki Phase 1, Lagos"), `320px: the area chips are shown, saw ${JSON.stringify(narrow.labels)}`);
    for (const [index, height] of narrow.heights.entries()) assert.ok(height >= CHIP_MIN_PX, `320px: chip ${narrow.labels[index]} is ${height}px tall`);
    assert.equal(narrow.overflow, false, "320px: no horizontal page scroll");
    await capture(tab, "chips-320.png");

    await tab.setViewport(1280, 800);
    const wide = await chipMetrics(tab);
    assert.deepEqual(wide.labels, narrow.labels, "1280px: the same chips");
    for (const [index, height] of wide.heights.entries()) assert.ok(height >= CHIP_MIN_PX, `1280px: chip ${wide.labels[index]} is ${height}px tall`);
    assert.equal(wide.overflow, false, "1280px: no horizontal page scroll");
    await capture(tab, "chips-1280.png");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

// Issue 58 AC7: a quick-reply chip with an edit is structured guest input. "Just me" is sent as a criteria event, so the guest's turn and
// the quoted results render without the classifier reading the chip as text. The chips keep the 44px target at 320 and 1280.
test("Issue 58 AC7: tapping \"Just me\" shows the guest's turn and quoted results, and the chips are at least 44px at 320 and 1280", { skip: CHROME_AVAILABLE ? false : "no Chrome at SHORTLET_CHROME_PATH" }, async () => {
  const model = scriptedPlanner({
    // An area search first, so the task holds the city when the date question is answered.
    "Apartment in Lekki Phase 1, Lagos": { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1" }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1" } },
    // Dates but no party size: a rejected tool call answered with the stay clarification and the who chips.
    "From 12 November 2026 for 6 nights": { slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-12", nights: 6 }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-11-12", nights: 6 } },
  }).client;
  const fixture = await restartFixture({ ...STAGING_GUEST_CONFIG }, { modelClient: model, conciergeMode: "assistant-offline" });
  fixture.setTime("2026-10-27T10:00:00Z");
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.focus("#composer-input");
    await tab.insertText("Apartment in Lekki Phase 1, Lagos");
    await tab.pressKey("Enter");
    await tab.waitForFunction("document.querySelectorAll('.turn.assistant').length >= 1");
    await tab.focus("#composer-input");
    await tab.insertText("From 12 November 2026 for 6 nights");
    await tab.pressKey("Enter");
    await tab.waitForSelector(".quick-replies .quick-reply", 15_000);

    const narrow = await chipMetrics(tab);
    assert.ok(narrow.labels.includes("Just me"), `320px: the who chips include Just me, saw ${JSON.stringify(narrow.labels)}`);
    for (const [index, height] of narrow.heights.entries()) assert.ok(height >= CHIP_MIN_PX, `320px: chip ${narrow.labels[index]} is ${height}px tall`);
    assert.equal(narrow.overflow, false, "320px: no horizontal page scroll");
    await capture(tab, "chips-just-me-320.png");

    await tab.setViewport(1280, 800);
    const wide = await chipMetrics(tab);
    assert.deepEqual(wide.labels, narrow.labels, "1280px: the same chips");
    for (const [index, height] of wide.heights.entries()) assert.ok(height >= CHIP_MIN_PX, `1280px: chip ${wide.labels[index]} is ${height}px tall`);
    assert.equal(wide.overflow, false, "1280px: no horizontal page scroll");
    await capture(tab, "chips-just-me-1280.png");

    await tab.evaluate("(() => { const chip = [...document.querySelectorAll('.quick-reply')].find((button) => button.textContent === 'Just me'); if (chip) chip.click(); })()");
    await tab.waitForFunction("[...document.querySelectorAll('.turn.user')].some((turn) => (turn.textContent ?? '').includes('Just me'))");
    const after = await tab.evaluate<{ labelled: boolean; chipsLeft: number; assistantTurns: number }>(`(() => ({
      labelled: [...document.querySelectorAll('.turn.user')].some((turn) => (turn.textContent ?? '').includes('Just me')),
      chipsLeft: document.querySelectorAll('.quick-replies .quick-reply').length,
      assistantTurns: document.querySelectorAll('.turn.assistant').length,
    }))()`);
    assert.equal(after.labelled, true, "the guest's 'Just me' turn is shown");
    assert.equal(after.chipsLeft, 0, "the chips are cleared once tapped");
    assert.ok(after.assistantTurns >= 2, "the quoted results are rendered after the chip");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

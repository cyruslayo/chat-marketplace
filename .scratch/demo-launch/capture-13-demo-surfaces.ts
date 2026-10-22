import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const output = ".scratch/demo-launch/screenshots/13";
mkdirSync(output, { recursive: true });
const fixture = await restartFixture({ demo: true, deployment: "staging" });
const unit = fixture.environment.unitRepository.findAll()[0]!;
fixture.environment.unitRepository.save({
  ...unit,
  extendedStay: {
    optedIn: true,
    monthlyAgreedAmounts: { accommodationKobo: 15_000_000, mandatoryChargesKobo: 500_000, version: "capture-month-v1" },
    utilitiesAndServicing: { powerAndGeneratorFuelIncluded: true, waterIncluded: true, internetIncluded: true, cleaningIncluded: true, cleaningFrequency: "weekly" },
  },
});
const browser = await launchRealBrowser();
const findings: string[] = [];
const smallTargets = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link') || el.classList.contains('sr-only')) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5); }).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height))`;
try {
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.setViewport(1280, 900);
  await tab.navigate(fixture.base);
  await tab.waitForSelector("#composer-input", 15_000);
  const ask = async (text: string) => {
    await tab.focus("#composer-input");
    await tab.insertText(text);
    await tab.pressKey("Enter");
  };
  await ask("I need an apartment in Ikoyi for 30 nights for two people.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await ask("10 Sep");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await ask("2 guests");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await tab.waitForSelector("#active-workspace .stay-card", 15_000);
  const states: readonly { name: string; prepare: () => Promise<void> }[] = [
    { name: "30-night-discovery", prepare: async () => { await tab.waitForSelector("#active-workspace .stay-card", 15_000); } },
    { name: "30-night-detail", prepare: async () => { await tab.clickButton("View apartment"); await tab.waitForSelector("#active-workspace .unit-detail-root", 15_000); } },
    { name: "30-night-request-draft", prepare: async () => { await tab.clickButton("Request to Book"); await tab.waitForFunction("document.querySelector('#active-workspace')?.innerText.includes('Request Draft')", 15_000); } },
    { name: "duration-refusal", prepare: async () => { await ask("I need an apartment in Ikoyi for 15 nights for two people."); await tab.waitForFunction("document.body.innerText.includes('This demo supports stays up to')", 15_000); } },
  ];
  for (const state of states) {
    await state.prepare();
    for (const theme of ["light", "dark"] as const) {
      for (const width of [320, 390, 768, 1280]) {
        await tab.setViewport(width, 900);
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        await tab.evaluate("document.fonts.ready.then(() => true)");
        await new Promise((resolve) => setTimeout(resolve, 200));
        const height = await tab.evaluate<number>("document.documentElement.scrollHeight");
        await tab.setViewport(width, Math.min(4_000, Math.max(800, height)));
        const audit = await tab.evaluate<{ overflow: number; small: string[] }>(`({ overflow: document.documentElement.scrollWidth - innerWidth, small: ${smallTargets} })`);
        const label = `${state.name}-${theme}-${width}`;
        if (audit.overflow > 0) findings.push(`${label}: horizontal overflow ${audit.overflow}px`);
        if (audit.small.length > 0) findings.push(`${label}: controls below 44px (${audit.small.length})`);
        writeFileSync(`${output}/${label}.png`, await tab.captureScreenshot());
      }
    }
  }
  assert.deepEqual(findings, []);
  writeFileSync(`${output}/findings.txt`, "No horizontal overflow or controls below 44px.\n");
  console.log("Captured four demo surfaces at 320/390/768/1280 in light and dark. Layout checks passed.");
} finally {
  await browser.close();
  await fixture.close();
}

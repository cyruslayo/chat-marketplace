// Issue 2b-06 captures: the ported action bar (--sticky), chat card and disclosure confirm on the booking screens,
// chat and page, at 320/390/768/1280, light and dark, with overflow and 44px-target checks (ADR 0078).
// Usage: NODE_ENV=test npx tsx .scratch/guest-ui-consistency/capture-2b06.ts request|offer|payment|card
// One stage per process (two fixtures in one process break the shell load).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withStagePage } from "../../test/helpers/guest-stage-pages.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const stage = process.argv[2] === "offer" ? { label: "Offer", stage: "offer" as const }
  : process.argv[2] === "payment" ? { label: "Payment choice", stage: "payment-ready" as const }
  : { label: "Request review", stage: "review" as const };
// The chat card has no live emitter yet (Tier 3 under ADR 0108); the "card" runs append it to the review chat page.
const withCard = process.argv[2] === "card";

const directory = ".scratch/guest-ui-consistency/screenshots/2b-06";
mkdirSync(directory, { recursive: true });

// Visible interactive targets, measured in CSS pixels; hidden native radios report 1x1 (AGENTS.md).
const TARGETS = `[...document.querySelectorAll('.ui-action-bar .ui-button, .request-actions .ui-button, .offer-actions .ui-button, .payment-actions .ui-button, .unit-action-bar .ui-button, .ui-chat-card__row, .ui-confirm > summary, button, a')].filter((el) => {
  if (el.tagName === 'INPUT') return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && (box.height < 44 || box.width < 44);
}).map((el) => ({ text: el.textContent?.trim().slice(0, 40), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))`;

const CARD = `document.querySelector('.request-screen')?.insertAdjacentHTML('afterbegin', '<section class="ui-chat-card" aria-label="Your stays"><div class="ui-chat-card__head"><h3 class="ui-chat-card__title">Your stays</h3><p class="ui-chat-card__aside">Needs your action first</p></div><div class="ui-chat-card__rows"><a class="ui-chat-card__row" href="#"><b>Ikoyi apartment · Payment by 3 Sept</b><span class="ui-chat-card__aside">Pay by 11:20 am WAT</span><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1 12h14M9 18l6-6-6-6"/></svg></a><div class="ui-chat-card__row"><b>Lekki studio · Confirmed</b></div></div><div class="ui-chat-card__action"><a class="ui-button ui-button--secondary" href="#">Open all 2 in Your stays</a></div></section><details class="ui-confirm" open><summary>Decline this transfer…</summary><div class="ui-confirm__body"><div class="ui-effect"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><p class="ui-effect__title">What this changes</p><p class="ui-effect__body">Makes the Reservation and tells the Guest it is declined.</p></div></div></details>')`;

await withStagePage(stage, async ({ fixture, path, threadId }) => {
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    for (const [name, route] of [
      ["chat", `/?threadId=${threadId}`],
      ["page", path],
    ]) {
      for (const width of [320, 390, 768, 1280]) {
        const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
        await size(900);
        await tab.navigate(`${fixture.base}${route}`);
        await tab.waitForFunction("document.readyState === 'complete'", 10_000);
        await tab.waitForFunction("document.querySelector('.ui-action-bar, .request-actions') !== null", 10_000);
        if (withCard && name === "chat") await tab.evaluate(CARD);
        await tab.evaluate("document.fonts.ready.then(() => true)");
        for (const theme of ["light", "dark"] as const) {
          await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          const info = await tab.evaluate<{ height: number; overflow: number }>("({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth - innerWidth })");
          assert.ok(info.overflow <= 0, `${name}/${theme}/${width}: horizontal overflow ${info.overflow}px`);
          await size(Math.min(info.height, 4000));
          await new Promise((resolve) => setTimeout(resolve, 200));
          const small = await tab.evaluate<unknown[]>(TARGETS);
          assert.deepEqual(small, [], `${name}/${theme}/${width}: target under 44px`);
          const label = withCard && name === "chat" ? "chat-card" : name;
          writeFileSync(`${directory}/${label}-${theme}-${width}.png`, await tab.captureScreenshot());
          console.log(`${label}/${theme}/${width}: height ${info.height}, no overflow, targets pass`);
      }
      }
    }
  } finally {
    await browser.close();
  }
});

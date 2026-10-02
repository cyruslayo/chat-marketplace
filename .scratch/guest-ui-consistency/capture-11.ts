// Issue 11 AC2: every design screen at 320/390/768/1280, light and dark, into screenshots/final/. Reports horizontal overflow and
// controls under 44px (the check from design/check.mts, widened to the live shell). Run: npx tsx .scratch/guest-ui-consistency/capture-11.ts [name...]
import { mkdirSync, writeFileSync } from "node:fs";
import { launchRealBrowser, type RealBrowserTab } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { withRequestScreen, type RequestScreenState } from "../../test/helpers/guest-request-screen.js";
import { withStagePage, type StagePageSpec } from "../../test/helpers/guest-stage-pages.js";
import { multipartBody, TEST_RECEIPTS } from "../../test/helpers/guest-payment-page.js";

const out = ".scratch/guest-ui-consistency/screenshots/final";
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const wanted = (name: string) => only.length === 0 || only.some((prefix) => name.startsWith(prefix));
const SEARCH = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
const LAGOS = "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people";
const SEARCH_PAGE = "/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2";

const findings: string[] = [];
const SMALL = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link') || el.classList.contains('sr-only')) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5); }).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height))`;

async function shoot(tab: RealBrowserTab, name: string, options: { readonly fixedHeight?: boolean } = {}): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      const size = (height: number) => (width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height));
      await size(width >= 1280 ? 800 : 900);
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await tab.evaluate("document.fonts.ready.then(() => true)");
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!options.fixedHeight) await size(Math.min(4000, Math.max(800, await tab.evaluate<number>("document.documentElement.scrollHeight"))));
      const { overflow, small } = await tab.evaluate<{ overflow: number; small: string[] }>(`({ overflow: document.documentElement.scrollWidth - innerWidth, small: ${SMALL} })`);
      const label = `${name}-${theme}-${width}`;
      if (overflow > 0) findings.push(`${label}: horizontal overflow ${overflow}px`);
      if (small.length) findings.push(`${label}: small controls: ${small.join(" | ")}`);
      writeFileSync(`${out}/${label}.png`, await tab.captureScreenshot());
    }
  }
  console.log(`captured ${name}`);
}

async function load(tab: RealBrowserTab, url: string, selector: string, scripts = true): Promise<void> {
  await tab.setJavaScriptEnabled(scripts);
  await tab.setViewport(1280, 800);
  await tab.navigate(url);
  await tab.waitForSelector(selector, 15_000);
  await tab.waitForFunction("document.readyState === 'complete'", 10_000);
}

async function ask(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.focus("#composer-input");
  await tab.insertText(text);
  await tab.pressKey("Enter");
}

const browser = await launchRealBrowser();
try {
  // Compare needs a fresh guest (two Lagos stays).
  if (wanted("chat-compare")) {
    const fixture = await restartFixture();
    try {
      const tab = await browser.createTab();
        await load(tab, `${fixture.base}/`, "#composer-input");
        await ask(tab, LAGOS);
        await tab.waitForSelector("#active-workspace .ui-stay-card .stay-card__compare", 15_000);
        await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[0].click()");
        await tab.waitForFunction("document.querySelector('#active-workspace .stay-card__compare')?.textContent.trim() === 'Remove from compare'", 15_000);
        await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[1].click()");
        await tab.waitForSelector("#active-workspace .ui-compare", 15_000);
        await shoot(tab, "chat-compare", { fixedHeight: true });
      await tab.close();
    } finally {
      await fixture.close();
    }
  }

  // Chat-first screens on a fresh guest: home, results, compare, unit detail, search page.
  {
    const fixture = await restartFixture();
    try {
      const tab = await browser.createTab();
      if (wanted("chat-home")) {
        await load(tab, `${fixture.base}/`, "#composer-input");
        await shoot(tab, "chat-home", { fixedHeight: true });
      }
      if (wanted("chat-results") || wanted("chat-unit")) {
        await load(tab, `${fixture.base}/`, "#composer-input");
        await ask(tab, SEARCH);
        await tab.waitForSelector("#active-workspace .stay-card", 15_000);
        if (wanted("chat-results")) await shoot(tab, "chat-results", { fixedHeight: true });
        if (wanted("chat-unit")) {
          await tab.clickButton("View apartment");
          await tab.waitForSelector("#active-workspace .unit-detail-root", 15_000);
          await shoot(tab, "chat-unit", { fixedHeight: true });
        }
      }
      if (wanted("search-page")) {
        await load(tab, `${fixture.base}${SEARCH_PAGE}`, ".ui-stay-card");
        await shoot(tab, "search-page");
      }
      if (wanted("unit-page")) {
        await load(tab, `${fixture.base}${SEARCH_PAGE}`, ".ui-stay-card");
        const href = await tab.evaluate<string>("document.querySelector('.ui-stay-card a[href^=\"/stays/\"]').getAttribute('href')");
        await load(tab, `${fixture.base}${href}`, ".unit-detail-sheet");
        await shoot(tab, "unit-page");
      }
      await tab.close();
    } finally {
      await fixture.close();
    }
  }

  // Request screens: page and chat.
  for (const state of ["draft", "review", "sent", "declined", "expired"] as RequestScreenState[]) {
    if (!wanted(`request-${state}`)) continue;
    await withRequestScreen(state, async (fixture, path) => {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await load(tab, `${fixture.base}${path}`, ".request-screen");
      await shoot(tab, `request-${state}-page`);
      await load(tab, `${fixture.base}/?threadId=${fixture.threadId}`, "#active-workspace .request-screen");
      await shoot(tab, `request-${state}-chat`, { fixedHeight: true });
      await tab.close();
    });
  }

  // Offer, payment and confirmation screens.
  const stages: readonly { readonly name: string; readonly spec: StagePageSpec; readonly selector: string; readonly prepare?: (context: Parameters<Parameters<typeof withStagePage>[1]>[0]) => Promise<void> }[] = [
    { name: "offer-live", spec: { label: "Offer", stage: "offer" }, selector: ".offer-screen" },
    { name: "offer-expired", spec: { label: "Offer expired", stage: "offer", beforeRead: (fixture) => fixture.setTime("2026-10-20T10:00:00Z") }, selector: ".offer-screen" },
    { name: "payment-choice", spec: { label: "Payment choice", stage: "payment-ready" }, selector: ".payment-screen" },
    { name: "bank-transfer", spec: { label: "Provider bank transfer", stage: "payment-ready", start: "transfer" }, selector: ".payment-screen" },
    { name: "manual-transfer", spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" }, selector: ".payment-screen" },
    {
      name: "manual-waiting",
      spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" },
      selector: ".payment-screen",
      prepare: async ({ fixture, path }) => {
        const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
        await fetch(`${fixture.base}${path}/receipt`, { method: "POST", headers: { cookie: fixture.cookie, accept: "text/html", "content-type": form.contentType }, body: new Uint8Array(form.body), redirect: "manual" });
      },
    },
    { name: "no-reservation", spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer", beforeRead: (fixture) => fixture.setTime("2026-09-03T13:00:00Z") }, selector: ".payment-screen" },
    { name: "confirmed", spec: { label: "Confirmed", stage: "confirmed" }, selector: ".confirmed-screen" },
  ];
  for (const stage of stages) {
    if (!wanted(stage.name) && !(stage.name === "confirmed" && (wanted("error-page") || wanted("no-js")))) continue;
    await withStagePage(stage.spec, async (context) => {
      await stage.prepare?.(context);
      const { fixture, path, threadId } = context;
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      if (wanted(stage.name)) {
        await load(tab, `${fixture.base}${path}`, stage.selector);
        await shoot(tab, `${stage.name}-page`);
        // The chat workspace shows only some of these stages (the rest are standalone pages); skip a chat capture that never renders.
        const inChat = await load(tab, `${fixture.base}/?threadId=${threadId}`, `#active-workspace ${stage.selector}`).then(() => true, () => false);
        if (inChat) await shoot(tab, `${stage.name}-chat`, { fixedHeight: true });
        else console.log(`${stage.name}: no chat workspace for this stage`);
      }
      if (stage.name === "confirmed") {
        if (wanted("error-page")) {
          await load(tab, `${fixture.base}/booking-contracts/missing`, ".ui-empty");
          await shoot(tab, "error-page");
        }
        if (wanted("no-js")) {
          await load(tab, `${fixture.base}/conversation?threadId=${threadId}`, ".no-js-conversation", false);
          await shoot(tab, "no-js-conversation");
        }
      }
      await tab.close();
    });
  }
} finally {
  await browser.close();
}
writeFileSync(`${out}/findings${only.length ? `-${only.join("-")}` : ""}.txt`, `${findings.join("\n")}\n`);
console.log(findings.length ? `\n${findings.length} findings:\n${findings.join("\n")}` : "\nno overflow, no small controls");

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";

const out = join(process.cwd(), ".scratch/ui-phase2-guest-shell");
mkdirSync(out, { recursive: true });
const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath: join(out, "screenshots.sqlite") }) });
const port = await server.listen();
const browser = await launchRealBrowser({ headless: true });
const base = `http://127.0.0.1:${port}/`;
const save = async (tab: Awaited<ReturnType<typeof browser.createTab>>, name: string) => writeFileSync(join(out, name), await tab.captureScreenshot());
const newTab = async (width: number, height: number) => { const tab = await browser.createTab(); await tab.setViewport(width, height); await tab.navigate(base); await tab.waitForSelector("#composer-input"); await tab.waitForText("Find a place to stay"); return tab; };
const submit = async (tab: Awaited<ReturnType<typeof browser.createTab>>, text: string) => { await tab.evaluate(`(() => { const input = document.querySelector('#composer-input'); input.value = ${JSON.stringify(text)}; document.querySelector('#composer').requestSubmit(); })()`); };
try {
  const home390 = await newTab(390, 844);
  await save(home390, "01-empty-home-390.png");
  await submit(home390, "I need an apartment in Ikoyi for 3 nights for 2 people");
  await home390.waitForText("eligible place");
  await save(home390, "02-discovery-workspace-390.png");
  await home390.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi");
  await home390.waitForText("Request to Book");
  await save(home390, "03-history-after-refinement-390.png");
  await save(home390, "04-unit-detail-workspace-390.png");
  await home390.clickButton("Request to Book");
  await home390.waitForText("Review Request");
  await home390.clickButton("Review Request");
  await home390.waitForText("Submit Booking Request");
  await save(home390, "05-request-review-history-390.png");

  const loading = await newTab(390, 844);
  await submit(loading, "I need an apartment in Ikoyi for 3 nights for 2 people");
  await loading.waitForText("eligible place");
  await loading.evaluate("(() => { const original = window.fetch.bind(window); window.fetch = (input, init) => String(input).includes('/api/turn') ? new Promise(() => {}) : original(input, init); })()");
  await submit(loading, "Please check another area");
  await loading.waitForText("Working on your request");
  await save(loading, "06-loading-state.png");

  const failed = await newTab(390, 844);
  await submit(failed, "I need an apartment in Ikoyi for 3 nights for 2 people");
  await failed.waitForText("eligible place");
  await failed.setOffline(true);
  await submit(failed, "Check another neighbourhood");
  await failed.waitForText("temporarily unavailable");
  await save(failed, "07-error-or-fallback-state.png");

  const home320 = await newTab(320, 700);
  await save(home320, "08-home-320.png");
  await submit(home320, "I need an apartment in Ikoyi for 3 nights for 2 people");
  await home320.waitForText("eligible place");
  await save(home320, "09-workspace-320.png");

  const tablet = await newTab(768, 900);
  await save(tablet, "11-home-768.png");
  await submit(tablet, "I need an apartment in Ikoyi for 3 nights for 2 people");
  await tablet.waitForText("eligible place");
  await save(tablet, "12-workspace-768.png");

  const desktop = await newTab(1280, 900);
  await save(desktop, "10-desktop-1280.png");
  const metrics = await desktop.evaluate("({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, label: document.querySelector('label[for=\"composer-input\"]')?.textContent, headings: [...document.querySelectorAll('h1,h2')].map((h) => `${h.tagName}: ${h.textContent}`), visibleControls: [...document.querySelectorAll('button,a,input')].filter((element) => element.getClientRects().length).length })");
  writeFileSync(join(out, "browser-a11y-layout-evidence.json"), JSON.stringify(metrics, null, 2));

  const focus = await newTab(390, 844);
  await focus.pressKey("Tab");
  await save(focus, "13-keyboard-focus-visible.png");
  const focusState = await focus.evaluate("({ active: document.activeElement?.textContent, outline: getComputedStyle(document.activeElement).outlineStyle, outlineWidth: getComputedStyle(document.activeElement).outlineWidth })");
  writeFileSync(join(out, "focus-evidence.json"), JSON.stringify(focusState, null, 2));
  for (const tab of [home390, loading, failed, home320, tablet, desktop, focus]) await tab.close();
} finally {
  await browser.close();
  await server.close();
}



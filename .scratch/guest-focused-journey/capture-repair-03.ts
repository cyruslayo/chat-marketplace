import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withRequestScreen } from "../../test/helpers/guest-request-screen.js";
import { launchRealBrowser, type RealBrowserTab } from "../../test/helpers/chrome-devtools.js";
const out = ".scratch/guest-focused-journey/screenshots/03";
mkdirSync(out, { recursive: true });
async function capture(tab: RealBrowserTab, name: string) {
  for (const theme of ["light", "dark"]) for (const width of [320, 390, 768, 1280]) {
    await tab.setViewport(width, 900);
    await tab.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${name}/${theme}/${width}: overflow`);
    const small = await tab.evaluate<string[]>(`[...document.querySelectorAll('.request-edit a, .request-edit button, .request-edit summary, .request-edit input:not([type="hidden"]), #phoneNumber, button[type="submit"]')].filter(el => { const r=el.getBoundingClientRect(); return r.width && r.height && (r.width<43.5 || r.height<43.5); }).map(el => el.textContent || el.id)`);
    assert.deepEqual(small, [], `${name}/${theme}/${width}: small controls`);
    writeFileSync(`${out}/${name}-${theme}-${width}.png`, await tab.captureScreenshot());
  }
  console.log(`${name}: 8 captures; reflow and targets pass`);
}
await withRequestScreen("review", async (fixture, path) => {
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    for (const [name, route] of [["review-editor-page", path], ["review-editor-chat", `/?threadId=${fixture.threadId}`]]) {
      await tab.navigate(`${fixture.base}${route}`);
      await tab.waitForSelector(".request-edit", 15000);
      await tab.waitForFunction("document.readyState === 'complete'", 15000);
      await tab.evaluate("document.querySelectorAll('.request-edit details').forEach(el => el.open = true)");
      await capture(tab, name!);
    }
    await tab.navigate(`${fixture.base}/guest/contact?kind=phone&returnTo=${encodeURIComponent(path)}`);
    await tab.waitForSelector("#phoneNumber", 15000);
    await capture(tab, "phone-entry");
    await tab.evaluate("document.querySelector('#phoneNumber').value='08012'; document.querySelector('#phoneNumber').form.requestSubmit()");
    await tab.waitForSelector("#phoneNumber-error", 15000);
    await capture(tab, "phone-error");
  } finally { await browser.close(); }
});

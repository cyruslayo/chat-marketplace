/**
 * Weaver catalogues issue 07 parity probe: opens the two-stay comparison in the chat and prints its DOM (the
 * `#active-workspace .weaver-mount` subtree, one tag per line) so the decorator output and the typed-component output
 * can be diffed. Usage: SHORTLET_CHROME_PATH=... npx tsx .scratch/weaver-catalogues/dump-compare.ts > out.html
 */
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const fixture = await restartFixture();
const browser = await launchRealBrowser();
try {
  const tab = await browser.createTab();
  await tab.setViewport(390, 900);
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
  await tab.waitForSelector("#composer-input", 15_000);
  await tab.focus("#composer-input");
  await tab.insertText("I need an apartment in Lagos from 10 Sept for 3 nights for 2 people");
  await tab.pressKey("Enter");
  await tab.waitForSelector("#active-workspace .ui-stay-card .stay-card__compare", 15_000);
  await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[0].click()");
  await tab.waitForFunction("document.querySelector('#active-workspace .stay-card__compare')?.textContent.trim() === 'Remove from compare'", 15_000);
  await tab.evaluate("document.querySelectorAll('#active-workspace .stay-card__compare')[1].click()");
  await tab.waitForSelector("#active-workspace .ui-compare", 15_000);
  const html = await tab.evaluate<string>(`document.querySelector("#active-workspace .weaver-mount").outerHTML.replace(/>\\s+</g, "><")`);
  process.stdout.write(`${html.replace(/g-[0-9a-f-]{36}/g, "g-THREAD").replace(/search-[a-z0-9-]+/g, "search-ID").replaceAll("><", ">\n<")}\n`);
} finally {
  await browser.close();
  await fixture.close();
}

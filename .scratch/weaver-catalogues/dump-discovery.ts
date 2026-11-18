/**
 * Weaver catalogues issue 06 parity probe: searches in the chat and prints the discovery surface's DOM (the
 * `#active-workspace .weaver-mount` subtree, one tag per line) so the decorator output and the typed-component output
 * can be diffed. Usage: SHORTLET_CHROME_PATH=... npx tsx .scratch/weaver-catalogues/dump-discovery.ts "<search>" > out.html
 */
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const search = process.argv[2] ?? "I need an apartment in Lagos from 10 Sept for 3 nights for 2 people";
const fixture = await restartFixture();
const browser = await launchRealBrowser();
try {
  const tab = await browser.createTab();
  await tab.setViewport(390, 900);
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
  await tab.waitForSelector("#composer-input", 15_000);
  await tab.focus("#composer-input");
  await tab.insertText(search);
  await tab.pressKey("Enter");
  await tab.waitForSelector("#active-workspace .ui-stay-card", 15_000);
  const html = await tab.evaluate<string>(`document.querySelector("#active-workspace .weaver-mount").outerHTML.replace(/>\\s+</g, "><")`);
  // Thread and artifact ids differ per run; blank them so a diff shows only markup changes.
  process.stdout.write(`${html.replace(/g-[0-9a-f-]{36}/g, "g-THREAD").replace(/discovery-[0-9a-f-]{36}/g, "discovery-ID").replaceAll("><", ">\n<")}\n`);
} finally {
  await browser.close();
  await fixture.close();
}

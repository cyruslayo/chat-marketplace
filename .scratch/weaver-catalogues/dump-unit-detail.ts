/**
 * Weaver catalogues issue 05 parity probe: prints the chat unit-detail DOM (the `#active-workspace .weaver-mount`
 * subtree, whitespace between tags removed) so the organizer output and the typed-component output can be diffed.
 * Usage: SHORTLET_CHROME_PATH=... npx tsx .scratch/weaver-catalogues/dump-unit-detail.ts > out.html
 */
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const fixture = await restartFixture();
const browser = await launchRealBrowser();
try {
  await fixture.advance("inspection");
  const tab = await browser.createTab();
  await tab.setViewport(390, 900);
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
  await tab.waitForSelector("#active-workspace .unit-detail-sheet .ui-tiles", 15_000);
  const html = await tab.evaluate<string>(`document.querySelector("#active-workspace .weaver-mount").outerHTML.replace(/>\\s+</g, "><")`);
  process.stdout.write(`${html.replaceAll("><", ">\n<")}\n`);
} finally {
  await browser.close();
  await fixture.close();
}

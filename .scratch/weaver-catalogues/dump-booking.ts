/**
 * Weaver catalogues issue 04 parity probe: for each booking stage, opens the chat at 390px and prints the workspace's
 * `.ui-ticket` and `.ui-price-breakdown` (whitespace between tags removed) so the organizer output and the typed-component
 * output can be diffed. Usage: SHORTLET_CHROME_PATH=... npx tsx .scratch/weaver-catalogues/dump-booking.ts > out.txt
 */
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const STAGES = ["draft", "review", "pending", "offer", "payment-ready", "handoff", "deposit-ready", "deposit-handoff", "confirmed"] as const;
const browser = await launchRealBrowser();
try {
  for (const stage of STAGES) {
    const fixture = await restartFixture({}, { localPayment: true });
    try {
      await fixture.advance(stage);
      const tab = await browser.createTab();
      await tab.setViewport(390, 900);
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector('#active-workspace .weaver-mount[data-renderer="weaver"], #active-workspace .surface-fallback', 15_000);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const html = await tab.evaluate<string>(`(() => {
        const pick = (selector) => [...document.querySelectorAll("#active-workspace " + selector)].map((element) => element.outerHTML.replace(/>\\s+</g, "><")).join("\\n") || "(none)";
        return "ticket: " + pick(".ui-ticket") + "\\nbreakdown: " + pick(".ui-price-breakdown") + "\\nkind: " + (document.querySelector("#active-workspace .weaver-mount")?.dataset.surfaceKind ?? "?");
      })()`);
      process.stdout.write(`== ${stage}\n${html}\n`);
      await tab.close();
    } finally {
      await fixture.close();
    }
  }
} finally {
  await browser.close();
}

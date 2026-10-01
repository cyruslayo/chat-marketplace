import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { withStagePage, type StagePageSpec } from "../../test/helpers/guest-stage-pages.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { multipartBody, TEST_RECEIPTS } from "../../test/helpers/guest-payment-page.js";

// Captures every issue-09 payment screen (light) at four widths, checking reflow and 44px targets.
const directory = ".scratch/guest-ui-consistency/screenshots/09";
mkdirSync(directory, { recursive: true });

const screens: readonly { readonly name: string; readonly spec: StagePageSpec; readonly prepare?: (context: Parameters<Parameters<typeof withStagePage>[1]>[0]) => Promise<void>; readonly chat?: boolean }[] = [
  { name: "choice", spec: { label: "Payment choice", stage: "payment-ready" }, chat: true },
  { name: "bank-transfer", spec: { label: "Provider bank transfer", stage: "payment-ready", start: "transfer" } },
  { name: "bank-transfer-expired", spec: { label: "Provider bank transfer", stage: "payment-ready", start: "transfer", beforeRead: (fixture) => fixture.setTime("2026-09-03T10:30:00Z") } },
  { name: "manual-transfer", spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" } },
  {
    name: "manual-waiting",
    spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" },
    prepare: async ({ fixture, path }) => {
      const form = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
      await fetch(`${fixture.base}${path}/receipt`, { method: "POST", headers: { cookie: fixture.cookie, accept: "text/html", "content-type": form.contentType }, body: new Uint8Array(form.body), redirect: "manual" });
    },
  },
  { name: "manual-no-reservation", spec: { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer", beforeRead: (fixture) => fixture.setTime("2026-09-03T13:00:00Z") } },
];

const browser = await launchRealBrowser();
try {
  for (const screen of screens) {
    await withStagePage(screen.spec, async (context) => {
      await screen.prepare?.(context);
      const { fixture, path, threadId } = context;
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      for (const [kind, route] of [["page", path], ...(screen.chat ? [["chat", `/?threadId=${threadId}`]] : [])] as const) {
        for (const width of [320, 390, 768, 1280]) {
          await tab.setViewport(width, 900);
          await tab.navigate(`${fixture.base}${route}`);
          await tab.waitForSelector(".payment-screen", 10_000);
          await tab.evaluate("document.fonts.ready.then(() => true)");
          await tab.evaluate("document.documentElement.dataset.theme = 'light'");
          const height = await tab.evaluate<number>("document.documentElement.scrollHeight");
          await tab.setViewport(width, Math.min(4000, height));
          assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${screen.name}/${kind}/${width}: overflow`);
          const small = await tab.evaluate<unknown[]>("[...document.querySelectorAll('.payment-screen button:not([hidden]), .payment-screen a.ui-button')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => ({ text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }))");
          assert.deepEqual(small, [], `${screen.name}/${kind}/${width}: target under 44px`);
          writeFileSync(`${directory}/${screen.name}-${kind}-light-${width}.png`, await tab.captureScreenshot());
        }
      }
      await tab.close();
      console.log(`${screen.name}: reflow and targets pass`);
    });
  }
} finally {
  await browser.close();
}

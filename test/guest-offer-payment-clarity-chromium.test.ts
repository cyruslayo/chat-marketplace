import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

test("AC3: chat and conventional payment choices expose one named radio group with method restrictions and preserve card command binding", async () => {
  for (const method of ["card", "manual_transfer"] as const) {
    await withStagePage({ label: "payment choice", stage: "payment-ready" }, async ({ fixture, path }) => {
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setViewport(390, 900);
        const [cookieName, ...cookieValue] = fixture.cookie.split("=");
        await tab.setCookie(cookieName!, cookieValue.join("="), fixture.base);
        await tab.setExtraHeaders({ cookie: fixture.cookie });
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .payment-choice-form", 15000);
        await tab.waitForFunction("document.readyState === 'complete'", 15000);
        const parity = await tab.evaluate<{ chat: string; page: string }>(`(async () => {
          const page = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(path)})).text(), 'text/html');
          return { chat: document.querySelector('#active-workspace fieldset').outerHTML, page: page.querySelector('fieldset').outerHTML };
        })()`);
        assert.equal(parity.chat, parity.page);
        const ax = await tab.getAccessibilityTree();
        assert.deepEqual(ax.filter(node => node.role === "radio").map(node => node.name).sort(), ["Bank transfer", "Card", "Manual bank transfer"]);
        assert.equal(ax.filter(node => node.role === "group" && node.name === "Payment method").length, 1);
        assert.equal(await tab.evaluate<boolean>("[...document.querySelectorAll('#active-workspace .payment-choice-methods > label')].every(label => { const r = label.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })"), true);
        await tab.evaluate(`document.querySelector('#active-workspace input[value=${JSON.stringify(method)}]').checked = true`);
        assert.equal(await tab.clickButton("Continue to stay payment"), true);
        await tab.waitForText(method === "card" ? "Payment handoff" : "Transfer and upload your receipt", 15000);
        assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1);
      } finally { await browser.close(); }
    });
  }
});

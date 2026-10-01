import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";
import { guestPaymentPage } from "./helpers/guest-payment-page.js";

// Guest UI consistency issue 09 in real Chromium: the chat workspace and the conventional page share one payment layout.

const SHOTS = ".scratch/guest-ui-consistency/screenshots/09";

test("AC1: the pending payment renders the same head, ticket, breakdown and steps in the chat workspace and on the payment page", async () => {
  await withStagePage({ label: "Payment choice", stage: "payment-ready" }, async ({ fixture, path }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.setViewport(390, 900);
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .payment-screen", 10_000);
      const parity = await tab.evaluate<{ chat: (string | null)[]; page: (string | null)[]; chatBanner: string; pageBanner: string }>(`(async () => {
        const page = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(path)})).text(), 'text/html');
        const sections = root => ['.payment-head', '.ui-ticket', '.ui-price-breakdown', '.payment-explanation', '.payment-steps'].map(selector => root.querySelector(selector)?.outerHTML.replace(/\\s+/g, ' ') ?? null);
        const banner = root => (root.querySelector('.payment-deadline')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return { chat: sections(document.querySelector('#active-workspace')), page: sections(page), chatBanner: banner(document.querySelector('#active-workspace')), pageBanner: banner(page) };
      })()`);
      assert.ok(parity.chat.every(Boolean), "every shared section is in the chat");
      const plain = (html: string | null) => html?.replace(/ datetime="[^"]*"/g, "") ?? null;
      for (let i = 0; i < parity.chat.length; i++) assert.equal(plain(parity.chat[i]!), plain(parity.page[i]!), `section ${i}`);
      assert.match(parity.chatBanner, /^Pay by .+ WAT, .+ · \d+ minutes? left$/);
      assert.equal(parity.chatBanner, parity.pageBanner);
      await mkdir(SHOTS, { recursive: true });
      await writeFile(`${SHOTS}/chat-payment-ready.png`, await tab.captureScreenshot());
      for (const width of [320, 390, 768, 1280]) {
        await tab.setViewport(width, 900);
        assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `no overflow at ${width}`);
      }
      await tab.setViewport(390, 900);
      await tab.navigate(`${fixture.base}${path}`);
      await writeFile(`${SHOTS}/page-payment-choice.png`, await tab.captureScreenshot());
    } finally { await browser.close(); }
  });
});

test("AC3: payment surfaces in the chat show one warning banner with the absolute time and minutes left, and no waiting panel or info box", async () => {
  await withStagePage({ label: "Payment choice", stage: "payment-ready" }, async ({ fixture }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      await tab.setExtraHeaders({ cookie: fixture.cookie });
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .payment-screen", 10_000);
      const state = await tab.evaluate<{ panels: number; info: number; warning: string; time: string }>(`({
        panels: document.querySelectorAll('#active-workspace .waiting-panel').length,
        info: document.querySelectorAll('#active-workspace .ui-banner--info').length,
        warning: document.querySelector('#active-workspace .ui-banner--warning.payment-deadline')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        time: document.querySelector('#active-workspace .payment-deadline time')?.textContent ?? '',
      })`);
      assert.equal(state.panels, 0);
      assert.equal(state.info, 0);
      assert.match(state.warning, /WAT, .+ · \d+ minutes? left/);
      assert.match(state.time, /WAT/);
      // The countdown ticks from the server's clock and the Weaver action stays bound to the server event.
      assert.equal(await tab.evaluate<boolean>("document.querySelectorAll('#active-workspace .payment-actions button').length === 1"), true);

      // The minutes left come from the server's clock, so a later server time shows fewer minutes.
      fixture.setTime("2026-09-03T10:12:00Z");
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .payment-screen", 10_000);
      const later = Number(/(\d+) minutes? left/.exec(await tab.evaluate<string>("document.querySelector('#active-workspace .payment-deadline').textContent"))?.[1]);
      const earlier = Number(/(\d+) minutes? left/.exec(state.warning)?.[1]);
      assert.ok(later < earlier, `${later} < ${earlier}`);
    } finally { await browser.close(); }
  });
});

test("AC4: the copy button on the bank transfer page copies the account number and announces it, and stays hidden without JavaScript", async () => {
  const g = await guestPaymentPage();
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  try {
    assert.equal((await g.post(`${g.paymentPage}/transfer`)).status, 303);
    const account = g.env.bankTransferApp!.manager.getSession(g.offerId)!.accountNumber;
    await tab.setExtraHeaders({ cookie: g.cookie });
    await tab.navigate(`${g.base}${g.paymentPage}/transfer`);
    await tab.waitForFunction("document.querySelector('.bank-details button[data-copy-text]') && !document.querySelector('.bank-details button[data-copy-text]').hidden", 10_000);
    await tab.evaluate("(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } }); })()");
    await tab.evaluate("document.querySelector('.bank-details button[data-copy-text]').click()");
    await tab.waitForFunction("document.querySelector('.bank-details [data-copy-status]').textContent === 'Account number copied'", 5_000);
    assert.deepEqual(await tab.evaluate<string[]>("window.__copied"), [account]);
    await mkdir(SHOTS, { recursive: true });
    await writeFile(`${SHOTS}/page-bank-transfer.png`, await tab.captureScreenshot());

    await tab.setJavaScriptEnabled(false);
    await tab.navigate(`${g.base}${g.paymentPage}/transfer`);
    await tab.waitForText(account, 10_000);
    assert.equal(await tab.evaluate<boolean>("document.querySelector('.bank-details button[data-copy-text]').hidden"), true);
  } finally {
    await tab.close();
    await browser.close();
    await g.close();
  }
});

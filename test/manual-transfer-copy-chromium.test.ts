import test from "node:test";
import assert from "node:assert/strict";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { TEST_MANUAL_ACCOUNT, guestPaymentPage } from "./helpers/guest-payment-page.js";

// Warm editorial pass: the manual bank transfer page's "Copy account number" button, in real Chromium.

const copyState = `(() => { const button = document.querySelector('button[data-copy-text]'); const status = document.querySelector('[data-copy-status]'); return { shown: !!button && !button.hidden && getComputedStyle(button).display !== 'none', status: status?.textContent ?? null }; })()`;

test("The Copy account number button copies the number and announces it, fails with a readable message, and stays hidden without JavaScript", async () => {
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  try {
    const manualPage = `${g.base}${g.paymentPage}/manual-transfer`;
    assert.equal((await g.post(`${g.paymentPage}/manual-transfer`)).status, 303);
    await tab.setExtraHeaders({ cookie: g.cookie });

    // Success: /payment.js reveals the button, and a click puts the account number on the clipboard.
    await tab.navigate(manualPage);
    await tab.waitForFunction(`${copyState}.shown`, 10_000);
    await tab.evaluate(`(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } }); })()`);
    await tab.evaluate("document.querySelector('button[data-copy-text]').click()");
    await tab.waitForFunction(`${copyState}.status === 'Account number copied'`, 5_000);
    assert.deepEqual(await tab.evaluate<string[]>("window.__copied"), [TEST_MANUAL_ACCOUNT.accountNumber]);
    assert.equal(await tab.evaluate<string | null>("document.querySelector('[data-copy-status]').getAttribute('role')"), "status");

    // Failure path: a refused clipboard says how to copy by hand instead of failing silently.
    await tab.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } })`);
    await tab.evaluate("document.querySelector('button[data-copy-text]').click()");
    await tab.waitForFunction(`${copyState}.status === 'Copying is not available. Select the account number to copy it.'`, 5_000);

    // Without JavaScript (ADR 0080) there is no dead button; the number is still on the page as text.
    await tab.setJavaScriptEnabled(false);
    await tab.navigate(manualPage);
    await tab.waitForText(TEST_MANUAL_ACCOUNT.accountNumber, 10_000);
    assert.equal((await tab.evaluate<{ shown: boolean }>(copyState)).shown, false);
  } finally {
    await tab.close();
    await browser.close();
    await g.close();
  }
});

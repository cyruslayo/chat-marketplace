import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ACCOUNT_COPY } from "../apps/web-agent/src/guest-content.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { CapturingEmailSender, accountFixture } from "./helpers/guest-account-sign-in.js";

const EMAIL = "ada@example.test";
const NEW_EMAIL = "ada.new@example.test";
/** ADR 0078: the four launch widths, with the 320px floor. */
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 800]] as const;

/** No horizontal page scroll, and every visible control at least 44 CSS pixels (ADR 0078). */
async function assertReflowAndTargets(tab: RealBrowserTab, label: string): Promise<void> {
  const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  assert.equal(overflow, false, `${label}: no horizontal page overflow`);
  const small = await tab.evaluate<string[]>(`Array.from(document.querySelectorAll('main a, main button, main input:not([type=hidden])'))
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
    .filter((element) => element.getBoundingClientRect().height < 44 && !element.matches('input[type=radio], input[type=checkbox]'))
    .map((element) => element.outerHTML.slice(0, 80))`);
  assert.deepEqual(small, [], `${label}: every control is at least 44px`);
}

test("AC5: the account page reflows at 320, 390, 768 and 1280 with no horizontal scroll and 44px controls, without JavaScript (real Chromium, JavaScript disabled)", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const browser = await launchRealBrowser();
  try {
    // Sign in through the no-JavaScript form, exactly as a Guest does.
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/account/sign-in?return=/account`);
    await tab.waitForSelector("#email", 10_000);
    await tab.focus("#email");
    await tab.insertText(EMAIL);
    assert.equal(await tab.clickButton(GUEST_ACCOUNT_COPY.sendCode), true);
    await tab.waitForSelector("#code", 10_000);
    await tab.focus("#code");
    await tab.insertText(sender.codeFor(EMAIL));
    assert.equal(await tab.clickButton(GUEST_ACCOUNT_COPY.checkCode), true);
    await tab.waitForFunction("location.pathname === '/account'", 10_000);

    for (const [width, height] of VIEWPORTS) {
      await tab.setViewport(width, height);
      await tab.navigate(`${fixture.base}/account`);
      await tab.waitForSelector("[data-account-state='signed-in']", 10_000);
      await assertReflowAndTargets(tab, `account page at ${width}px`);
    }
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3 and AC5: in real Chromium an invalid phone keeps the typed value and reflows at every launch width", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  try {
    for (const [width, height] of VIEWPORTS) {
      // A fresh browser per width: a shared profile keeps the first sign-in and links the next address to another account.
      const browser = await launchRealBrowser();
      try {
        const tab = await browser.createTab();
        await tab.setJavaScriptEnabled(false);
        await tab.setViewport(width, height);
        await tab.navigate(`${fixture.base}/account/sign-in?return=/account`);
        await tab.waitForSelector("#email", 10_000);
        await tab.focus("#email");
        await tab.insertText(`${width}-${EMAIL}`);
        await tab.clickButton(GUEST_ACCOUNT_COPY.sendCode);
        await tab.waitForSelector("#code", 10_000);
        await tab.focus("#code");
        await tab.insertText(sender.codeFor(`${width}-${EMAIL}`));
        await tab.clickButton(GUEST_ACCOUNT_COPY.checkCode);
        await tab.waitForFunction("location.pathname === '/account'", 10_000);
        await tab.waitForSelector("#phone", 10_000);
        await tab.focus("#phone");
        await tab.insertText("12345");
        await tab.clickButton(GUEST_ACCOUNT_COPY.savePhone);
        await tab.waitForSelector("#phone-error", 10_000);
        assert.equal(await tab.evaluate<string>("document.querySelector('#phone').value"), "12345", "the typed value is kept");
        await assertReflowAndTargets(tab, `phone error at ${width}px`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await fixture.close();
  }
});

test("AC2 and AC5: in real Chromium the email-change code step reflows at every launch width and keeps the new address", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/account/sign-in?return=/account`);
    await tab.waitForSelector("#email", 10_000);
    await tab.focus("#email");
    await tab.insertText(EMAIL);
    await tab.clickButton(GUEST_ACCOUNT_COPY.sendCode);
    await tab.waitForSelector("#code", 10_000);
    await tab.focus("#code");
    await tab.insertText(sender.codeFor(EMAIL));
    await tab.clickButton(GUEST_ACCOUNT_COPY.checkCode);
    await tab.waitForFunction("location.pathname === '/account'", 10_000);
    await tab.waitForSelector("#new-email", 10_000);
    await tab.focus("#new-email");
    await tab.insertText(NEW_EMAIL);
    await tab.clickButton(GUEST_ACCOUNT_COPY.changeEmailButton);
    await tab.waitForSelector("#code", 10_000);
    for (const [width, height] of VIEWPORTS) {
      await tab.setViewport(width, height);
      await assertReflowAndTargets(tab, `email code step at ${width}px`);
    }
    assert.equal(await tab.evaluate<string>("document.querySelector(\"input[name='email']\").value"), NEW_EMAIL, "the new address is kept on the code step");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

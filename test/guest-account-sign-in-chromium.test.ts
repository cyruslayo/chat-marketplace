import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ACCOUNT_COPY } from "../apps/web-agent/src/guest-content.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { CapturingEmailSender, accountFixture, wrongCodeFor } from "./helpers/guest-account-sign-in.js";

const EMAIL = "ada@example.test";
/** ADR 0078: the four launch widths, with the 320px floor. */
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 800]] as const;

/** No horizontal page scroll, and every visible control at least 44 CSS pixels (ADR 0078). */
async function assertReflowAndTargets(tab: RealBrowserTab, label: string): Promise<void> {
  const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  assert.equal(overflow, false, `${label}: no horizontal page overflow`);
  const small = await tab.evaluate<string[]>(`Array.from(document.querySelectorAll('main a, main button, main input:not([type=hidden]), main label'))
    .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
    .filter((element) => element.getBoundingClientRect().height < 44 && !element.matches('input[type=radio], input[type=checkbox]'))
    .map((element) => element.outerHTML.slice(0, 80))`);
  assert.deepEqual(small, [], `${label}: every control is at least 44px`);
}

test("AC1: Without JavaScript, a Guest can request a code, enter it and land back on the page they came from, signed in (real Chromium, JavaScript disabled)", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setJavaScriptEnabled(false);
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/account/sign-in?return=${encodeURIComponent("/stays/search")}`);
    await tab.waitForSelector("#email", 10_000);
    await assertReflowAndTargets(tab, "sign-in page at 390px");

    await tab.focus("#email");
    await tab.insertText(EMAIL);
    assert.equal(await tab.clickButton(GUEST_ACCOUNT_COPY.sendCode), true);
    await tab.waitForSelector("#code", 10_000);
    await assertReflowAndTargets(tab, "code page at 390px");

    await tab.focus("#code");
    await tab.insertText(sender.codeFor(EMAIL));
    assert.equal(await tab.clickButton(GUEST_ACCOUNT_COPY.checkCode), true);
    await tab.waitForFunction("location.pathname === '/stays/search'", 10_000);

    await tab.navigate(`${fixture.base}/account`);
    await tab.waitForSelector("[data-account-state='signed-in']", 10_000);
    const cookies = await tab.getCookies();
    const account = cookies.find((cookie) => cookie.name === "shortlet_guest_account");
    assert.ok(account?.httpOnly, "the account cookie is HttpOnly");
    assert.equal(account.sameSite, "Lax");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC1 failure path: in real Chromium a wrong code keeps the email and reports the error inline, at every launch width", async () => {
  const sender = new CapturingEmailSender();
  const { fixture } = await accountFixture({ sender });
  const browser = await launchRealBrowser();
  try {
    for (const [width, height] of VIEWPORTS) {
      const tab = await browser.createTab();
      await tab.setJavaScriptEnabled(false);
      await tab.setViewport(width, height);
      await tab.navigate(`${fixture.base}/account/sign-in`);
      await tab.waitForSelector("#email", 10_000);
      await tab.focus("#email");
      await tab.insertText(`${width}-${EMAIL}`);
      await tab.clickButton(GUEST_ACCOUNT_COPY.sendCode);
      await tab.waitForSelector("#code", 10_000);
      await tab.focus("#code");
      await tab.insertText(wrongCodeFor(sender.codeFor(`${width}-${EMAIL}`)));
      await tab.clickButton(GUEST_ACCOUNT_COPY.checkCode);
      await tab.waitForSelector("[role='alert']", 10_000);
      assert.equal(await tab.evaluate<string>("document.querySelector('#email').value"), `${width}-${EMAIL}`);
      await assertReflowAndTargets(tab, `code error page at ${width}px`);
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

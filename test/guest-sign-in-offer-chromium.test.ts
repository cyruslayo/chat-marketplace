import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_ACCOUNT_COPY } from "../apps/web-agent/src/guest-content.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { ACCOUNT_COOKIE, INTERACTION_COOKIE, accountFixture, cookieHeader, getJson } from "./helpers/guest-account-sign-in.js";
import { assertReflowAndTargets, sendRequest } from "./helpers/guest-browser.js";
import { OFFER_TEST_EMAIL, recordContactFor, routeFor, withOfferStageDevice } from "./helpers/sign-in-offer.js";

/** ADR 0078: the four launch widths, with the 320px floor. */
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1280, 800]] as const;

/** The visible text of the offer panel, with whitespace collapsed, so the chat and the page can be compared. */
async function offerTextOf(tab: RealBrowserTab): Promise<string> {
  return await tab.evaluate<string>("(document.querySelector('[data-sign-in-offer]')?.textContent ?? '').replace(/\\s+/g, ' ').trim()");
}

/** The conversation the chat is showing, as the chat itself stores it for the page. */
async function threadIdOf(tab: RealBrowserTab): Promise<string> {
  const threadId = await tab.evaluate<string>("sessionStorage.getItem('shortlet-concierge-thread') || ''");
  assert.match(threadId, /^g-/, "the chat has a conversation");
  return threadId;
}

/** The request or booking page the chat produced, from the device's own state (the same read the chat makes). */
async function standalonePathOf(tab: RealBrowserTab, base: string, prefix: string): Promise<string> {
  const interaction = (await tab.getCookies()).find((cookie) => cookie.name === INTERACTION_COOKIE);
  assert.ok(interaction, "the device holds its browser session");
  const state = await getJson(base, `/api/state?threadId=${await threadIdOf(tab)}`, cookieHeader({ [INTERACTION_COOKIE]: interaction.value }));
  const route = (state.body.surfaces as readonly { readonly conventionalRoute?: string }[])
    .map((surface) => surface.conventionalRoute)
    .find((candidate) => candidate?.startsWith(prefix));
  assert.ok(route, `the chat produced a ${prefix} page`);
  return route;
}

test("AC1: An anonymous Guest sees the offer on the request-sent and confirmation screens, in both the page and the chat workspace, with the same text. Parity test.", async () => {
  const { fixture } = await accountFixture();
  const browser = await launchRealBrowser();
  try {
    const chat = await sendRequest(browser, fixture, [390, 844], async (tab) => {
      recordContactFor(fixture, await threadIdOf(tab));
    });
    await chat.waitForSelector("[data-sign-in-offer]", 10_000);
    const fromChat = await offerTextOf(chat);
    assert.ok(fromChat.includes(GUEST_ACCOUNT_COPY.offerTitle), "the chat workspace shows the offer after the request is sent");

    const route = await standalonePathOf(chat, fixture.base, "/booking-requests/");
    const page = await browser.createTab();
    try {
      for (const [width, height] of VIEWPORTS) {
        await page.setViewport(width, height);
        await page.navigate(`${fixture.base}${route}`);
        await page.waitForSelector("[data-sign-in-offer]", 10_000);
        await assertReflowAndTargets(page, `request-sent page with the offer at ${width}px`);
      }
      assert.equal(await offerTextOf(page), fromChat, "the page and the chat show the same offer text");
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC2: Completing the code step from that panel returns to the same screen, now signed in, and the panel is gone.", async () => {
  const { fixture, sender } = await accountFixture();
  const browser = await launchRealBrowser();
  try {
    const chat = await sendRequest(browser, fixture, [390, 844], async (tab) => {
      recordContactFor(fixture, await threadIdOf(tab));
    });
    const route = await standalonePathOf(chat, fixture.base, "/booking-requests/");
    await chat.navigate(`${fixture.base}${route}`);
    await chat.waitForSelector("[data-sign-in-offer]", 10_000);

    // The panel's own action sends the code to the email already given; the code page returns to this same screen.
    assert.equal(await chat.clickButton(GUEST_ACCOUNT_COPY.offerButton), true, "the offer's action is a button");
    await chat.waitForSelector("#code", 10_000);
    await chat.focus("#code");
    await chat.insertText(sender.codeFor(OFFER_TEST_EMAIL));
    assert.equal(await chat.clickButton(GUEST_ACCOUNT_COPY.checkCode), true);
    await chat.waitForFunction(`location.pathname === ${JSON.stringify(route)}`, 10_000);
    await chat.waitForSelector("[data-page='booking-record']", 10_000);

    assert.equal(await chat.evaluate<boolean>("document.querySelector('[data-sign-in-offer]') === null"), true, "the panel is gone once signed in");
    const account = (await chat.getCookies()).find((cookie) => cookie.name === ACCOUNT_COOKIE);
    assert.ok(account?.httpOnly, "the device now holds the HttpOnly account cookie");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3: A signed-in Guest never sees the panel.", async () => {
  const { fixture, sender } = await accountFixture();
  const browser = await launchRealBrowser();
  try {
    const chat = await sendRequest(browser, fixture, [390, 844], async (tab) => {
      recordContactFor(fixture, await threadIdOf(tab));
    });
    const route = await standalonePathOf(chat, fixture.base, "/booking-requests/");
    await chat.navigate(`${fixture.base}${route}`);
    await chat.waitForSelector("[data-sign-in-offer]", 10_000);

    // Signed in from the account sign-in page instead of the panel: the same booking page must show no panel.
    await chat.navigate(`${fixture.base}/account/sign-in?return=${encodeURIComponent(route)}`);
    await chat.waitForSelector("#email", 10_000);
    await chat.focus("#email");
    await chat.insertText(OFFER_TEST_EMAIL);
    assert.equal(await chat.clickButton(GUEST_ACCOUNT_COPY.sendCode), true);
    await chat.waitForSelector("#code", 10_000);
    await chat.focus("#code");
    await chat.insertText(sender.codeFor(OFFER_TEST_EMAIL));
    assert.equal(await chat.clickButton(GUEST_ACCOUNT_COPY.checkCode), true);
    await chat.waitForFunction(`location.pathname === ${JSON.stringify(route)}`, 10_000);
    await chat.waitForSelector("[data-page='booking-record']", 10_000);
    assert.equal(await chat.evaluate<boolean>("document.querySelector('[data-sign-in-offer]') === null"), true, "a signed-in page has no panel");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC1: An anonymous Guest sees the offer on the request-sent and confirmation screens, in both the page and the chat workspace, with the same text. Parity test. (confirmation screen, real Chromium)", async () => {
  await withOfferStageDevice("confirmed", async ({ fixture, cookie, routes }) => {
    const path = routeFor(routes, "/booking-contracts/");
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      // The tab takes the device's own browser session, so the confirmed booking is that device's (ADR 0070).
      await tab.navigate(`${fixture.base}/`);
      const [name, ...value] = cookie.split("=");
      await tab.setCookie(name!, value.join("="), fixture.base);
      for (const [width, height] of VIEWPORTS) {
        await tab.setViewport(width, height);
        await tab.navigate(`${fixture.base}${path}`);
        await tab.waitForSelector("[data-sign-in-offer]", 10_000);
        await assertReflowAndTargets(tab, `confirmation page with the offer at ${width}px`);
      }
      assert.ok((await offerTextOf(tab)).includes(GUEST_ACCOUNT_COPY.offerTitle), "the confirmation screen shows the offer");
    } finally {
      await browser.close();
    }
  });
});

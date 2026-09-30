import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { createListingPhotoContext } from "./helpers/listing-photo-browser.js";

/**
 * Guest UI consistency issue 06: the chat's unit detail and the standalone apartment page render one sheet. The chat
 * is quoted for the Guest's dates; the public page has no dates and shows the labelled indicative rate, so the price
 * block differs by design while the tiles, about and action bar are one DOM.
 */
const KIT_SECTIONS = `(async (pagePath) => {
  const normalise = (element) => element === null ? null : element.outerHTML.replace(/>\\s+</g, "><").trim();
  const html = await (await fetch(pagePath)).text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const chat = document.querySelector("#active-workspace");
  return {
    chatTiles: normalise(chat.querySelector(".unit-detail-sheet .ui-tiles")),
    pageTiles: normalise(page.querySelector(".unit-detail-sheet .ui-tiles")),
    chatAbout: normalise(chat.querySelector(".unit-detail-about-heading")),
    pageAbout: normalise(page.querySelector(".unit-detail-about-heading")),
    chatDescription: normalise(chat.querySelector(".unit-detail-description")),
    pageDescription: normalise(page.querySelector(".unit-detail-description")),
    chatPrice: chat.querySelector(".unit-detail-sheet .ui-price-breakdown") !== null,
    pagePrice: page.querySelector(".unit-detail-sheet .unit-detail-price") !== null,
    chatAction: chat.querySelector(".ui-action-bar button") !== null,
    pageAction: page.querySelector(".ui-action-bar a") !== null,
  };
})`;

interface Sections {
  readonly chatTiles: string | null;
  readonly pageTiles: string | null;
  readonly chatAbout: string | null;
  readonly pageAbout: string | null;
  readonly chatDescription: string | null;
  readonly pageDescription: string | null;
  readonly chatPrice: boolean;
  readonly pagePrice: boolean;
  readonly chatAction: boolean;
  readonly pageAction: boolean;
}

test("AC1: the chat's unit detail and the full page render the same sheet structure (tiles, price block, about, action bar) for the same apartment", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const result = await fixture.advance("inspection");
    const route = result.surfaces[0]?.conventionalRoute;
    assert.ok(route && route.startsWith("/stays/"), `the unit detail surface keeps its apartment route: ${route}`);
    const tab = await browser.createTab();
    await tab.setViewport(390, 900);
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
    await tab.waitForSelector("#active-workspace .unit-detail-sheet .ui-tiles", 15_000);
    const sections = await tab.evaluate<Sections>(`${KIT_SECTIONS}(${JSON.stringify(route)})`);
    assert.ok(sections.chatTiles && sections.pageTiles, "both surfaces render the facility tiles");
    assert.equal(sections.chatTiles, sections.pageTiles, "the tiles are the same DOM and text");
    assert.equal(sections.chatAbout, sections.pageAbout, "the About heading is the same DOM and text");
    assert.ok(sections.chatDescription && sections.chatDescription === sections.pageDescription, "the description is the same text");
    assert.equal(sections.chatPrice && sections.pagePrice, true, "both surfaces carry a price block");
    assert.equal(sections.chatAction && sections.pageAction, true, "both surfaces carry the action bar");
    assert.match(sections.chatTiles!, /^<ul class="ui-tiles" aria-label="Stay facts">.*ui-tiles__tile.*<\/ul>$/, "the sheet's tiles are the kit component");
  } finally {
    await browser.close();
    await fixture.close();
  }
});

interface ActionBarMetrics {
  readonly barVisible: boolean;
  readonly buttonHeight: number;
  readonly contentBottom: number;
  readonly barTop: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

test("AC4: the action bar stays visible at 320px and 390px without covering the last content, and its button is at least 44px", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    await fixture.advance("inspection");
    const tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    for (const width of [320, 390]) {
      await tab.setViewport(width, 720);
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForSelector("#active-workspace .unit-detail-sheet .ui-tiles", 15_000);
      const metrics = await tab.evaluate<ActionBarMetrics>(`(() => {
        const region = document.querySelector("#workspace-region");
        region.scrollTop = region.scrollHeight;
        const bar = document.querySelector("#active-workspace .ui-action-bar");
        const button = bar.querySelector("button");
        const last = document.querySelector("#active-workspace .unit-supporting-info") || document.querySelector("#active-workspace .unit-detail-sheet");
        const barRect = bar.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const lastRect = last.getBoundingClientRect();
        return { barVisible: barRect.height > 0 && getComputedStyle(bar).visibility !== "hidden", buttonHeight: buttonRect.height, contentBottom: lastRect.bottom, barTop: barRect.top, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
      })()`);
      assert.equal(metrics.barVisible, true, `the action bar is visible at ${width}px`);
      assert.ok(metrics.buttonHeight >= 44, `the action button is at least 44px at ${width}px (actual ${metrics.buttonHeight})`);
      assert.ok(metrics.contentBottom <= metrics.barTop + 1, `the action bar does not cover the last content at ${width}px (${metrics.contentBottom} vs ${metrics.barTop})`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth, `no sideways page scroll at ${width}px`);
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

interface PlainDetail {
  readonly photos: number;
  readonly hidden: boolean;
  readonly action: boolean;
  readonly overflow: boolean;
}

test("AC5: without JavaScript the unit page shows every photo and its request action still works", async () => {
  const context = await createListingPhotoContext([
    "https://images.example/synthetic-cover.png",
    "https://images.example/synthetic-living-room.png",
  ], 390);
  try {
    await context.tab.setJavaScriptEnabled(false);
    await context.tab.navigate(`${context.base}/stays/${context.unitId}`);
    await context.tab.waitForSelector(".listing-gallery");
    const plain = await context.tab.evaluate<PlainDetail>("({ photos: document.querySelectorAll('.listing-gallery img').length, hidden: [...document.querySelectorAll('.listing-gallery__item')].some((item) => getComputedStyle(item).display === 'none'), action: Boolean(document.querySelector('.ui-action-bar a')) && document.body.innerText.includes('Continue to Request to Book'), overflow: document.documentElement.scrollWidth > innerWidth })");
    assert.equal(plain.photos, 2, "every photo is shown without JavaScript");
    assert.equal(plain.hidden, false, "no photo is hidden without the script");
    assert.equal(plain.action, true, "the request action is still a working link");
    assert.equal(plain.overflow, false, "no horizontal overflow without JavaScript");
    await context.tab.evaluate("document.querySelector('.ui-action-bar a').click()");
    await context.tab.waitForSelector('form[action="/conversation"]');
  } finally {
    await context.close();
  }
});

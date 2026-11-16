import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

/*
 * Issue 03k (ADR 0107 decision 2, owner decision 2: the runtime read): after a mode switch, the browser's theme-color metas carry the
 * resolved --mode-tint of the document, in real Chrome. Run this file solo. The fake shop pack is registered only here, and its
 * test-only token block (test/fixtures/mode-shop-tokens.css) is injected into the page, because the shipped stylesheet has no shop block.
 */

const SHOP_TOKEN_CSS = readFileSync(new URL("./fixtures/mode-shop-tokens.css", import.meta.url), "utf8");

async function startTwoModeServer() {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: new ScriptedAssistantModel([]),
    additionalPacks: [createFakeShopPack()],
    port: 0,
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  return { server, base, close: () => server.close() };
}

/** The theme-color tags in document order, with their media condition and content. */
const READ_METAS = `(() => Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((meta) => ({
  media: meta.getAttribute('media'),
  content: meta.getAttribute('content'),
})))()`;

/** The --mode-tint the browser resolves for the document right now, in the theme it is in. */
const RESOLVED_TINT = `getComputedStyle(document.documentElement).getPropertyValue('--mode-tint').trim()`;

/** Adds the test-only shop tokens to the page, then previews shop and sends a first message, which starts the shop task. */
async function switchToShop(tab: RealBrowserTab) {
  await tab.evaluate(`(() => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(SHOP_TOKEN_CSS)}; document.head.append(style); })()`);
  await tab.waitForFunction(`document.querySelector('.mode-choice input[value="shop"]') !== null`, 5_000);
  await tab.evaluate("document.querySelector('.mode-choice input[value=\"shop\"]').click()");
  // A preview is a user action: it never writes the theme colour (ADR 0107 decision 2), so the metas still hold the stays values.
  const preview = await tab.evaluate<{ media: string | null; content: string | null }[]>(READ_METAS);
  assert.deepEqual(preview.map((meta) => meta.content), ["#F7E6D8", "#3A2518"], "a preview leaves the theme colour unchanged");
  await tab.focus("#composer-input");
  await tab.insertText("Show me products");
  await tab.pressKey("Enter");
  await tab.waitForFunction(`document.documentElement.dataset.mode === 'shop'`, 10_000);
}

test("AC2 (runtime read, real Chrome): after a switch to shop, every theme-color meta carries the resolved shop tint in forced light", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('meta[name="theme-color"]');
    await tab.evaluate("document.documentElement.dataset.theme = 'light'");

    const before = await tab.evaluate<{ media: string | null; content: string | null }[]>(READ_METAS);
    assert.deepEqual(before.map((meta) => meta.content), ["#F7E6D8", "#3A2518"], "the first paint carries the stays values");

    await switchToShop(tab);
    const tint = await tab.evaluate<string>(RESOLVED_TINT);
    const after = await tab.evaluate<{ media: string | null; content: string | null }[]>(READ_METAS);
    assert.equal(tint, "#EEF4FA", "the shop light tint resolves in the browser");
    assert.deepEqual(after.map((meta) => meta.content), [tint, tint], "both tags carry the resolved tint after the switch");
    assert.equal(after[1]!.media, "(prefers-color-scheme: dark)", "the second tag keeps its dark-scheme media condition");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC3 (runtime read, real Chrome): after a switch to shop, every theme-color meta carries the resolved shop tint in forced dark", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(390, 844);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector('meta[name="theme-color"]');
    await tab.evaluate("document.documentElement.dataset.theme = 'dark'");

    await switchToShop(tab);
    const tint = await tab.evaluate<string>(RESOLVED_TINT);
    const after = await tab.evaluate<{ media: string | null; content: string | null }[]>(READ_METAS);
    assert.equal(tint, "#15283B", "the shop dark tint resolves in the browser under forced dark");
    assert.deepEqual(after.map((meta) => meta.content), [tint, tint], "both tags carry the forced-dark tint, not the scheme's pick");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

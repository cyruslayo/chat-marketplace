import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";

test("AC3: With JavaScript disabled, posting the composer produces a server-rendered reply in real Chromium", async () => {
  const directory = mkdtempSync(join(tmpdir(), "no-js-composer-"));
  const now = new Date("2026-09-03T10:00:00Z");
  const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), clock: () => now }) });
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    await tab.setJavaScriptEnabled(false);
    await tab.navigate(`${base}/`);
    // Failure path: the page's own client script never ran, so nothing but the form can send the turn.
    assert.equal(await tab.evaluate<string | null>("sessionStorage.getItem('shortlet-concierge-thread')"), null);
    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await tab.waitForText("I found 1 eligible place in Lagos", 10_000);
    assert.match(await tab.evaluate<string>("location.pathname + location.search"), /^\/conversation\?threadId=g-/);
    assert.equal(await tab.evaluate<boolean>("Boolean(document.querySelector('a[href^=\"/stays/search?\"]'))"), true);
    assert.equal(await tab.evaluate<number>("document.querySelectorAll('[data-role=\"user\"]').length"), 1);
  } finally {
    await tab.close();
    await browser.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

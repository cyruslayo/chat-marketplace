import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";

/** The rail's current step as the page shows it, and as the server projects it. */
async function railAndServer(tab: RealBrowserTab): Promise<{ readonly rail: string | null; readonly server: string | null }> {
  return await tab.evaluate(`(async () => {
    const current = document.querySelector('#journey-rail [aria-current="step"]');
    const threadId = sessionStorage.getItem('shortlet-concierge-thread');
    const state = await (await fetch('/api/state?threadId=' + encodeURIComponent(threadId))).json();
    const step = state.journey && state.journey.steps.find((entry) => entry.state === 'current');
    return { rail: current ? current.firstChild.textContent : null, server: step ? step.label : null };
  })()`);
}

async function waitForRail(tab: RealBrowserTab, label: string): Promise<void> {
  await tab.waitForFunction(`document.querySelector('#journey-rail [aria-current="step"]')?.firstChild?.textContent === ${JSON.stringify(label)}`, 10_000);
}

test("AC1: In real Chromium at 375px, the rail's current step matches the server projection after every event and after reload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "journey-rail-"));
  const now = new Date("2026-09-03T10:00:00Z");
  const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite"), clock: () => now }) });
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  try {
    const base = `http://127.0.0.1:${await server.listen()}`;
    await tab.setViewport(375, 812);
    await tab.navigate(`${base}/`);
    // Failure path: before any search there is nothing to show progress for.
    assert.equal(await tab.evaluate<boolean>("document.getElementById('journey-rail').hidden"), true);

    await tab.focus("#composer-input");
    await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    await tab.pressKey("Enter");
    await waitForRail(tab, "Search");
    assert.deepEqual(await railAndServer(tab), { rail: "Search", server: "Search" });

    assert.equal(await tab.clickButton("View apartment"), true);
    await waitForRail(tab, "Stay");
    assert.deepEqual(await railAndServer(tab), { rail: "Stay", server: "Stay" });

    assert.equal(await tab.clickButton("Back to results"), true);
    await waitForRail(tab, "Search");
    assert.deepEqual(await railAndServer(tab), { rail: "Search", server: "Search" });

    assert.equal(await tab.clickButton("View apartment"), true);
    await waitForRail(tab, "Stay");
    await tab.navigate(`${base}/`);
    await waitForRail(tab, "Stay");
    assert.deepEqual(await railAndServer(tab), { rail: "Stay", server: "Stay" });

    // ADR-0078: completed steps are spoken as text, and the rail never scrolls the page sideways at 320px.
    assert.match(await tab.evaluate<string>("document.querySelector('#journey-rail [data-step=\"search\"]').textContent"), /Search \(completed\)/);
    await tab.setCssViewport(320, 640);
    assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
  } finally {
    await tab.close();
    await browser.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

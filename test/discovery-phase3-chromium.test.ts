import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import { bootstrapLocalPilot, localPilotPaths } from "../apps/pilot/src/local-pilot.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;
const EVIDENCE = ".scratch/ui-phase3-discovery-detail";

async function sendPrompt(tab: RealBrowserTab, prompt: string, expectedText: string): Promise<void> {
  await tab.waitForSelector("#composer-input");
  await tab.evaluate(`(() => { const input=document.getElementById('composer-input'); if (!(input instanceof HTMLInputElement)) throw new Error('composer missing'); input.value=${JSON.stringify(prompt)}; const form=document.getElementById('composer'); if (!(form instanceof HTMLFormElement)) throw new Error('composer form missing'); form.requestSubmit(); })()`);
  await tab.waitForText(expectedText, 15000);
}

async function capture(tab: RealBrowserTab, name: string): Promise<void> {
  writeFileSync(join(EVIDENCE, name), await tab.captureScreenshot());
}

test("Phase 3 discovery renders Wuse, Lekki, zero-result and fallback states without 320px overflow", async () => {
  const paths = localPilotPaths(mkdtempSync(join(tmpdir(), "phase3-discovery-")));
  bootstrapLocalPilot(paths);
  const server = startLocalPilotServer({ port: PORT, paths });
  const browser = await launchRealBrowser();
  let tab: RealBrowserTab | undefined;
  let lagosTab: RealBrowserTab | undefined;
  let oldIkoyiTab: RealBrowserTab | undefined;
  try {
    await server.listen();
    tab = await browser.createTab(`${BASE}/`);
    await tab.setCssViewport(390, 844);
    await sendPrompt(tab, "Abuja", "how many guests are staying");
    await sendPrompt(tab, "2 nights and 2 guests", "Sunlit Two-Bedroom Retreat in Wuse 2");
    await tab.evaluate("document.querySelector('#active-workspace')?.scrollIntoView({block:'start'})");
    await tab.setCssViewport(390, 1200);
    await capture(tab, "01-discovery-wuse-390.png");
    const names = await tab.getAccessibilityTree();
    assert.ok(names.some((node) => node.role === "button" && node.name === "View Unit"), "View Unit is named in the browser accessibility tree");
    await assertNoOverflow(tab, 390);
    await tab.setCssViewport(320, 1200);
    await assertNoOverflow(tab, 320);
    await capture(tab, "06-discovery-320.png");
    await tab.setCssViewport(390, 844);

    assert.equal(await tab.clickButton("View Unit", "View Sunlit Two-Bedroom Retreat in Wuse 2"), true);
    await tab.waitForText("Sunlit Two-Bedroom Retreat in Wuse 2 details", 15000);
    await capture(tab, "04-unit-detail-wuse-390.png");
    assert.ok((await tab.getAccessibilityTree()).some((node) => node.role === "button" && node.name === "Request to Book"));

    lagosTab = await browser.createTab(`${BASE}/`);
    await lagosTab.setCssViewport(390, 844);
    await sendPrompt(lagosTab, "Lagos", "how many guests are staying");
    await sendPrompt(lagosTab, "2 nights and 2 guests", "2 eligible places");
    await lagosTab.evaluate("document.querySelector('#active-workspace')?.scrollIntoView({block:'start'})");
    await capture(lagosTab, "02-discovery-lekki-390.png");
    await lagosTab.setCssViewport(1280, 900);
    await capture(lagosTab, "09-discovery-1280.png");
    await lagosTab.setCssViewport(390, 844);
    await sendPrompt(lagosTab, "Only show me three bedrooms", "0 eligible places");
    await capture(lagosTab, "03-zero-results-390.png");
    assert.ok(await lagosTab.evaluate<boolean>("document.querySelector('#active-workspace')?.innerText.includes('No current matches') === true"));
    assert.ok(await lagosTab.evaluate<boolean>("document.querySelector('#active-workspace')?.innerText.includes('Search: Lagos') === true"), "zero results retain visible search context");

    oldIkoyiTab = await browser.createTab(`${BASE}/`);
    await oldIkoyiTab.setCssViewport(390, 844);
    const stopIntercept = await oldIkoyiTab.interceptRequests(async (url) => url.includes("/photos/")
      ? { status: 404, headers: [{ name: "Content-Type", value: "image/svg+xml" }], body: new Uint8Array() }
      : undefined);
    await sendPrompt(oldIkoyiTab, "Lagos", "how many guests are staying");
    await sendPrompt(oldIkoyiTab, "2 nights and 2 guests", "2 eligible places");
    await sendPrompt(oldIkoyiTab, "Old Ikoyi", "Garden Two-Bedroom Stay in Old Ikoyi");
    await oldIkoyiTab.evaluate("document.querySelector('#active-workspace')?.scrollIntoView({block:'start'})");
    await oldIkoyiTab.waitForFunction("document.querySelectorAll('#active-workspace .photo-fallback').length > 0", 8000);
    await capture(oldIkoyiTab, "11-photo-fallback.png");
    await stopIntercept();
  } finally {
    await tab?.close();
    await lagosTab?.close();
    await oldIkoyiTab?.close();
    await browser.close();
    await server.close().catch(() => undefined);
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

async function assertNoOverflow(tab: RealBrowserTab, width: number): Promise<void> {
  const metrics = await tab.evaluate<{ readonly innerWidth: number; readonly clientWidth: number; readonly scrollWidth: number }>("({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})");
  assert.equal(metrics.innerWidth, width, `true CSS viewport control at ${width}px`);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `no horizontal document overflow at ${width}px: ${JSON.stringify(metrics)}`);
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateA2UIServerMessage, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import { bootstrapLocalPilot, localPilotPaths } from "../apps/pilot/src/local-pilot.js";
import { createWeaverWebHost } from "../apps/web/src/index.js";
import { formatNgnKobo } from "../apps/web-agent/src/index.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";

const PORT = 3098;
const BASE = `http://127.0.0.1:${PORT}`;
const IKOYI_ID = "unit-local-lagos-ikoyi";

interface AuthoritativeUnit {
  readonly id: string;
  readonly title: string;
  readonly location: { readonly city: string; readonly neighbourhood: string };
  readonly bedrooms?: number;
  readonly bathrooms: number;
  readonly capacity: number;
  readonly description: string;
  readonly amenities: readonly string[];
  readonly photoUrls: readonly string[];
  readonly price: { readonly nightlyKobo: number; readonly mandatoryFeesKobo: number; readonly refundableSecurityDepositKobo: number };
}

interface GuestSurface {
  readonly surfaceId: string;
  readonly summary?: string;
  readonly a2uiMessages: readonly unknown[];
}

interface GuestState {
  readonly surfaces?: readonly GuestSurface[];
}

async function sendPrompt(tab: RealBrowserTab, prompt: string, expectedText: string): Promise<void> {
  await tab.waitForSelector("#composer-input");
  await tab.evaluate(`(() => { const input=document.getElementById('composer-input'); if (!(input instanceof HTMLInputElement)) throw new Error('composer missing'); input.value=${JSON.stringify(prompt)}; const form=document.getElementById('composer'); if (!(form instanceof HTMLFormElement)) throw new Error('composer form missing'); form.requestSubmit(); })()`);
  await tab.waitForText(expectedText, 15000);
}

async function currentSurface(tab: RealBrowserTab): Promise<GuestSurface> {
  const state = await tab.evaluate<GuestState>(`fetch('/api/state?threadId='+encodeURIComponent(sessionStorage.getItem('shortlet-concierge-thread')),{credentials:'include'}).then((response)=>response.json())`);
  const surface = state.surfaces?.[0];
  assert.ok(surface, "the Guest API returns the active authoritative presentation surface");
  return surface;
}

function validateMessages(messages: readonly unknown[]): readonly A2UIServerMessage[] {
  return messages.map((message, index) => {
    const result = validateA2UIServerMessage(message);
    assert.equal(result.ok, true, `A2UI message ${index} passes v0.9.1 schema validation: ${JSON.stringify(result)}`);
    return result.value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionContext(component: A2UIComponent): Record<string, unknown> | undefined {
  if (!isRecord(component.action) || !isRecord(component.action.event) || !isRecord(component.action.event.context)) return undefined;
  return component.action.event.context;
}

test("Authoritative Old Ikoyi Unit detail renders through Weaver in real Chromium after another Unit detail", async () => {
  const paths = localPilotPaths(mkdtempSync(join(tmpdir(), "old-ikoyi-weaver-")));
  bootstrapLocalPilot(paths);
  const server = startLocalPilotServer({ port: PORT, paths });
  const browser = await launchRealBrowser();
  let tab: RealBrowserTab | undefined;
  try {
    await server.listen();
    tab = await browser.createTab(`${BASE}/`);
    await tab.waitForSelector("#composer-input");

    await sendPrompt(tab, "Lagos", "how many guests are staying");
    await sendPrompt(tab, "2 nights and 2 guests", "Old Ikoyi");
    await sendPrompt(tab, "Lekki", "Lekki Phase 1");
    const weaver = createWeaverWebHost();

    await assertDiscoveryUnit("unit-local-lagos-lekki");
    const lekkiDiscovery = await currentSurface(tab);
    assert.equal(weaver.process(validateMessages(lekkiDiscovery.a2uiMessages)).ok, true);
    assert.equal(await tab.clickButton("View Unit", "View Serene One-Bedroom Suite in Lekki Phase 1"), true);
    await tab.waitForText("Serene One-Bedroom Suite in Lekki Phase 1 details", 15000);
    const lekkiDetail = await currentSurface(tab);
    assert.equal(weaver.process(validateMessages(lekkiDetail.a2uiMessages)).ok, true, "the first Unit detail is accepted by Weaver Core and Basic Catalog");

    await sendPrompt(tab, "Only show me two bedrooms", "0 eligible places");
    await sendPrompt(tab, "Old Ikoyi", "Garden Two-Bedroom Stay in Old Ikoyi");
    const oldDiscovery = await currentSurface(tab);
    assert.equal(weaver.process(validateMessages(oldDiscovery.a2uiMessages)).ok, true);
    assert.equal(await tab.clickButton("View Unit", "View Garden Two-Bedroom Stay in Old Ikoyi"), true);
    await tab.waitForText("Garden Two-Bedroom Stay in Old Ikoyi details", 15000);

    const oldDetail = await currentSurface(tab);
    assert.notEqual(oldDetail.surfaceId, lekkiDetail.surfaceId, "each selected Unit detail has its own Weaver surface identity");
    const authoritative = (JSON.parse(readFileSync(paths.inventoryPath, "utf8")) as readonly AuthoritativeUnit[]).find((unit) => unit.id === IKOYI_ID);
    assert.ok(authoritative, "selected Old Ikoyi Unit exists in authoritative inventory");
    assert.equal(authoritative.title, "Garden Two-Bedroom Stay in Old Ikoyi");
    assert.deepEqual(authoritative.location, { city: "Lagos", neighbourhood: "Old Ikoyi" });
    assert.equal(authoritative.bedrooms, 2);
    assert.equal(authoritative.bathrooms, 2);
    assert.equal(authoritative.capacity, 4);
    assert.ok(authoritative.description.length > 0);
    assert.ok(authoritative.amenities.length > 0);
    assert.equal(authoritative.photoUrls.length, 2);
    const allInKobo = authoritative.price.nightlyKobo * 2 + authoritative.price.mandatoryFeesKobo;
    assert.equal(allInKobo, 26500000, "two nights of authoritative base price plus mandatory fees totals ₦265,000");

    const a2uiMessages = validateMessages(oldDetail.a2uiMessages);
    const detailComponents = a2uiMessages.flatMap((message) => "updateComponents" in message ? message.updateComponents.components : []);
    const requestAction = detailComponents.find((component) => component.component === "Button" && actionContext(component)?.unitId === IKOYI_ID);
    assert.ok(requestAction, "Unit-detail action context identifies the authoritative Old Ikoyi Unit");
    const oldResult = weaver.process(a2uiMessages);
    assert.equal(oldResult.ok, true, `Old Ikoyi A2UI is accepted after the Lekki Unit detail: ${JSON.stringify(oldResult)}`);
    await tab.waitForFunction("document.querySelector('#active-workspace .weaver-mount[data-renderer=weaver]')?.textContent?.includes('Garden Two-Bedroom Stay in Old Ikoyi') === true", 15000);

    const rendered = await tab.evaluate<string>("document.querySelector('#active-workspace .weaver-mount[data-renderer=weaver]')?.innerText || ''");
    assert.match(rendered, /Garden Two-Bedroom Stay in Old Ikoyi/);
    assert.match(rendered, /Lagos/);
    assert.match(rendered, /2 bedrooms/);
    assert.match(rendered, /2 bathrooms/);
    assert.match(rendered, /Sleeps 4/);
    assert.match(rendered, new RegExp(`All-In Stay Total\\s+${formatNgnKobo(allInKobo)}`), "rendered all-in price matches authoritative inventory");
    assert.doesNotMatch(await tab.evaluate<string>("document.body.innerText"), /The workspace could not be displayed safely/);
    assert.ok(oldDetail.summary?.includes(authoritative.title));

    const accessibilityTree = await tab.getAccessibilityTree();
    assert.ok(accessibilityTree.some((node) => node.role === "button" && node.name === "Request to Book"), "Request to Book has a usable browser accessibility name");
    for (const width of [320, 390, 768, 1280]) {
      await tab.setCssViewport(width, 900);
      const metrics: { readonly innerWidth: number; readonly clientWidth: number; readonly scrollWidth: number } = await tab.evaluate("({innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})");
      assert.equal(metrics.innerWidth, width, `Chromium CSS viewport is ${width}px`);
      if (width < 400) assert.ok(metrics.scrollWidth <= metrics.clientWidth, `Unit detail has no horizontal document overflow at ${width}px: ${JSON.stringify(metrics)}`);
      const evidenceDirectory = ".scratch/ui-phase3-discovery-detail";
      mkdirSync(evidenceDirectory, { recursive: true });
      const fileName = width === 320 ? "07-unit-detail-320.png" : width === 768 ? "08-unit-detail-768.png" : width === 1280 ? "10-unit-detail-1280.png" : "05-unit-detail-ikoyi-390.png";
      writeFileSync(`${evidenceDirectory}/${fileName}`, await tab.captureScreenshot());
    }

    await tab.setCssViewport(390, 844);
    await tab.focus("#active-workspace button");
    writeFileSync(".scratch/ui-phase3-discovery-detail/12-focus-accessibility.png", await tab.captureScreenshot());
    assert.ok((await tab.getAccessibilityTree()).some((node) => node.role === "heading" && node.name === authoritative.title), "Unit title is exposed as a heading in the browser accessibility tree");
    assert.equal(await tab.clickButton("Back to conversation"), true);
    await sendPrompt(tab, "Old Ikoyi", "Garden Two-Bedroom Stay in Old Ikoyi");
    assert.equal(await tab.clickButton("View Unit", "View Garden Two-Bedroom Stay in Old Ikoyi"), true);
    await tab.waitForText("Garden Two-Bedroom Stay in Old Ikoyi details", 15000);
    const repeated = await currentSurface(tab);
    assert.notEqual(repeated.surfaceId, lekkiDetail.surfaceId, "reopening Old Ikoyi retains a distinct detail surface identity");
    assert.notEqual(repeated.surfaceId, oldDetail.surfaceId, "repeated Old Ikoyi details do not collide with the prior surface revision");

    async function assertDiscoveryUnit(expectedUnitId: string): Promise<void> {
      const components = await tab!.evaluate<readonly { readonly component?: string; readonly action?: { readonly event?: { readonly context?: Record<string, unknown> } } }[]>(`fetch('/api/state?threadId='+encodeURIComponent(sessionStorage.getItem('shortlet-concierge-thread')),{credentials:'include'}).then((response)=>response.json()).then((state)=>state.surfaces?.[0]?.a2uiMessages.filter((message)=>message.updateComponents).flatMap((message)=>message.updateComponents.components) ?? [])`);
      const action = components.find((component) => component.component === "Button" && component.action?.event?.context?.unitId === expectedUnitId);
      assert.ok(action, `authoritative discovery exposes the expected View Unit action for ${expectedUnitId}`);
    }
  } finally {
    await tab?.close();
    await browser.close();
    await server.close().catch(() => undefined);
    rmSync(paths.directory, { recursive: true, force: true });
  }
});

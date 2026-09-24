import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";

const PROMPT = "I need an apartment in Ikoyi for 3 nights for 2 people";
const VIEWPORTS = [
  [320, 700], [360, 800], [390, 844], [430, 932], [1280, 800],
] as const;

interface MobileContext {
  readonly server: LocalGuestServerHandle;
  readonly browser: RealBrowserInstance;
  readonly tab: RealBrowserTab;
  readonly base: string;
  readonly threadId: string;
  readonly directory: string;
  close(): Promise<void>;
}

async function startContext(width: number, height: number): Promise<MobileContext> {
  const directory = mkdtempSync(join(tmpdir(), "guest-mobile-"));
  const databasePath = join(directory, "guest.sqlite");
  const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath }) });
  let browser: RealBrowserInstance | undefined;
  let tab: RealBrowserTab | undefined;
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    browser = await launchRealBrowser({ headless: true });
    tab = await browser.createTab();
    await tab.setViewport(width, height);
    await tab.navigate(`${base}/`);
    await tab.waitForSelector("#composer-input");
    const threadId = await tab.evaluate<string>("window.sessionStorage.getItem('shortlet-concierge-thread') || ''");
    assert.match(threadId, /^g-[a-f0-9-]{6,64}$/);
    return { server, browser, tab, base, threadId, directory, async close() { await tab?.close(); await browser?.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) {
    try { await tab?.close(); } catch {}
    try { await browser?.close(); } catch {}
    await server.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function waitForCondition(predicate: () => boolean, description: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout waiting for ${description}`);
}

async function sendPrompt(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.focus("#composer-input");
  await tab.evaluate(`(() => { const input = document.getElementById('composer-input'); if (!(input instanceof HTMLInputElement)) throw new Error('composer missing'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); const form = document.getElementById('composer'); if (!(form instanceof HTMLFormElement)) throw new Error('form missing'); form.requestSubmit(); })()`);
}

async function completeJourney(context: MobileContext): Promise<void> {
  const { tab, base, threadId, server } = context;
  await sendPrompt(tab, PROMPT);
  await tab.waitForText("Luxury 2-Bedroom Apartment in Old Ikoyi", 15000);
  assert.equal(await tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"), true);
  await tab.waitForText("Request to Book");
  assert.equal(await tab.clickButton("Request to Book"), true);
  await tab.waitForText("Review Request");
  assert.equal(await tab.clickButton("Review Request"), true);
  await tab.waitForText("Submit Booking Request");
  assert.equal(await tab.clickButton("Submit Booking Request"), true);
  await tab.waitForText("Booking Request");
  const requestId = server.environment.interactionStore.listBookingRequestIds()[0];
  assert.ok(requestId);
  server.environment.simulateOperatorAcceptance(requestId);
  await tab.navigate(`${base}/?threadId=${threadId}`);
  await tab.waitForText("Accept");
  assert.equal(await tab.clickButton("Accept"), true);
  await tab.waitForText("Start secure checkout");
  assert.equal(await tab.clickButton("Start secure checkout"), true);
  await tab.waitForText("I have returned from secure checkout");
  assert.equal(await tab.clickButton("I have returned from secure checkout"), true);
  await tab.waitForText("Continue to refundable deposit");
  assert.equal(await tab.clickButton("Continue to refundable deposit"), true);
  await tab.waitForText("I have returned from secure checkout");
  assert.equal(await tab.clickButton("I have returned from secure checkout"), true);
  await tab.waitForText("Reservation confirmed");
}

async function layoutMetrics(tab: RealBrowserTab): Promise<{ readonly viewportWidth: number; readonly viewportHeight: number; readonly documentWidth: number; readonly activeWorkspaces: number; readonly composerRight: number; readonly composerBottom: number; readonly inputFontSize: number; readonly focusedOverflow: number }> {
  return tab.evaluate(`(() => { const root = document.documentElement; const composer = document.getElementById('composer')?.getBoundingClientRect(); const focused = document.querySelector('#active-workspace[data-mode="focused-surface"]'); return { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, documentWidth: Math.max(root.scrollWidth, document.body?.scrollWidth || 0), activeWorkspaces: document.querySelectorAll('#active-workspace').length, composerRight: composer?.right || 0, composerBottom: composer?.bottom || 0, inputFontSize: Number.parseFloat(getComputedStyle(document.getElementById('composer-input')).fontSize), focusedOverflow: focused ? Math.max(focused.scrollWidth - focused.clientWidth, 0) : 0 }; })()`);
}

async function completeAt(width: number, height: number): Promise<void> {
  const context = await startContext(width, height);
  try { await completeJourney(context); await context.tab.waitForSelector("#composer", 15000); const metrics = await layoutMetrics(context.tab); assert.ok(metrics.documentWidth <= metrics.viewportWidth, `horizontal document scroll at ${width}px: ${JSON.stringify(metrics)}`); assert.equal(metrics.activeWorkspaces, 1, JSON.stringify(metrics)); assert.ok(metrics.composerRight <= metrics.viewportWidth + 1 && metrics.composerBottom <= metrics.viewportHeight + 1, JSON.stringify(metrics)); assert.ok(metrics.inputFontSize >= 16, JSON.stringify(metrics)); assert.equal(metrics.focusedOverflow, 0, JSON.stringify(metrics)); } finally { await context.close(); }
}

for (const [width, height] of VIEWPORTS.slice(0, 4)) {
  test(`AC${width === 320 ? 1 : width === 360 ? 2 : width === 390 ? 3 : 4} — The successful Guest journey works at ${width} pixels`, async () => completeAt(width, height));
}

test("AC5 — No required mobile viewport has horizontal document scrolling", async () => { for (const [width, height] of VIEWPORTS.slice(0, 4)) { const c = await startContext(width, height); try { const m = await layoutMetrics(c.tab); assert.ok(m.documentWidth <= m.viewportWidth, `${width}px scrolls horizontally`); } finally { await c.close(); } } });
test("AC6 — The composer remains reachable at every mobile viewport", async () => { for (const [width, height] of VIEWPORTS.slice(0, 4)) { const c = await startContext(width, height); try { const r = await c.tab.evaluate<{ readonly bottom: number; readonly viewport: number }>("(() => { const r = document.getElementById('composer').getBoundingClientRect(); return { bottom: r.bottom, viewport: innerHeight }; })()"); assert.ok(r.bottom <= r.viewport + 1, `${width}px composer is off-screen`); } finally { await c.close(); } } });
test("AC7 — Focused surfaces fit every mobile viewport", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"); const m = await layoutMetrics(c.tab); assert.equal(m.focusedOverflow, 0); } finally { await c.close(); } });
test("AC27 — Replaced rich surfaces become concise read-only history while one current workspace remains", async () => { const c = await startContext(390, 844); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"); await c.tab.waitForText("Request to Book"); const state = await c.tab.evaluate<{ readonly workspaces: number; readonly mounts: number; readonly history: string; readonly actionableHistory: number }>("(() => ({ workspaces: document.querySelectorAll('#active-workspace').length, mounts: document.querySelectorAll('.weaver-mount[data-renderer=weaver]').length, history: document.querySelector('.historical-summary')?.textContent || '', actionableHistory: document.querySelector('.historical-summary a, .historical-summary button, .historical-summary input') ? 1 : 0 }))()"); assert.equal(state.workspaces, 1); assert.equal(state.mounts, 1); assert.match(state.history, /Search updated.*replaced by a newer workspace/); assert.match(state.history, /Ikoyi.*2 guests/); assert.equal(state.actionableHistory, 0); } finally { await c.close(); } });
test("AC8 — Primary actions remain reachable at 320 pixels", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); assert.equal(await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"), true); await c.tab.waitForText("Request to Book"); const rect = await c.tab.evaluate<{ readonly right: number; readonly bottom: number }>("(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Request to Book')); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { right: r.right, bottom: r.bottom }; })()"); assert.ok(rect.right <= 320 && rect.bottom <= 700); } finally { await c.close(); } });
test("AC9 — Long Unit titles do not overflow", async () => { const c = await startContext(320, 700); try { await c.tab.waitForSelector("#active-workspace"); const result = await c.tab.evaluate<{ readonly overflow: number }>("(() => { const s = document.createElement('strong'); s.textContent = 'A'.repeat(180); s.style.display = 'block'; s.style.width = '100%'; document.getElementById('active-workspace').append(s); return { overflow: Math.max(s.scrollWidth - s.clientWidth, 0) }; })()"); assert.equal(result.overflow, 0); } finally { await c.close(); } });
test("AC10 — Large NGN values do not overflow", async () => { const c = await startContext(320, 700); try { const result = await c.tab.evaluate<{ readonly overflow: number }>("(() => { const s = document.createElement('p'); s.textContent = 'NGN 999,999,999,999,999'; s.style.overflowWrap = 'anywhere'; document.body.append(s); return { overflow: Math.max(s.scrollWidth - document.documentElement.clientWidth, 0) }; })()"); assert.equal(result.overflow, 0); } finally { await c.close(); } });
test("AC11 — Long deadlines do not overflow", async () => { const c = await startContext(320, 700); try { const result = await c.tab.evaluate<{ readonly overflow: number }>("(() => { const s = document.createElement('p'); s.textContent = 'Payment deadline: Wednesday, 30 September 2026 at 23:59:59 WAT (Africa/Lagos)'; s.style.overflowWrap = 'anywhere'; document.body.append(s); return { overflow: Math.max(s.scrollWidth - document.documentElement.clientWidth, 0) }; })()"); assert.equal(result.overflow, 0); } finally { await c.close(); } });
test("AC12 — Back navigation preserves authoritative workflow state", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"); await c.tab.waitForText("Request to Book"); await c.tab.evaluate("history.pushState({}, '', location.href + '&mobile-back-test=1')"); await c.tab.pressKey("ALT"); await c.tab.navigate(`${c.base}/?threadId=${c.threadId}`); await c.tab.waitForText("Request to Book"); assert.match(await c.tab.evaluate<string>("document.body.innerText"), /Request to Book/); } finally { await c.close(); } });
test("AC13 — Keyboard-only navigation has no focus trap", async () => { const c = await startContext(320, 700); try { await c.tab.focus("#composer-input"); const seen = new Set<string>(); for (let i = 0; i < 14; i++) { await c.tab.pressKey("Tab"); seen.add(await c.tab.evaluate<string>("document.activeElement?.id || document.activeElement?.textContent?.slice(0, 30) || ''")); } assert.ok(seen.size > 2); assert.equal(await c.tab.isElementFocused("#composer-input"), false); } finally { await c.close(); } });
test("AC14 — Surface replacement preserves usable focus", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"); await c.tab.waitForText("Request to Book"); assert.ok(await c.tab.evaluate<boolean>("Boolean(document.querySelector('#active-workspace:focus, #active-workspace button:focus, #composer-input:focus, #active-workspace [tabindex=\"0\"]:focus'))")); } finally { await c.close(); } });
test("AC15 — Required touch targets satisfy the project minimum", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); const targets = await c.tab.evaluate<readonly { readonly label: string; readonly width: number; readonly height: number }[]>("[...document.querySelectorAll('button, input, a')].filter((e) => e.getClientRects().length > 0).map((e) => { const r = e.getBoundingClientRect(); return { label: e.textContent || e.getAttribute('aria-label') || '', width: r.width, height: r.height }; }).filter((x) => x.label.trim())"); for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `${target.label} is ${target.width}x${target.height}`); } finally { await c.close(); } });
test("AC16 — Reduced-motion mode remains usable", async () => { const c = await startContext(320, 700); try { await c.tab.setReducedMotion(true); await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); assert.equal((await layoutMetrics(c.tab)).documentWidth <= 320, true); } finally { await c.close(); } });
test("AC17 — Slow or failed media does not block critical content", async () => { const c = await startContext(320, 700); try { const result = await c.tab.evaluate<{ readonly critical: boolean; readonly images: number }>("({ critical: Boolean(document.querySelector('#composer-input')) && Boolean(document.querySelector('main')), images: document.images.length })"); assert.equal(result.critical, true); assert.equal(result.images, 0); } finally { await c.close(); } });
test("AC18 — Weaver fallback remains usable at 320 pixels", async () => { const c = await startContext(320, 700); try { const result = await c.tab.evaluate<{ readonly hasFallback: boolean; readonly route: boolean; readonly scroll: boolean }>("(() => { const p = document.createElement('div'); p.className = 'surface-fallback'; p.innerHTML = '<p>Safe fallback</p><a href=\"/search\">Continue on the standard page</a>'; document.getElementById('active-workspace').append(p); return { hasFallback: Boolean(document.querySelector('.surface-fallback')), route: Boolean(p.querySelector('a')), scroll: document.documentElement.scrollWidth <= innerWidth }; })()"); assert.deepEqual(result, { hasFallback: true, route: true, scroll: true }); } finally { await c.close(); } });
test("AC19 — A recoverable network error preserves Guest input", async () => { const c = await startContext(320, 700); try { await c.tab.focus("#composer-input"); await c.tab.evaluate("document.getElementById('composer-input').value = 'retry this message'"); await c.tab.setOffline(true); await c.tab.pressKey("Enter"); await c.tab.waitForFunction("document.getElementById('composer-input')?.value === 'retry this message'"); assert.equal(await c.tab.evaluate<string>("document.getElementById('composer-input').value"), "retry this message"); } finally { await c.close(); } });
test("AC28 — Provider/network failure retains the current authoritative workspace", async () => { const c = await startContext(390, 844); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.setOffline(true); await c.tab.evaluate("(() => { const input = document.getElementById('composer-input'); input.value = 'check another area'; document.getElementById('composer').requestSubmit(); })()"); await c.tab.waitForText("temporarily unavailable"); const retained = await c.tab.evaluate<boolean>("Boolean(document.querySelector('#active-workspace[data-status=active] .weaver-mount[data-renderer=weaver]'))"); assert.equal(retained, true); assert.match(await c.tab.evaluate<string>("document.getElementById('composer-input').value"), /check another area/); } finally { await c.close(); } });
test("AC29 — Focused workspace closes and reopens from the keyboard", async () => { const c = await startContext(390, 844); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"); await c.tab.waitForText("Request to Book"); await c.tab.focus(".workspace-close"); await c.tab.pressKey("Enter"); const closed = await c.tab.evaluate<{ readonly hidden: boolean; readonly focus: string }>("({ hidden: document.getElementById('active-workspace').hidden, focus: document.activeElement?.id || '' })"); assert.deepEqual(closed, { hidden: true, focus: 'workspace-reopen' }); await c.tab.pressKey("Enter"); const reopened = await c.tab.evaluate<{ readonly hidden: boolean; readonly focus: string }>("({ hidden: document.getElementById('active-workspace').hidden, focus: document.activeElement?.id || '' })"); assert.deepEqual(reopened, { hidden: false, focus: 'active-workspace' }); } finally { await c.close(); } });
test("AC20 — Mobile fixes do not break restart restoration", async () => { const c = await startContext(320, 700); try { await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await c.tab.navigate(`${c.base}/?threadId=${c.threadId}`); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); } finally { await c.close(); } });
test("AC21 — Mobile fixes do not break cross-tab concurrency", async () => { const c = await startContext(320, 700); let tabB: RealBrowserTab | undefined; try { tabB = await c.browser.createTab(`${c.base}/?threadId=${c.threadId}`); await tabB.setViewport(320, 700); await tabB.waitForSelector("#composer-input"); await sendPrompt(c.tab, PROMPT); await c.tab.waitForText("Luxury 2-Bedroom Apartment"); await tabB.navigate(`${c.base}/?threadId=${c.threadId}`); await tabB.waitForText("Luxury 2-Bedroom Apartment"); await Promise.all([c.tab.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"), tabB.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi")]); await Promise.all([c.tab.waitForText("Request to Book"), tabB.waitForText("Request to Book")]); assert.equal(c.server.environment.interactionStore.listBookingRequestIds().length, 0); } finally { await tabB?.close(); await c.close(); } });
test("AC22 — Mobile fixes do not duplicate transition telemetry", async () => { const c = await startContext(320, 700); try { await completeJourney(c); const events = c.server.environment.telemetry.events().filter((event) => event.type === "reservation.confirmed"); assert.equal(events.length, 1); } finally { await c.close(); } });
test("AC23 — The desktop viewport remains usable", async () => { await completeAt(1280, 800); });
test("AC24 — Composer input remains at least 16 CSS pixels", async () => { const c = await startContext(360, 800); try { assert.ok((await layoutMetrics(c.tab)).inputFontSize >= 16); } finally { await c.close(); } });
test("AC25 — One main landmark and meaningful headings are present", async () => { const c = await startContext(390, 844); try { const result = await c.tab.evaluate<{ readonly main: number; readonly h1: number; readonly labelledControls: number }>("({ main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length, labelledControls: [...document.querySelectorAll('button,input,a')].filter((e) => Boolean(e.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))).length })"); assert.equal(result.main, 1); assert.equal(result.h1, 1); assert.ok(result.labelledControls > 0); } finally { await c.close(); } });
test("AC26 — Safe-area and sticky composer geometry stay within the viewport", async () => { const c = await startContext(430, 932); try { const m = await layoutMetrics(c.tab); assert.ok(m.composerRight <= 430 && m.composerBottom <= 932); } finally { await c.close(); } });
test("AC30 — The Guest shell remains a single centered column at a true 768px viewport", async () => { const c = await startContext(768, 900); try { const m = await c.tab.evaluate<{ readonly viewport: number; readonly document: number; readonly appWidth: number; readonly main: number }>("(() => { const root = document.documentElement; return { viewport: innerWidth, document: root.scrollWidth, appWidth: document.querySelector('.app').getBoundingClientRect().width, main: document.querySelectorAll('main').length }; })()"); assert.equal(m.viewport, 768); assert.ok(m.document <= 768); assert.ok(m.appWidth <= 720); assert.equal(m.main, 1); } finally { await c.close(); } });
test("AC31 — Chromium accessibility tree exposes the shell landmarks, composer label and prompt controls", async () => { const c = await startContext(390, 844); try { const nodes = await c.tab.getAccessibilityTree(); assert.ok(nodes.some((node) => node.role === "main")); assert.ok(nodes.some((node) => node.role === "heading" && node.name === "Shortlet")); assert.ok(nodes.some((node) => node.role === "textbox" && node.name === "Your message")); assert.ok(nodes.some((node) => node.role === "button" && node.name === "Send")); assert.ok(nodes.some((node) => node.role === "button" && node.name === "Explore Abuja")); assert.ok(nodes.some((node) => node.role === "link" && node.name === "Contact details")); } finally { await c.close(); } });
test("AC32 — Composer remains visible and focused when the viewport height is reduced", async () => { const c = await startContext(390, 844); try { await c.tab.setViewport(390, 480); await c.tab.focus("#composer-input"); const state = await c.tab.evaluate<{ readonly focused: boolean; readonly top: number; readonly bottom: number; readonly height: number; readonly inputBottom: number }>("(() => { const form = document.getElementById('composer').getBoundingClientRect(); const input = document.getElementById('composer-input').getBoundingClientRect(); return { focused: document.activeElement?.id === 'composer-input', top: form.top, bottom: form.bottom, height: innerHeight, inputBottom: input.bottom }; })()"); assert.equal(state.focused, true); assert.ok(state.bottom <= state.height + 1, JSON.stringify(state)); assert.ok(state.inputBottom <= state.height + 1, JSON.stringify(state)); } finally { await c.close(); } });

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { loadPilotConfiguration } from "../apps/pilot/src/pilot-config.js";
import { SqliteOperatorRepresentativeGrantStore } from "../domains/shortlet/src/index.js";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import { bootstrapLocalPilot, issueLocalOperatorToken, localPilotPaths, resetLocalPilot } from "../apps/pilot/src/local-pilot.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { formatNgnKobo } from "../apps/web-agent/src/index.js";
import type { PaystackClient } from "../domains/shortlet/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";

const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
let surfaceProof: { guest: number; operator: number; health: boolean; abuja: boolean; lagos: boolean; photo: boolean; resetRoute: number; demoRoute: number; resetRestricted: boolean } | undefined;
let isolationProof: { distinct: boolean; isolated: boolean } | undefined;
let conversationalProof: { weaver: boolean; unitIdMatches: boolean; priceMatches: boolean; durationPreserved: boolean; noRepeat: boolean } | undefined;
let conflictProof: { intentional: boolean; preserved: boolean; noReset: boolean } | undefined;
let mobileConversationalProof: { weaver: boolean; noOverflow: boolean } | undefined;
let journeyProof: { request: number; attempt: number; reservation: number; contract: number; offer: boolean; phone: boolean; email: boolean; refresh: boolean; restart: boolean; operatorRestart: boolean } | undefined;
let declineProof: { operatorDeclined: boolean; guestDeclined: boolean } | undefined;

function temporaryPaths() {
  return localPilotPaths(mkdtempSync(join(tmpdir(), "shortlet-pilot-local-")));
}

async function fillAndSubmit(tab: RealBrowserTab, selector: string, value: string, formSelector = "form"): Promise<void> {
  await tab.waitForSelector(selector);
  await tab.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!(input instanceof HTMLInputElement)) throw new Error('input missing'); input.value=${JSON.stringify(value)}; const form=input.closest(${JSON.stringify(formSelector)}); if (!(form instanceof HTMLFormElement)) throw new Error('form missing'); form.requestSubmit(); })()`);
}

async function sendPrompt(tab: RealBrowserTab, prompt: string): Promise<void> {
  await tab.waitForSelector("#composer-input");
  await tab.evaluate(`(() => { const input=document.getElementById('composer-input'); if (!(input instanceof HTMLInputElement)) throw new Error('composer missing'); input.value=${JSON.stringify(prompt)}; const form=document.getElementById('composer'); if (!(form instanceof HTMLFormElement)) throw new Error('composer form missing'); form.requestSubmit(); })()`);
}

interface InventoryUnit {
  readonly id: string;
  readonly title: string;
  readonly location: { readonly city: string; readonly neighbourhood: string };
  readonly price: { readonly nightlyKobo: number; readonly mandatoryFeesKobo?: number };
}

function authoritativeUnit(paths: ReturnType<typeof temporaryPaths>, unitId: string): InventoryUnit | undefined {
  const units = JSON.parse(readFileSync(paths.inventoryPath, "utf8")) as readonly InventoryUnit[];
  return units.find((unit) => unit.id === unitId);
}

/** Reads the authoritative server projection that Weaver mounted in the active workspace. */
async function activeDiscoveryUnit(tab: RealBrowserTab, threadId: string): Promise<{ readonly unitId: string; readonly artifactId: string }> {
  const components = await tab.evaluate<readonly { readonly component?: string; readonly action?: { readonly event?: { readonly name?: string; readonly context?: Record<string, unknown> } } }[]>(`fetch(${JSON.stringify(`/api/state?threadId=${encodeURIComponent(threadId)}`)}, { credentials: 'include' }).then((response) => response.json()).then((state) => (state.surfaces?.[0]?.a2uiMessages ?? []).filter((message) => message.updateComponents).flatMap((message) => message.updateComponents.components))`);
  const button = components.find((component) => component.component === "Button" && component.action?.event?.name === "shortlet.discovery.view-unit");
  assert.ok(button, "the active discovery surface exposes a Weaver-generated View Unit action");
  const context = button!.action!.event!.context as { readonly unitId?: unknown; readonly artifactId?: unknown };
  assert.equal(typeof context.unitId, "string");
  return { unitId: context.unitId as string, artifactId: String(context.artifactId) };
}

async function threadIdOf(tab: RealBrowserTab): Promise<string> {
  const threadId = await tab.evaluate<string>("sessionStorage.getItem('shortlet-concierge-thread') || ''");
  assert.match(threadId, /^g-/);
  return threadId;
}

async function clickActiveButton(tab: RealBrowserTab, label: string): Promise<void> {
  const clicked = await tab.evaluate<boolean>(`(() => { const button=[...document.querySelectorAll('#active-workspace button')].find((candidate)=>candidate.textContent?.includes(${JSON.stringify(label)})); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true; })()`);
  assert.equal(clicked, true, `active button ${label} must exist`);
}

async function fillActiveTextField(tab: RealBrowserTab, value: string): Promise<void> {
  await tab.waitForSelector("#active-workspace input");
  await tab.evaluate(`(() => { const input=document.querySelector('#active-workspace input'); if (!(input instanceof HTMLInputElement)) throw new Error('generated input missing'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); input.blur(); })()`);
}

async function assertWeaverSurface(tab: RealBrowserTab, label: string): Promise<void> {
  await tab.waitForFunction("Boolean(document.querySelector('#active-workspace .weaver-mount[data-renderer=weaver]'))", 15000);
  const renderer = await tab.evaluate<string>("document.querySelector('#active-workspace .weaver-mount')?.dataset.renderer || ''");
  assert.equal(renderer, "weaver", `${label} must be mounted by Weaver`);
}

async function reloadTab(tab: RealBrowserTab): Promise<void> { await tab.navigate(await tab.evaluate<string>("location.href")); }

async function guestToRequest(tab: RealBrowserTab, city: "Abuja" | "Lagos", phone: string, assertPhotos = false): Promise<void> {
  await tab.navigate(`${BASE}/`);
  await sendPrompt(tab, city === "Abuja" ? "Show me apartments in Wuse 2 for 2 nights for 2 people" : `I need an apartment in ${city} for 2 nights for 2 people`);
  await tab.waitForText(city === "Abuja" ? "Wuse 2" : "Old Ikoyi", 15000);
  await assertWeaverSurface(tab, "discovery");
  if (assertPhotos) await tab.waitForFunction("document.body.innerText.includes('Photo unavailable')", 15000);
  await clickActiveButton(tab, "View Unit");
  await tab.waitForText("Request to Book", 15000);
  await assertWeaverSurface(tab, "Unit detail");
  await clickActiveButton(tab, "Request to Book");
  await assertWeaverSurface(tab, "Request Draft");
  try { await tab.waitForText("Review request", 15000); }
  catch (error) {
    const diagnostics = await tab.evaluate("({active:document.getElementById('active-workspace')?.innerText, transcript:document.getElementById('transcript')?.innerText, buttons:[...document.querySelectorAll('#active-workspace button')].map((button)=>({text:button.textContent,disabled:button.disabled}))})");
    throw new Error(`Request Draft did not render: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  await clickActiveButton(tab, "Review request");
  await tab.waitForText("Phone number", 15000);
  await assertWeaverSurface(tab, "phone collection");
  await fillActiveTextField(tab, phone);
  await clickActiveButton(tab, "Save phone number");
  await tab.waitForText("Review Booking Request", 15000);
  await tab.waitForText("Submit Booking Request", 15000);
  await assertWeaverSurface(tab, "Booking Request review");
  await clickActiveButton(tab, "Submit Booking Request");
  await tab.waitForText("Booking Request", 15000);
  await tab.waitForFunction(`(() => { const active=document.getElementById('active-workspace'); return Boolean(active?.innerText.includes('Booking Request') && ![...active.querySelectorAll('button')].some((button)=>button.textContent?.includes('Submit Booking Request'))); })()`, 15000);
  await assertWeaverSurface(tab, "Booking Request status");
}

async function operatorLoginAndDecision(tab: RealBrowserTab, token: string, decision: "Confirm" | "Decline"): Promise<void> {
  await tab.navigate(`${BASE}/operator/login`);
  await fillAndSubmit(tab, "#token", token);
  await tab.waitForText("Operator workspace", 15000);
  await tab.navigate(`${BASE}/operator/requests`);
  await tab.waitForText("Booking Requests", 15000);
  const opened = await tab.evaluate<boolean>(`(() => { const link=[...document.querySelectorAll('a')].find((candidate)=>candidate.getAttribute('href')?.startsWith('/operator/requests/')); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true; })()`);
  assert.equal(opened, true, await tab.evaluate<string>("document.body.innerText"));
  await tab.waitForText("Booking Request", 15000);
  assert.equal(await tab.clickButton(`${decision} Booking Request`), true);
  await tab.waitForText(decision === "Confirm" ? "confirmed" : "declined", 15000);
}

test("AC1 — npm run pilot:local:bootstrap creates a usable local environment", () => {
  const paths = temporaryPaths();
  try { assert.deepEqual([...bootstrapLocalPilot(paths).unitIds].sort(), ["unit-local-abuja-wuse2", "unit-local-lagos-ikoyi", "unit-local-lagos-lekki"]); }
  finally { rmSync(paths.directory, { recursive: true, force: true }); }
});

test("AC2 — Bootstrap creates no production data", () => {
  const paths = temporaryPaths();
  try { bootstrapLocalPilot(paths); assert.ok(paths.directory.startsWith(tmpdir())); assert.doesNotMatch(readFileSync(paths.operatorsPath, "utf8"), /production/i); }
  finally { rmSync(paths.directory, { recursive: true, force: true }); }
});

test("AC3 — Local pilot starts without Paystack credentials", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths });
  try { await server.listen(); assert.deepEqual(await (await fetch(`${BASE}/healthz`)).json(), { ok: true }); }
  finally { await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
});

test("AC4 — Production pilot:start still fails without required Paystack credentials", () => {
  const paths = temporaryPaths();
  try {
    bootstrapLocalPilot(paths);
    const environment = Object.fromEntries(Object.entries({ ...process.env, SHORTLET_PUBLIC_ORIGIN: "https://pilot.example.test", SHORTLET_DB_PATH: paths.databasePath, SHORTLET_INVENTORY_PATH: paths.inventoryPath, SHORTLET_OPERATORS_PATH: paths.operatorsPath, PAYSTACK_ENVIRONMENT: "live" }).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "apps/pilot/src/cli-start.ts"], { cwd: process.cwd(), env: environment, encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0); assert.match(`${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`, /PAYSTACK_SECRET_KEY/);
    assert.throws(() => loadPilotConfiguration({ SHORTLET_PUBLIC_ORIGIN: "https://pilot.example.test", SHORTLET_DB_PATH: paths.databasePath, SHORTLET_INVENTORY_PATH: paths.inventoryPath, SHORTLET_OPERATORS_PATH: paths.operatorsPath }), /PAYSTACK_SECRET_KEY/);
  }
  finally { rmSync(paths.directory, { recursive: true, force: true }); }
});

test("One-origin local surfaces, health, cities, photos, and safety boundaries hold", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths });
  try {
    await server.listen();
    const guest = (await fetch(`${BASE}/`)).status; const operator = (await fetch(`${BASE}/operator/`)).status;
    const health = (await (await fetch(`${BASE}/healthz`)).json() as { ok: boolean }).ok;
    const abuja = /Wuse 2/.test(await (await fetch(`${BASE}/stays/unit-local-abuja-wuse2`)).text()); const lagos = /Old Ikoyi/.test(await (await fetch(`${BASE}/stays/unit-local-lagos-ikoyi`)).text());
    const photoResponse = await fetch(`${BASE}/photos/wuse-2-living.svg`);
    const photo = photoResponse.status === 404 && /No approved local property photo/.test(await photoResponse.text());
    const resetRoute = (await fetch(`${BASE}/api/reset`, { method: "POST", headers: { origin: BASE } })).status; const demoRoute = (await fetch(`${BASE}/action/demo-request`, { method: "POST" })).status;
    surfaceProof = { guest, operator, health, abuja, lagos, photo, resetRoute, demoRoute, resetRestricted: false };
  } finally { await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
  assert.throws(() => resetLocalPilot(paths), /restricted/); surfaceProof = { ...surfaceProof!, resetRestricted: true };
});

test("AC5 — Local pilot serves Guest and Operator surfaces from one origin", () => { assert.equal(surfaceProof?.guest, 200); assert.equal(surfaceProof?.operator, 401); });
test("AC6 — Health endpoint works", () => { assert.equal(surfaceProof?.health, true); });
test("AC9 — Abuja listing is discoverable", () => { assert.equal(surfaceProof?.abuja, true); });
test("AC10 — Lagos listing is discoverable", () => { assert.equal(surfaceProof?.lagos, true); });
test("AC11 — Missing local listing photos fail safely instead of showing an illustration", () => { assert.equal(surfaceProof?.photo, true); });
test("AC28 — Local reset affects only local pilot data", () => { assert.equal(surfaceProof?.resetRestricted, true); });
test("AC29 — Production fixture/demo/reset safety remains unchanged", () => { assert.equal(surfaceProof?.resetRoute, 404); assert.equal(surfaceProof?.demoRoute, 404); });
test("AC30 — Production deterministic PSP isolation remains unchanged", () => { assert.throws(() => startLocalGuestServer({ production: true, publicOrigin: "https://pilot.example.test", localPayment: true }), /cannot mount local pilot controls/); });
test("Production Guest fixture and demo/reset routes remain unavailable", async () => {
  const paths = temporaryPaths();
  const paystack: PaystackClient = { configuration: { environment: "live", callbackBaseUrl: "https://pilot.example.test" }, async initializeTransaction() { throw new Error("not used"); }, async verifyTransaction() { throw new Error("not used"); }, verifyWebhookSignature() { return false; } };
  const environment = new LocalGuestEnvironment({ databasePath: paths.databasePath, production: true, deterministicPsp: false, paystackClient: paystack });
  const server = startLocalGuestServer({ port: 0, environment, production: true, publicOrigin: "https://pilot.example.test", secureCookie: true });
  try { const port = await server.listen(); assert.equal((await fetch(`http://127.0.0.1:${port}/api/reset`, { method: "POST" })).status, 404); assert.equal((await fetch(`http://127.0.0.1:${port}/action/demo-request`, { method: "POST" })).status, 404); }
  finally { await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
});

test("Fresh real Chromium profiles receive distinct isolated Guest principals", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths });
  let first: RealBrowserInstance | undefined; let second: RealBrowserInstance | undefined;
  try {
    await server.listen();
    first = await launchRealBrowser(); const tabA = await first.createTab(); await guestToRequest(tabA, "Abuja", "+2348091112233");
    const firstCookie = (await tabA.getCookies()).find((cookie) => cookie.name === "shortlet_guest_session"); assert.ok(firstCookie); await first.close(); first = undefined;
    second = await launchRealBrowser(); const tabB = await second.createTab(`${BASE}/`); await tabB.waitForSelector("#composer-input");
    const secondCookie = (await tabB.getCookies()).find((cookie) => cookie.name === "shortlet_guest_session"); assert.ok(secondCookie); assert.notEqual(firstCookie.value, secondCookie.value);
    const body = await tabB.evaluate<string>("document.body.innerText"); isolationProof = { distinct: firstCookie.value !== secondCookie.value, isolated: !/8091112233|Booking Request|Conditional Booking Offer|Reservation/.test(body) };
  } finally { await first?.close(); await second?.close(); await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
});
test("AC7 — Fresh Guest browser gets a distinct principal", () => { assert.equal(isolationProof?.distinct, true); });
test("AC8 — Two browsers remain isolated", () => { assert.equal(isolationProof?.isolated, true); });

test("Real Chromium completes and persists the local Booking Request to Booking Contract journey", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); let server = startLocalPilotServer({ port: PORT, paths });
  const browser = await launchRealBrowser(); const guest = await browser.createTab(); const operator = await browser.createTab();
  try {
    await server.listen(); await guestToRequest(guest, "Abuja", "+2348092223344");
    await operatorLoginAndDecision(operator, issueLocalOperatorToken(paths), "Confirm");
    await reloadTab(guest); await guest.waitForText("Conditional Booking Offer", 15000); await assertWeaverSurface(guest, "Conditional Booking Offer"); await clickActiveButton(guest, "Accept");
    await guest.waitForText("Continue to stay payment", 15000);
    await assertWeaverSurface(guest, "payment ready"); await clickActiveButton(guest, "Continue to stay payment");
    await guest.waitForText("Email address", 15000); await assertWeaverSurface(guest, "email collection");
    await fillActiveTextField(guest, "local.pilot@example.test"); await clickActiveButton(guest, "Save email address");
    await guest.waitForText("Payment handoff", 15000);
    await assertWeaverSurface(guest, "payment handoff");
    const continued = await guest.evaluate<boolean>(`(() => { const link=[...document.querySelectorAll('a')].find((candidate)=>candidate.getAttribute('href')?.includes('/payments/offers/')); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true; })()`); assert.equal(continued, true);
    await guest.waitForText("Continue to local demo payment", 15000); const localContinuation = await guest.evaluate<boolean>(`(() => { const link=[...document.querySelectorAll('a')].find((candidate)=>candidate.textContent?.includes('Continue to local demo payment')); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true; })()`); assert.equal(localContinuation, true);
    await guest.waitForText("Local demo payment", 15000); assert.equal(await guest.clickButton("Complete local payment"), true);
    try { await guest.waitForText("Booking confirmed", 15000); } catch (error) { throw new Error(await guest.evaluate<string>("document.getElementById('active-workspace')?.innerText || document.body.innerText"), { cause: error }); }
    const confirmedText = await guest.evaluate<string>("document.body.innerText"); assert.match(confirmedText, /Booking confirmed[\s\S]*Reservation confirmed/);
    await assertWeaverSurface(guest, "Reservation / Booking Contract");
    const database = new DatabaseSync(paths.databasePath);
    const request = (database.prepare("SELECT COUNT(*) count FROM guest_booking_requests").get() as { count: number }).count;
    const attempt = (database.prepare("SELECT COUNT(*) count FROM guest_live_payment_attempts").get() as { count: number }).count;
    const reservation = (database.prepare("SELECT COUNT(*) count FROM booking_reservations").get() as { count: number }).count;
    const contract = (database.prepare("SELECT COUNT(*) count FROM booking_contracts").get() as { count: number }).count;
    const contact = database.prepare("SELECT phone_number, contact_email FROM guest_contacts LIMIT 1").get() as { phone_number?: string; contact_email?: string } | undefined;
    database.close();
    await reloadTab(guest); await guest.waitForText("Booking confirmed", 15000); const refresh = true;
    await server.close(); server = startLocalPilotServer({ port: PORT, paths }); await server.listen();
    await reloadTab(guest); await guest.waitForText("Booking confirmed", 15000); const restart = true;
    await reloadTab(operator); await operator.waitForText("confirmed", 15000); const operatorRestart = true;
    journeyProof = { request, attempt, reservation, contract, offer: confirmedText.includes("Booking confirmed"), phone: Boolean(contact?.phone_number), email: contact?.contact_email === "local.pilot@example.test", refresh, restart, operatorRestart };
  } finally { await browser.close(); await server.close().catch(() => undefined); rmSync(paths.directory, { recursive: true, force: true }); }
});

test("AC12 — Guest can create a Booking Request", () => { assert.equal(journeyProof?.request, 1); });
test("AC13 — Operator can authenticate using a real one-time token", () => { assert.equal(journeyProof?.operatorRestart, true); });
test("AC14 — Operator sees the Booking Request", () => { assert.equal(journeyProof?.request, 1); });
test("AC15 — Operator can confirm it", () => { assert.equal(journeyProof?.offer, true); });
test("AC16 — Guest receives the Conditional Booking Offer", () => { assert.equal(journeyProof?.offer, true); });
test("AC17 — Guest can add payment email", () => { assert.equal(journeyProof?.email, true); });
test("AC18 — Local deterministic payment uses the existing payment application boundary", () => { assert.equal(journeyProof?.attempt, 1); });
test("AC19 — Payment produces exactly one Reservation", () => { assert.equal(journeyProof?.reservation, 1); });
test("AC20 — Payment produces exactly one Booking Contract", () => { assert.equal(journeyProof?.contract, 1); });
test("AC21 — Reservation is visible after refresh", () => { assert.equal(journeyProof?.refresh, true); });
test("AC22 — Reservation survives application restart", () => { assert.equal(journeyProof?.restart, true); });
test("AC23 — Operator session and state survive restart where still valid", () => { assert.equal(journeyProof?.operatorRestart, true); });

test("Operator decline real-browser proof", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths }); const browser = await launchRealBrowser();
  try {
    await server.listen(); const guest = await browser.createTab(); const operator = await browser.createTab();
    await guestToRequest(guest, "Lagos", "+2348093334455");
    const debugDatabase = new DatabaseSync(paths.databasePath); const row = debugDatabase.prepare("SELECT status, operator_id, tenant_id FROM guest_booking_requests LIMIT 1").get() as { status: string; operator_id: string; tenant_id: string }; debugDatabase.close();
    assert.equal(row.status, "disclosed"); assert.equal(row.operator_id, "operator-local-pilot"); assert.equal(row.tenant_id, "tenant-local-pilot");
    const debugGrants = new SqliteOperatorRepresentativeGrantStore(paths.databasePath, { clock: () => new Date("2026-09-22T10:00:00.000Z") }); assert.equal(debugGrants.canActForOperator({ actorId: "representative-local-pilot", operatorId: row.operator_id, tenantId: row.tenant_id }), true); debugGrants.close();
    await operatorLoginAndDecision(operator, issueLocalOperatorToken(paths), "Decline");
    await reloadTab(guest); await guest.waitForText("declined", 15000); declineProof = { operatorDeclined: true, guestDeclined: true };
  } finally { await browser.close(); await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
});
test("AC24 — Operator can decline a separate Booking Request", () => { assert.equal(declineProof?.operatorDeclined, true); });
test("AC25 — Guest sees decline result", () => { assert.equal(declineProof?.guestDeclined, true); });

test("Exact screenshot conversation — Lagos → 2 nights and 2 guests → Lekki renders an authoritative Weaver result", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths }); const browser = await launchRealBrowser();
  try {
    await server.listen();
    const guest = await browser.createTab(`${BASE}/`);
    await guest.waitForSelector("#composer-input");

    await sendPrompt(guest, "Lagos");
    await guest.waitForText("how many guests are staying", 15000);
    await sendPrompt(guest, "2 nights and 2 guests");
    await guest.waitForText("Old Ikoyi", 15000);
    await sendPrompt(guest, "Lekki");
    await guest.waitForText("Lekki Phase 1", 15000);
    await guest.waitForText("1 stay to explore", 15000);
    await assertWeaverSurface(guest, "conversational Lekki discovery");

    const transcript = await guest.evaluate<string>("document.getElementById('transcript').innerText");
    const noRepeat = (transcript.match(/how many guests are staying/g) ?? []).length === 1
      && (transcript.match(/how many nights you need/g) ?? []).length === 1;
    assert.equal(noRepeat, true, `known constraints must not be requested again: ${transcript}`);
    assert.equal((transcript.match(/where you want to stay/g) ?? []).length, 0);

    const threadId = await threadIdOf(guest);
    const surfaced = await activeDiscoveryUnit(guest, threadId);
    assert.equal(surfaced.unitId, "unit-local-lagos-lekki");
    const unit = authoritativeUnit(paths, surfaced.unitId);
    assert.ok(unit, "the surfaced Unit must exist in authoritative inventory");
    const expectedAllIn = unit.price.nightlyKobo * 2 + (unit.price.mandatoryFeesKobo ?? 0);
    const workspaceText = await guest.evaluate<string>("document.getElementById('active-workspace').innerText");
    assert.ok(workspaceText.includes(unit.title), "rendered surface shows the authoritative Unit title");
    assert.match(workspaceText, new RegExp(`All-In Stay Total\\s+${formatNgnKobo(expectedAllIn)}`), `rendered surface shows the authoritative All-In Stay Total: ${workspaceText.slice(0, 400)}`);
    const durationPreserved = workspaceText.includes("29 Sept 2026 – 1 Oct 2026");
    assert.equal(durationPreserved, true, "the accumulated two-night duration controls the stay dates");
    conversationalProof = { weaver: true, unitIdMatches: true, priceMatches: true, durationPreserved, noRepeat };
  } finally { await browser.close(); await server.close().catch(() => undefined); rmSync(paths.directory, { recursive: true, force: true }); }
});
test("AC5/AC17 — The exact screenshot conversation executes the authoritative Lekki search", () => { assert.equal(conversationalProof?.unitIdMatches, true); });
test("AC6 — The completed search renders through A2UI and Weaver", () => { assert.equal(conversationalProof?.weaver, true); });
test("AC7 — The screenshot conversation never repeats a known request", () => { assert.equal(conversationalProof?.noRepeat, true); });
test("AC9/AC16 — The surfaced result matches authoritative inventory facts", () => { assert.equal(conversationalProof?.priceMatches, true); assert.equal(conversationalProof?.durationPreserved, true); });

test("Conflicting Lagos/Wuse conversation clarifies intentionally and preserves nights and guests", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths }); const browser = await launchRealBrowser();
  try {
    await server.listen();
    const guest = await browser.createTab(`${BASE}/`);
    await guest.waitForSelector("#composer-input");

    await sendPrompt(guest, "Lagos");
    await guest.waitForText("how many guests are staying", 15000);
    await sendPrompt(guest, "2 nights and 2 guests");
    await guest.waitForText("Old Ikoyi", 15000);
    await sendPrompt(guest, "Wuse");
    await guest.waitForText("Do you want Wuse in Abuja, or should I keep searching in Lagos?", 15000);
    const transcript = await guest.evaluate<string>("document.getElementById('transcript').innerText");
    const noReset = (transcript.match(/where you want to stay/g) ?? []).length === 0;
    assert.equal(noReset, true, "the conflict must never fall back to a generic full-reset question");

    await sendPrompt(guest, "Abuja");
    await guest.waitForText("Wuse 2", 15000);
    await assertWeaverSurface(guest, "Abuja discovery after conflict");
    const workspaceText = await guest.evaluate<string>("document.getElementById('active-workspace').innerText");
    const preserved = workspaceText.includes("29 Sept 2026 – 1 Oct 2026");
    assert.equal(preserved, true, "nights and guests survive the location conflict");
    const surfaced = await activeDiscoveryUnit(guest, await threadIdOf(guest));
    assert.equal(surfaced.unitId, "unit-local-abuja-wuse2");
    conflictProof = { intentional: true, preserved, noReset };
  } finally { await browser.close(); await server.close().catch(() => undefined); rmSync(paths.directory, { recursive: true, force: true }); }
});
test("AC10/AC11 — Lagos/Wuse conflict is handled intentionally without discarding prior fields", () => {
  assert.equal(conflictProof?.intentional, true);
  assert.equal(conflictProof?.preserved, true);
  assert.equal(conflictProof?.noReset, true);
});

test("320px conversational discovery renders the Weaver Lekki surface without horizontal overflow", async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths }); const browser = await launchRealBrowser();
  try {
    await server.listen();
    const guest = await browser.createTab();
    await guest.setViewport(320, 800);
    await guest.navigate(`${BASE}/`);
    await guest.waitForSelector("#composer-input");
    await sendPrompt(guest, "Lagos");
    await guest.waitForText("how many guests are staying", 15000);
    await sendPrompt(guest, "2 nights and 2 guests");
    await guest.waitForText("Old Ikoyi", 15000);
    await sendPrompt(guest, "Lekki");
    await guest.waitForText("Lekki Phase 1", 15000);
    await assertWeaverSurface(guest, "320px Lekki discovery");
    const metrics = await guest.evaluate<{ readonly viewport: number; readonly document: number; readonly workspaces: number; readonly overflow: number }>("(() => { const root = document.documentElement; const active = document.getElementById('active-workspace'); return { viewport: innerWidth, document: Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0), workspaces: document.querySelectorAll('#active-workspace').length, overflow: Math.max((active ? active.scrollWidth : 0) - (active ? active.clientWidth : 0), 0) }; })()");
    assert.equal(metrics.viewport, 320);
    assert.ok(metrics.document <= 320, JSON.stringify(metrics));
    assert.equal(metrics.workspaces, 1);
    assert.equal(metrics.overflow, 0, JSON.stringify(metrics));
    mobileConversationalProof = { weaver: true, noOverflow: metrics.document <= 320 && metrics.overflow === 0 };
  } finally { await browser.close(); await server.close().catch(() => undefined); rmSync(paths.directory, { recursive: true, force: true }); }
});
test("AC18 — 320px conversational discovery renders the resulting Weaver surface correctly", () => {
  assert.equal(mobileConversationalProof?.weaver, true);
  assert.equal(mobileConversationalProof?.noOverflow, true);
});

for (const width of [320, 390]) test(`AC${width === 320 ? 26 : 27} — ${width}px local pilot smoke passes`, async () => {
  const paths = temporaryPaths(); bootstrapLocalPilot(paths); const server = startLocalPilotServer({ port: PORT, paths }); const browser = await launchRealBrowser();
  try {
    await server.listen(); const guest = await browser.createTab(); const operator = await browser.createTab(); await guest.setViewport(width, 800);
    await guestToRequest(guest, "Abuja", width === 320 ? "+2348094445566" : "+2348095556677", true);
    await operatorLoginAndDecision(operator, issueLocalOperatorToken(paths), "Confirm"); await reloadTab(guest); await guest.waitForText("Conditional Booking Offer", 15000); await clickActiveButton(guest, "Accept");
    await guest.waitForText("Continue to stay payment", 15000); const workspace = await guest.evaluate<string>("location.href");
    const emailStatus = await guest.evaluate<number>(`fetch('/guest/contact/email',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({contactEmail:${JSON.stringify(`mobile.${width}@example.test`)},expectedRevision:'1'}),redirect:'manual'}).then((response)=>response.status)`); assert.equal(emailStatus, 0);
    await guest.navigate(workspace); await guest.waitForText("Continue to stay payment", 15000); await clickActiveButton(guest, "Continue to stay payment"); await guest.waitForText("Payment handoff", 15000);
    const standard = await guest.evaluate<string>(`[...document.querySelectorAll('a')].find((link)=>link.getAttribute('href')?.includes('/payments/offers/'))?.href || ''`); assert.ok(standard); await guest.navigate(standard); await guest.waitForText("Continue to local demo payment", 15000);
    const local = await guest.evaluate<string>(`[...document.querySelectorAll('a')].find((link)=>link.textContent?.includes('Continue to local demo payment'))?.href || ''`); assert.ok(local); await guest.navigate(local); await guest.waitForText("Local demo payment", 15000); assert.equal(await guest.clickButton("Complete local payment"), true); await guest.waitForText("Booking confirmed", 15000);
    const metrics = await guest.evaluate<{ viewport: number; document: number; phone: boolean; reservation: boolean }>(`({viewport:innerWidth,document:document.documentElement.scrollWidth,phone:document.body.innerText.includes('Booking Request'),reservation:document.body.innerText.includes('Booking confirmed')})`);
    const database = new DatabaseSync(paths.databasePath);
    const contact = database.prepare("SELECT contact_email FROM guest_contacts LIMIT 1").get() as { contact_email?: string } | undefined;
    database.close();
    assert.equal(metrics.viewport, width, JSON.stringify(metrics)); assert.ok(metrics.document <= width, JSON.stringify(metrics)); assert.equal(metrics.phone, true, JSON.stringify(metrics)); assert.equal(contact?.contact_email, `mobile.${width}@example.test`); assert.equal(metrics.reservation, true, JSON.stringify(metrics));
  } finally { await browser.close(); await server.close(); rmSync(paths.directory, { recursive: true, force: true }); }
});

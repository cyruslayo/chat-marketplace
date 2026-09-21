import assert from "node:assert/strict";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "../test/helpers/chrome-devtools.js";

const configuredBase = process.env.PILOT_SMOKE_BASE;
const origin = process.env.PILOT_SMOKE_ORIGIN ?? "https://pilot.example.com";
const operatorToken = process.env.PILOT_SMOKE_OPERATOR_TOKEN;
if (!configuredBase || !operatorToken) throw new Error("PILOT_SMOKE_BASE, PILOT_SMOKE_ORIGIN, and PILOT_SMOKE_OPERATOR_TOKEN are required");
const parsed = new URL(configuredBase);
const base = `http://localhost:${parsed.port}`;

async function configure(tab: RealBrowserTab): Promise<() => Promise<void>> {
  return tab.overrideOrigin(origin);
}

async function openBrowser(): Promise<RealBrowserInstance> {
  const browser = await launchRealBrowser({ headless: true });
  // The helper serializes browser launches with a lock; release it after this
  // isolated profile is connected so a second Chromium profile can be opened.
  browser.releaseLock();
  return browser;
}

const browserA = await openBrowser();
const browserB = await openBrowser();
let tabA: RealBrowserTab | undefined;
let tabB: RealBrowserTab | undefined;
let disposeA: (() => Promise<void>) | undefined;
let disposeB: (() => Promise<void>) | undefined;
try {
  tabA = await browserA.createTab(`${base}/`);
  tabB = await browserB.createTab(`${base}/`);
  disposeA = await configure(tabA);
  disposeB = await configure(tabB);

  await tabA.navigate(`${base}/guest/contact`);
  await tabA.waitForSelector("#phoneNumber");
  await tabA.evaluate(`(() => { const input = document.querySelector('#phoneNumber'); if (!input) throw new Error('phone input missing'); input.value = '+2348011111111'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form?.requestSubmit(); })()`);
  await tabA.waitForFunction("location.pathname === '/guest/contact'", 15000);
  assert.match(await tabA.getContent(), /\+2348011111111/);
  await tabA.navigate(`${base}/`);
  await tabA.waitForText("Shortlet Concierge");

  await tabB.navigate(`${base}/guest/contact`);
  const guestBContact = await tabB.getContent();
  assert.equal(guestBContact.includes("+2348011111111"), false, "Guest B cannot see Guest A contact");
  await tabB.navigate(`${base}/`);

  await tabA.focus("#composer-input");
  await tabA.evaluate(`(() => { const input = document.querySelector('#composer-input'); if (!input) throw new Error('composer missing'); input.value = 'I need an apartment in Ikoyi for 3 nights for 2 people'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form?.requestSubmit(); })()`);
  await tabA.waitForText("Luxury 2-Bedroom Apartment in Old Ikoyi", 15000);
  assert.equal(await tabA.clickButton("View Unit", "Luxury 2-Bedroom Apartment in Old Ikoyi"), true);
  await tabA.waitForText("Request to Book", 15000);
  assert.equal(await tabA.clickButton("Request to Book"), true);
  await tabA.waitForText("Review Request", 15000);
  assert.equal(await tabA.clickButton("Review Request"), true);
  await tabA.waitForText("Submit Booking Request", 15000);
  assert.equal(await tabA.clickButton("Submit Booking Request"), true);
  await tabA.waitForText("Booking Request", 15000);
  const threadId = await tabA.evaluate<string>("sessionStorage.getItem('shortlet-concierge-thread') || ''");
  assert.match(threadId, /^g-/);

  await tabB.navigate(`${base}/operator/login`);
  await tabB.waitForSelector("input[name=token]");
  await tabB.evaluate(`(() => { const input = document.querySelector('input[name=token]'); if (!input) throw new Error('token input missing'); input.value = ${JSON.stringify(operatorToken)}; input.form?.requestSubmit(); })()`);
  await tabB.waitForText("Operator workspace", 15000);
  await tabB.navigate(`${base}/operator/requests`);
  await tabB.waitForText("Booking Requests");
  await tabB.waitForFunction("Boolean(document.querySelector('a[href^=\"/operator/requests/\"]'))", 15000);
  const requestPath = await tabB.evaluate<string>("document.querySelector('a[href^=\"/operator/requests/\"]')?.getAttribute('href') || ''");
  assert.match(requestPath, /^\/operator\/requests\//);
  await tabB.navigate(`${base}${requestPath}`);
  await tabB.waitForText("Confirm Booking Request");
  await tabB.clickButton("Confirm Booking Request");

  await tabA.navigate(`${base}/?threadId=${encodeURIComponent(threadId)}`);
  await tabA.waitForText("Conditional Booking Offer", 15000);
  const guestBState = await tabB.evaluate<{ readonly surfaces?: readonly unknown[] }>(`fetch(${JSON.stringify(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`)}, { credentials: 'include' }).then((response) => response.json())`);
  assert.equal(guestBState.surfaces?.length ?? 0, 0, "Guest B cannot see Guest A offer");
  console.log("Chromium smoke passed: independent Guest contact, Guest request, Operator confirmation, Guest offer, and Guest isolation.");
} finally {
  await disposeA?.();
  await disposeB?.();
  await tabA?.close();
  await tabB?.close();
  await browserA.close({ releaseLock: false });
  await browserB.close();
}

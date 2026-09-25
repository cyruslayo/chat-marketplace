import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaystackClient } from "../domains/shortlet/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";

function firstAction(surface: { readonly a2uiMessages: readonly unknown[]; readonly surfaceId: string }): { readonly name: string; readonly context: Record<string, unknown>; readonly surfaceId: string; readonly sourceComponentId: string; readonly timestamp: string } {
  const update = surface.a2uiMessages.find((message) => message !== null && typeof message === "object" && "updateComponents" in message) as { updateComponents?: { components?: unknown } } | undefined;
  const components = Array.isArray(update?.updateComponents?.components) ? update.updateComponents.components : [];
  const component = components.find((value): value is { component?: unknown; action?: { event?: { name?: unknown; context?: unknown } } } => value !== null && typeof value === "object" && (value as { component?: unknown }).component === "Button" && Boolean((value as { action?: { event?: unknown } }).action?.event));
  const event = component?.action?.event;
  assert.equal(typeof event?.name, "string");
  assert.ok(event);
  assert.ok(event.context !== null && typeof event.context === "object" && !Array.isArray(event.context));
  return { name: event.name as string, context: event.context as Record<string, unknown>, surfaceId: surface.surfaceId, sourceComponentId: "real-browser-test", timestamp: new Date().toISOString() };
}

async function bindThread(tab: RealBrowserTab, threadId: string): Promise<void> {
  const result = await tab.evaluate<{ status: number; body: string }>(`fetch('/api/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: ${JSON.stringify(threadId)}, text: 'return to payment' }) }).then(async (response) => ({ status: response.status, body: await response.text() }))`);
  assert.equal(result.status, 200, result.body);
}

test("Paystack callback and handoff routes restore authoritative state in real Chromium", async () => {
  const directory = mkdtempSync(join(tmpdir(), "paystack-rb-"));
  const databasePath = join(directory, "guest.sqlite");
  let providerStatus: "pending" | "success" = "success";
  let providerReference = "";
  let providerAmount = 0;
  const paystackClient: PaystackClient = {
    configuration: { environment: "test", callbackBaseUrl: "http://127.0.0.1" },
    async initializeTransaction(input) { providerReference = input.reference; providerAmount = input.amountKobo; return { authorizationUrl: "https://checkout.paystack.com/real-browser-proof", reference: input.reference, environment: "test" }; },
    async verifyTransaction(reference) { return { verified: true, status: providerStatus, amountKobo: providerAmount, currency: "NGN", pspReference: reference, payerId: "guest-demo-101", environment: "test" }; },
    verifyWebhookSignature() { return true; },
  };
  let clockTime = new Date("2026-09-03T10:00:00Z");
  const environment = new LocalGuestEnvironment({ databasePath, clock: () => clockTime, paystackClient });
  const server = startLocalGuestServer({ port: 0, environment });
  const browser = await launchRealBrowser({ headless: true });
  let tab: RealBrowserTab | undefined;
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    const threadId = `g-${crypto.randomUUID()}`;
    let turn = await server.app.handleTurn(threadId, "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
    if (!turn.ok) throw new Error(turn.message);
    turn = await server.app.handleEventAsync(threadId, firstAction(turn.surfaces[0]!));
    if (!turn.ok) throw new Error(turn.message);
    turn = await server.app.handleEventAsync(threadId, firstAction(turn.surfaces[0]!));
    if (!turn.ok) throw new Error(turn.message);
    turn = await server.app.handleEventAsync(threadId, firstAction(turn.surfaces[0]!));
    if (!turn.ok) throw new Error(turn.message);
    turn = await server.app.handleEventAsync(threadId, firstAction(turn.surfaces[0]!));
    if (!turn.ok) throw new Error(turn.message);
    const requestId = environment.interactionStore.listBookingRequestIds()[0]!;
    environment.simulateOperatorAcceptance(requestId);
    const offered = server.app.getState(threadId)!;
    turn = await server.app.handleEventAsync(threadId, firstAction(offered.surfaces.at(-1)!));
    if (!turn.ok) throw new Error(turn.message);
    turn = await server.app.handleEventAsync(threadId, firstAction(turn.surfaces[0]!));
    assert.equal(turn.ok, true);
    const offerId = environment.interactionStore.findConditionalOfferByRequestId(requestId)!.offerId;
    assert.ok(providerReference, "Paystack initialization must happen on the server-backed Guest action path");

    tab = await browser.createTab(`${base}/?threadId=${threadId}`);
    await tab.waitForSelector("#composer-input");
    await bindThread(tab, threadId);
    await tab.navigate(`${base}/payments/offers/${encodeURIComponent(offerId)}/continue`);
    const providerLocation = await tab.evaluate<string>("location.href");
    assert.equal(new URL(providerLocation).origin + new URL(providerLocation).pathname, "https://checkout.paystack.com/real-browser-proof");
    await tab.navigate(`${base}/?threadId=${threadId}`);
    await tab.waitForSelector("#composer-input");

    providerStatus = "pending";
    await tab.navigate(`${base}/payments/paystack/callback?reference=${encodeURIComponent(providerReference)}`);
    assert.equal((await tab.evaluate<string>("location.href")).startsWith(`${base}/?threadId=`), true);
    assert.equal(environment.cardPaymentApp.manager.getPaymentJourney(offerId)?.stage, "stay_payment_processing");

    providerStatus = "success";
    await tab.navigate(`${base}/payments/paystack/callback?reference=${encodeURIComponent(providerReference)}`);
    assert.equal((await tab.evaluate<string>("location.href")).startsWith(`${base}/?threadId=`), true);
    assert.equal(environment.cardPaymentApp.manager.getPaymentJourney(offerId)?.stage, "stay_settled");
    await tab.navigate(`${base}/payments/offers/${encodeURIComponent(offerId)}/continue`);
    const depositReference = providerReference;
    assert.notEqual(depositReference, "");
    await tab.navigate(`${base}/payments/paystack/callback?reference=${encodeURIComponent(depositReference)}`);
    assert.equal(environment.cardPaymentApp.manager.getPaymentJourney(offerId)?.stage, "confirmed");

    await tab.navigate(`${base}/payments/paystack/callback?reference=${encodeURIComponent(providerReference)}`);
    assert.equal(environment.interactionStore.listBookingSnapshotOfferIds().length, 1);

    await tab.setViewport(320, 800);
    await tab.navigate(`${base}/?threadId=${threadId}`);
    await tab.waitForSelector("#composer-input");
    const overflow = await tab.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth");
    assert.equal(overflow, true);
  } finally {
    try { await tab?.close(); } catch {}
    await browser.close();
    await server.close();
    try { rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

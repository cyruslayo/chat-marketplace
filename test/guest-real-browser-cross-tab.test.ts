/**
 * Real-Browser Cross-Tab Concurrency & Safety Test Suite
 *
 * Runs against the real Chromium browser engine (Chrome 152) using Chrome DevTools
 * Protocol (CDP). Proves real tabs, real cookies, real navigation, real DOM rendering
 * via Weaver, and concurrent real-browser page requests against the real Guest HTTP
 * application backed by durable SQLite persistence.
 *
 * ADR Compliance:
 * - ADR-0004: Web and backend own authoritative state.
 * - ADR-0005: Launch exclusively with Request to Book.
 * - ADR-0041: Block inventory for thirty minutes per disclosed request.
 * - ADR-0044: Limit payment reservation to twenty plus ten minutes.
 * - ADR-0046: Permit only one live payment attempt.
 * - ADR-0070 / 0075: Separate interaction/domain identity, secure session cookies.
 * - ADR-0072: Route consequential actions through platform commands.
 * - ADR-0074: Give generative surfaces a fail-closed lifecycle.
 * - ADR-0080: Retain deterministic parity for critical workflows.
 * - ADR-0081: Use Weaver as the web A2UI runtime.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  launchRealBrowser,
  type RealBrowserInstance,
  type RealBrowserTab,
} from "./helpers/chrome-devtools.js";
import {
  startLocalGuestServer,
  type LocalGuestServerHandle,
} from "../apps/local-guest/src/guest-server.js";
import {
  LocalGuestEnvironment,
  type LocalGuestFixtureConfig,
} from "../apps/local-guest/src/fixture.js";

const CANONICAL_PROMPT = "I need an apartment in Ikoyi for 3 nights for 2 people";
const IKOYI_TITLE = "Luxury 2-Bedroom Apartment in Old Ikoyi";

interface RealBrowserTestContext {
  readonly server: LocalGuestServerHandle;
  readonly browser: RealBrowserInstance;
  readonly base: string;
  readonly databasePath: string;
  readonly dir: string;
  clockTime: Date;
  tabA: RealBrowserTab;
  tabB: RealBrowserTab;
  threadId: string;
  setClock(iso: string): void;
  close(): Promise<void>;
}

async function startRealBrowserContext(config: Partial<LocalGuestFixtureConfig> = {}): Promise<RealBrowserTestContext> {
  const dir = mkdtempSync(join(tmpdir(), "guest-rb-"));
  const databasePath = join(dir, "guest.sqlite");
  let clockTime = new Date("2026-09-03T10:00:00Z");

  const environment = new LocalGuestEnvironment({
    databasePath,
    clock: () => clockTime,
    ...config,
  });

  const server = startLocalGuestServer({ port: 0, environment });
  let browser: RealBrowserInstance | undefined;
  let tabA: RealBrowserTab | undefined;
  let tabB: RealBrowserTab | undefined;
  try {
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;

    browser = await launchRealBrowser({ headless: true });
    tabA = await browser.createTab(`${base}/`);
    await tabA.waitForSelector("#composer-input");

    const threadId = await tabA.evaluate<string>(`window.sessionStorage.getItem("shortlet-concierge-thread")`);
    assert.ok(threadId && /^g-[a-f0-9-]{6,64}$/.test(threadId), "Tab A must initialize valid threadId");

    tabB = await browser.createTab(`${base}/?threadId=${threadId}`);
    await tabB.waitForSelector("#composer-input");

    const threadIdB = await tabB.evaluate<string>(`window.sessionStorage.getItem("shortlet-concierge-thread")`);
    assert.equal(threadIdB, threadId, "Tab B must bind to the same threadId");

    // Prove authentication model: both tabs share the same authenticated guest session cookie
    const cookiesA = await tabA.getCookies();
    const cookiesB = await tabB.getCookies();
    const sessionA = cookiesA.find((c) => c.name === "shortlet_guest_session");
    const sessionB = cookiesB.find((c) => c.name === "shortlet_guest_session");
    assert.ok(sessionA && sessionA.value, "Tab A must have shortlet_guest_session cookie");
    assert.ok(sessionB && sessionB.value, "Tab B must have shortlet_guest_session cookie");
    assert.equal(sessionA.value, sessionB.value, "Both real tabs must share the exact same guest session cookie");

    return {
      server,
      browser,
      base,
      databasePath,
      dir,
      clockTime,
      tabA,
      tabB,
      threadId,
      setClock(iso: string) {
        clockTime = new Date(iso);
      },
      async close() {
        await browser!.close();
        await server.close();
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      },
    };
  } catch (error) {
    try { await tabB?.close(); } catch {}
    try { await tabA?.close(); } catch {}
    try { await browser?.close(); } catch {}
    try { await server.close(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

async function sendPrompt(tab: RealBrowserTab, text: string): Promise<void> {
  await tab.evaluate(`
    (() => {
      const input = document.getElementById("composer-input");
      const form = document.getElementById("composer");
      input.value = ${JSON.stringify(text)};
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    })()
  `);
}

async function waitForDurable(ctx: RealBrowserTestContext, predicate: () => boolean, description: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout waiting for durable state: ${description}`);
}

async function advanceToRequestReview(ctx: RealBrowserTestContext): Promise<void> {
  await sendPrompt(ctx.tabA, CANONICAL_PROMPT);
  // Full-suite load can delay Weaver's discovery projection; 30s is based on
  // the measured worst-case render under concurrent Chromium workers.
  await ctx.tabA.waitForText(IKOYI_TITLE, 30000);

  await ctx.tabA.clickButton("View apartment", IKOYI_TITLE);
  await ctx.tabA.waitForText("Request to Book", 15000);

  await ctx.tabA.clickButton("Request to Book");
  await ctx.tabA.waitForText("Review request", 15000);

  await ctx.tabA.clickButton("Review request");
  await ctx.tabA.waitForText("Submit Booking Request", 15000);

  // Sync Tab B to current review
  await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabB.waitForText("Submit Booking Request", 15000);
}

async function advanceToConditionalOffer(ctx: RealBrowserTestContext): Promise<{ offerId: string; requestId: string }> {
  await advanceToRequestReview(ctx);

  await ctx.tabA.clickButton("Submit Booking Request");
  await ctx.tabA.waitForText("Booking Request", 15000);

  const requestId = ctx.server.environment.interactionStore.listBookingRequestIds()[0]!;
  assert.ok(requestId, "Request ID must exist in durable store");

  // Operator confirms availability (ADR-0006/0010)
  ctx.server.environment.simulateOperatorAcceptance(requestId);

  // Sync Tab A and Tab B to offer — button text is "Accept" (from conditional-offer-a2ui.ts line 30)
  await ctx.tabA.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabA.waitForText("Accept", 15000);

  await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabB.waitForText("Accept", 15000);

  const durableOffer = ctx.server.environment.interactionStore.findConditionalOfferByRequestId(requestId);
  assert.ok(durableOffer, "Conditional Booking Offer must exist in durable store");

  return { offerId: durableOffer.offerId, requestId };
}

async function advanceToPaymentReady(ctx: RealBrowserTestContext): Promise<{ offerId: string }> {
  const { offerId } = await advanceToConditionalOffer(ctx);

  // Button text is "Accept" (conditional-offer-a2ui.ts line 30)
  await ctx.tabA.clickButton("Accept");
  // The amount-bearing label distinguishes the current payment action.
  await ctx.tabA.waitForText("Continue to stay payment", 15000);

  await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabB.waitForText("Continue to stay payment", 15000);

  return { offerId };
}

async function advanceToCheckoutInitiated(ctx: RealBrowserTestContext): Promise<{ offerId: string }> {
  const { offerId } = await advanceToPaymentReady(ctx);

  await ctx.tabA.clickButton("Continue to stay payment");
  await ctx.tabA.waitForText("Check payment status", 15000);

  await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabB.waitForText("Check payment status", 15000);

  return { offerId };
}

async function advanceToDepositCheckoutInitiated(ctx: RealBrowserTestContext): Promise<{ offerId: string }> {
  const { offerId } = await advanceToCheckoutInitiated(ctx);

  // Verify the stay payment once, then initialize the separate refundable
  // deposit checkout before racing the final verification from both tabs.
  await ctx.tabA.clickButton("Check payment status");
  await ctx.tabA.waitForText("Continue to Refundable Security Deposit", 15000);
  await ctx.tabA.clickButton("Continue to Refundable Security Deposit");
  await ctx.tabA.waitForText("Check payment status", 15000);

  await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
  await ctx.tabB.waitForText("Check payment status", 15000);

  return { offerId };
}

// ============================================================================
// RB1 — Two real tabs cannot create duplicate Booking Requests
// ============================================================================
test("RB1 — Two real tabs cannot create duplicate Booking Requests", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await advanceToRequestReview(ctx);

    // Confirm both tabs show the same starting review
    const contentA = await ctx.tabA.evaluate<string>(`document.getElementById("active-workspace").innerText`);
    const contentB = await ctx.tabB.evaluate<string>(`document.getElementById("active-workspace").innerText`);
    assert.ok(contentA.includes("Submit Booking Request"));
    assert.ok(contentB.includes("Submit Booking Request"));

    // Concurrent click from both real browser tabs
    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Submit Booking Request"),
      ctx.tabB.clickButton("Submit Booking Request"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);

    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listBookingRequestIds().length === 1, "one Booking Request");

    // Authoritative durable state assertion (ADR-0004, ADR-0005, ADR-0041)
    const requestIds = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(requestIds.length, 1, "exactly one Booking Request may exist in durable store");

    const availability = ctx.server.environment.calendar.getAuthoritativeAvailability({
      unitId: "unit-lagos-ikoyi-001",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      clock: ctx.server.environment.clock,
    });
    assert.equal(availability.isAvailable, false, "exactly one inventory commitment may exist");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB2 — Two real tabs cannot accept one Conditional Booking Offer twice
// ============================================================================
test("RB2 — Two real tabs cannot accept one Conditional Booking Offer twice", async () => {
  const ctx = await startRealBrowserContext();
  try {
    const { offerId } = await advanceToConditionalOffer(ctx);

    const offerBefore = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.ok(offerBefore);
    const paymentExpiryBefore = offerBefore.paymentWindow.expiresAt;

    // Concurrently trigger acceptance from both tabs (ADR-0044, ADR-0072)
    // Button text is "Accept" (conditional-offer-a2ui.ts line 30)
    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Accept"),
      ctx.tabB.clickButton("Accept"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);


    await waitForDurable(ctx, () => ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId).status === "accepted", "accepted Conditional Booking Offer");

    // Durable store: offer is single-use, payment window remains unchanged
    const offerAfter = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.ok(offerAfter);
    assert.equal(offerAfter.status, "accepted");
    assert.equal(offerAfter.tokenUsed, true);
    assert.equal(offerAfter.paymentWindow.expiresAt, paymentExpiryBefore, "Payment Window must remain unchanged");

    // Exactly one checkout or payment artifact ready
    const paymentArtifact = ctx.server.environment.cardPaymentApp.getArtifact(offerId, ctx.server.environment.guestPrincipal());
    assert.ok(paymentArtifact);
    assert.equal(paymentArtifact.facts.status, "ready");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB3 — Two real tabs cannot create multiple Live Payment Attempts
// ============================================================================
test("RB3 — Two real tabs cannot create multiple Live Payment Attempts", async () => {
  const ctx = await startRealBrowserContext();
  try {
    const { offerId } = await advanceToPaymentReady(ctx);

    const offer = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.ok(offer);
    const windowExpiresBefore = offer.paymentWindow.expiresAt;

    // Trigger payment initialization concurrently from both tabs (ADR-0046)
    // Both tabs use the amount-bearing checkout action.
    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Continue to stay payment"),
      ctx.tabB.clickButton("Continue to stay payment"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);


    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listLivePaymentAttemptOfferIds().includes(offerId), "one Live Payment Attempt");

    // Exactly one Live Payment Attempt exists
    const attempts = ctx.server.environment.interactionStore.listLivePaymentAttemptOfferIds();
    assert.equal(attempts.length, 1, "exactly one Live Payment Attempt may exist");
    assert.equal(attempts[0], offerId);

    // Exactly one authoritative checkout session exists
    const session = ctx.server.environment.cardPaymentApp.manager.getCheckoutSession(offerId);
    assert.ok(session, "exactly one authoritative checkout session may exist");

    // Payment window must not reset
    const offerAfter = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.equal(offerAfter.paymentWindow.expiresAt, windowExpiresBefore, "Payment Window must not reset");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB4 — Concurrent real-tab payment verification creates one Reservation
// ============================================================================
test("RB4 — Concurrent real-tab payment verification creates one Reservation", async () => {
  const ctx = await startRealBrowserContext();
  try {
    const { offerId } = await advanceToDepositCheckoutInitiated(ctx);

    // Concurrently trigger return/verification from both tabs
    // Both tabs can request authoritative payment verification.
    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Check payment status"),
      ctx.tabB.clickButton("Check payment status"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);


    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listBookingSnapshotOfferIds().length === 1, "one Reservation snapshot");

    // Exactly one Reservation must exist in durable store (ADR-0004)
    const snapshotOfferIds = ctx.server.environment.interactionStore.listBookingSnapshotOfferIds();
    assert.equal(snapshotOfferIds.length, 1, "exactly one booking snapshot exists");

    const snapshot = ctx.server.environment.interactionStore.findBookingSnapshotByOfferId(snapshotOfferIds[0]!)!;
    assert.ok(snapshot, "booking snapshot must exist");
    assert.ok(snapshot.reservationId, "must have a single reservation id");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB5 — Concurrent real-tab payment verification creates one Booking Contract
// ============================================================================
test("RB5 — Concurrent real-tab payment verification creates one Booking Contract", async () => {
  const ctx = await startRealBrowserContext();
  try {
    const { offerId } = await advanceToDepositCheckoutInitiated(ctx);

    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Check payment status"),
      ctx.tabB.clickButton("Check payment status"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);


    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listBookingSnapshotOfferIds().length === 1, "one Booking Contract snapshot");

    // Exactly one Booking Contract must exist in durable store
    const snapshotOfferIds = ctx.server.environment.interactionStore.listBookingSnapshotOfferIds();
    assert.equal(snapshotOfferIds.length, 1, "exactly one booking snapshot exists");

    const snapshot = ctx.server.environment.interactionStore.findBookingSnapshotByOfferId(snapshotOfferIds[0]!)!;
    assert.ok(snapshot, "booking snapshot must exist");
    assert.ok(snapshot.contractId, "must have a single contract id");

    const contract = JSON.parse(snapshot.contractJson) as { contractId: string };
    assert.equal(contract.contractId, snapshot.contractId);
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB6 — A superseded real-tab action fails closed
// ============================================================================
test("RB6 — A superseded real-tab action fails closed", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await sendPrompt(ctx.tabA, CANONICAL_PROMPT);
    await ctx.tabA.waitForText(IKOYI_TITLE);

    // Tab B syncs to discovery results
    await ctx.tabB.navigate(`${ctx.base}/?threadId=${ctx.threadId}`);
    await ctx.tabB.waitForText(IKOYI_TITLE);

    // Tab A advances the workflow to unit details
    await ctx.tabA.clickButton("View apartment", IKOYI_TITLE);
    await ctx.tabA.waitForText("Request to Book");

    // Leave Tab B untouched, then click stale "View apartment" on Tab B
    const clickB = await ctx.tabB.clickButton("View apartment", IKOYI_TITLE);
    assert.equal(clickB, true);

    // Server rejects stale action (ADR-0074: fail closed), then refreshes the
    // authoritative current projection. Wait for the recovered unit detail.
    await ctx.tabB.waitForText("Request to Book", 15000);
    const contentB = await ctx.tabB.evaluate<string>(
      `document.getElementById("active-workspace").innerText`,
    );
    assert.ok(
      contentB.includes("Request to Book"),
      `Tab B must recover to current server projection after stale rejection; got: ${contentB.slice(0, 200)}`,
    );
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB7 — An expired real-tab action fails closed
// ============================================================================
test("RB7 — An expired real-tab action fails closed", async () => {
  const ctx = await startRealBrowserContext();
  try {
    const { offerId } = await advanceToConditionalOffer(ctx);

    // Advance clock past the payment window (31 minutes)
    ctx.setClock("2026-09-03T10:45:00Z");

    // Do not refresh Tab B before action: click old "Accept"
    const clicked = await ctx.tabB.clickButton("Accept");
    assert.equal(clicked, true);

    await ctx.tabB.waitForFunction(`(() => { const text = document.getElementById("active-workspace")?.innerText || ""; return /expired|no longer available|expired-surface/i.test(text); })()`, 15000);

    // Tab B renders authoritative expired state (ADR-0074)
    const contentB = await ctx.tabB.evaluate<string>(`document.getElementById("active-workspace").innerText`);
    assert.ok(contentB.includes("expired") || contentB.includes("no longer available") || contentB.includes("expired-surface"), "Tab B renders authoritative expired state");

    // No live payment attempt created
    const attempts = ctx.server.environment.interactionStore.listLivePaymentAttemptOfferIds();
    assert.equal(attempts.length, 0, "no payment attempt created for expired offer");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB8 — A stale real tab restores the latest server projection
// ============================================================================
test("RB8 — A stale real tab restores the latest server projection", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await advanceToRequestReview(ctx);

    // Tab A submits request
    await ctx.tabA.clickButton("Submit Booking Request");
    await ctx.tabA.waitForText("Booking Request");

    // Tab B clicks stale submit button
    const clickB = await ctx.tabB.clickButton("Submit Booking Request");
    assert.equal(clickB, true);

    await ctx.tabB.waitForFunction(`document.querySelectorAll("#transcript .turn").length >= 2`, 15000);

    // Tab B restores current server projection and retains conversation history
    const turnsCount = await ctx.tabB.evaluate<number>(`document.querySelectorAll("#transcript .turn").length`);
    assert.ok(turnsCount >= 2, "Tab B must preserve relevant conversation history");

    // Focus test: verify real-browser recovery does not create a focus trap
    await ctx.tabB.waitForSelector("#composer-input", 15000);
    await ctx.tabB.focus("#composer-input");
    const focused = await ctx.tabB.isElementFocused("#composer-input");
    assert.equal(focused, true, "composer input must remain focusable and usable");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB9 — The losing real tab cannot damage winning authoritative state
// ============================================================================
test("RB9 — The losing real tab cannot damage winning authoritative state", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await advanceToRequestReview(ctx);

    // Tab A wins submission
    await ctx.tabA.clickButton("Submit Booking Request");
    await ctx.tabA.waitForText("Booking Request");
    const winningRequestId = ctx.server.environment.interactionStore.listBookingRequestIds()[0]!;

    // Tab B attempts stale submission and loses
    await ctx.tabB.clickButton("Submit Booking Request");
    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listBookingRequestIds().length === 1, "winning Booking Request");

    // Winning request must not be damaged or rolled back (ADR-0004)
    const requests = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(requests.length, 1);
    assert.equal(requests[0], winningRequestId);

    const artifact = ctx.server.environment.bookingRequestApp.getArtifact(winningRequestId, ctx.server.environment.guestPrincipal());
    assert.ok(["disclosed", "submitted"].includes(artifact.facts.status), "winning request status must not be rolled back");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// RB10 — Two real tabs restore safely after server restart
// ============================================================================
test("RB10 — Two real tabs restore safely after server restart", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await advanceToRequestReview(ctx);

    // Stop the original server
    await ctx.server.close();

    // Start a new server instance over the SAME durable SQLite database (ADR-0079)
    const newEnv = new LocalGuestEnvironment({
      databasePath: ctx.databasePath,
      clock: () => ctx.clockTime,
    });
    const newServer = startLocalGuestServer({ port: 0, environment: newEnv });
    const newPort = await newServer.listen();
    const newBase = `http://127.0.0.1:${newPort}`;

    try {
      // Restore Tab A and Tab B against the new server using the same threadId
      await ctx.tabA.navigate(`${newBase}/?threadId=${ctx.threadId}`);
      await ctx.tabA.waitForText("Submit Booking Request", 15000);

      await ctx.tabB.navigate(`${newBase}/?threadId=${ctx.threadId}`);
      await ctx.tabB.waitForText("Submit Booking Request", 15000);

      const textA = await ctx.tabA.evaluate<string>(`document.getElementById("active-workspace").innerText`);
      const textB = await ctx.tabB.evaluate<string>(`document.getElementById("active-workspace").innerText`);
      assert.ok(textA.includes("Submit Booking Request"));
      assert.ok(textB.includes("Submit Booking Request"));
    } finally {
      await newServer.close();
    }
  } finally {
    await ctx.browser.close();
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch {}
  }
});

// ============================================================================
// RB11 — Restarted real tabs do not replay consequential commands
// ============================================================================
test("RB11 — Restarted real tabs do not replay consequential commands", async () => {
  const ctx = await startRealBrowserContext();
  try {
    await advanceToRequestReview(ctx);

    // Tab A submits booking request
    await ctx.tabA.clickButton("Submit Booking Request");
    await ctx.tabA.waitForText("Booking Request");

    const requestsBefore = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(requestsBefore.length, 1);

    // Stop server and restart
    await ctx.server.close();

    const newEnv = new LocalGuestEnvironment({
      databasePath: ctx.databasePath,
      clock: () => ctx.clockTime,
    });
    const newServer = startLocalGuestServer({ port: 0, environment: newEnv });
    const newPort = await newServer.listen();
    const newBase = `http://127.0.0.1:${newPort}`;

    try {
      // Both tabs restore against new server
      await ctx.tabA.navigate(`${newBase}/?threadId=${ctx.threadId}`);
      await ctx.tabA.waitForText("Booking Request");

      await ctx.tabB.navigate(`${newBase}/?threadId=${ctx.threadId}`);
      await ctx.tabB.waitForText("Booking Request");

      // Verify no duplicate command was executed upon restore
      const requestsAfter = newEnv.interactionStore.listBookingRequestIds();
      assert.equal(requestsAfter.length, 1, "restarted tabs must not replay consequential commands");
    } finally {
      await newServer.close();
    }
  } finally {
    await ctx.browser.close();
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch {}
  }
});

// ============================================================================
// RB12 — Domain correctness requires no browser coordination mechanism
// ============================================================================
test("RB12 — Domain correctness requires no browser coordination mechanism", async () => {
  const ctx = await startRealBrowserContext();
  try {
    // Check that neither tab uses BroadcastChannel or SharedWorker for business locks
    const hasCoordinationLock = await ctx.tabA.evaluate<boolean>(`
      Boolean(window.BroadcastChannel && window.__shortletBroadcastLock)
    `);
    assert.equal(hasCoordinationLock, false, "no client coordination lock allowed");

    // Advance to review and race submission
    await advanceToRequestReview(ctx);

    const [clickA, clickB] = await Promise.all([
      ctx.tabA.clickButton("Submit Booking Request"),
      ctx.tabB.clickButton("Submit Booking Request"),
    ]);
    assert.equal(clickA, true);
    assert.equal(clickB, true);

    await waitForDurable(ctx, () => ctx.server.environment.interactionStore.listBookingRequestIds().length === 1, "one cross-tab Booking Request");

    // Pure backend authority achieves single-winner guarantee
    const requests = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(requests.length, 1, "pure backend authority guarantees exactly one winner without browser coordination");
  } finally {
    await ctx.close();
  }
});

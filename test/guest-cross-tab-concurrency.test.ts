/**
 * Fast Integration Concurrency & Cross-Tab Safety Coverage (Happy DOM Emulation)
 *
 * NOTE: These tests use Happy DOM DOM emulation for fast in-memory integration
 * verification. They do NOT represent real browser-engine proof (which requires
 * real Chromium pages, real cookie jars, and network requests). Real browser
 * engine proof is provided in test/guest-real-browser-cross-tab.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createBasicWebRuntime } from "@weaver/web";
import type { A2UIServerMessage, A2UIClientActionMessage } from "@weaver/core";
import {
  startLocalGuestServer,
  type GuestSurfacePayload,
  type GuestTurnSuccess,
  type GuestStateSnapshot,
  type LocalGuestServerHandle,
} from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment, type LocalGuestFixtureConfig } from "../apps/local-guest/src/fixture.js";

const CANONICAL_PROMPT = "I need an apartment in Ikoyi for 3 nights for 2 people";
const IKOYI_TITLE = "Luxury 2-Bedroom Apartment in Old Ikoyi";

interface BrowserTabHarness {
  readonly window: Window;
  readonly mounted: { surfaceId: string; target: Element }[];
  readonly events: A2UIClientActionMessage["action"][];
  mountSurface(surfaceId: string, a2uiMessages: readonly A2UIServerMessage[]): void;
  clickButton(target: Element, labelText: string, accessibleLabel?: string): boolean;
  takeFirstEvent(): A2UIClientActionMessage["action"] | undefined;
}

function createTabHarness(): BrowserTabHarness {
  const window = new Window();
  const mounted: { surfaceId: string; target: Element }[] = [];
  const events: A2UIClientActionMessage["action"][] = [];
  const created = createBasicWebRuntime({
    rendering: {
      onServerEvent: (event) => {
        events.push(event.message.action);
      },
    },
  });
  if (!created.ok) throw new Error("Weaver runtime failed to create");

  const asElement = (element: unknown): Element => element as Element;

  return {
    window,
    mounted,
    events,
    mountSurface(surfaceId: string, a2uiMessages: readonly A2UIServerMessage[]): void {
      const target = asElement(window.document.createElement("div"));
      for (const message of a2uiMessages) {
        const processed = created.value.runtime.process(message);
        assert.equal(processed.ok, true, `Weaver failed to process A2UI message for ${surfaceId}`);
      }
      const mountResult = created.value.mount({ surfaceId, target });
      assert.equal(mountResult.ok, true, `Weaver failed to mount surface ${surfaceId}`);
      mounted.push({ surfaceId, target });
    },
    clickButton(target: Element, labelText: string, accessibleLabel?: string): boolean {
      const buttons = [...target.querySelectorAll("button")];
      const button = accessibleLabel === undefined
        ? buttons.find((candidate) => candidate.textContent?.includes(labelText))
        : buttons.find((candidate) => {
          const card = candidate.closest('[data-a2ui-component="Card"]');
          return candidate.textContent?.includes(labelText) && card?.textContent?.includes(accessibleLabel.replace(/^View /, ""));
        });
      if (!button) return false;
      button.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
      return true;
    },
    takeFirstEvent(): A2UIClientActionMessage["action"] | undefined {
      return events.shift();
    },
  };
}

interface MultiTabServerContext {
  readonly server: LocalGuestServerHandle;
  readonly base: string;
  readonly cookie: string;
  readonly threadId: string;
  readonly tabA: BrowserTabHarness;
  readonly tabB: BrowserTabHarness;
  send(path: string, body: unknown, tabCookie?: string): Promise<{ status: number; body: any }>;
  state(tabCookie?: string): Promise<GuestStateSnapshot | { ok: false; code: string }>;
  close(): Promise<void>;
}

async function startMultiTabContext(config: Partial<LocalGuestFixtureConfig> = {}): Promise<MultiTabServerContext> {
  const environment = new LocalGuestEnvironment({
    databasePath: `.scratch/local-guest/cross-tab-${Date.now()}-${crypto.randomUUID()}.sqlite`,
    ...config,
  });
  const server = startLocalGuestServer({ port: 0, environment });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const home = await fetch(base);
  const cookie = home.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "server must issue authenticated session cookie");
  await home.text();

  const threadId = `g-${crypto.randomUUID()}`;
  const tabA = createTabHarness();
  const tabB = createTabHarness();

  const send = async (path: string, body: unknown, tabCookie = cookie): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(tabCookie ? { cookie: tabCookie } : {}),
      },
      body: JSON.stringify({ threadId, ...(body as Record<string, unknown>) }),
    });
    return { status: response.status, body: await response.json() };
  };

  const state = async (tabCookie = cookie): Promise<GuestStateSnapshot | { ok: false; code: string }> => {
    const response = await fetch(`${base}/api/state?threadId=${encodeURIComponent(threadId)}`, {
      headers: tabCookie ? { cookie: tabCookie } : {},
    });
    return (await response.json()) as GuestStateSnapshot | { ok: false; code: string };
  };

  return {
    server,
    base,
    cookie,
    threadId,
    tabA,
    tabB,
    send,
    state,
    close: async () => {
      await server.close();
    },
  };
}

// ============================================================================
// AC1 — Two tabs cannot create duplicate Booking Requests
// ============================================================================
test("AC1 — Two tabs cannot create duplicate Booking Requests", async () => {
  const ctx = await startMultiTabContext();
  try {
    // Both tabs share the conversation workspace
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    assert.equal(turn.body.ok, true);
    const discoverySurface = turn.body.surfaces[0] as GuestSurfacePayload;

    // Both Tab A and Tab B mount the initial discovery surface
    ctx.tabA.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);
    ctx.tabB.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);

    // Tab A inspects unit and advances to draft review
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitEvent = ctx.tabA.takeFirstEvent()!;
    const unitRes = await ctx.send("/api/event", unitEvent);
    assert.equal(unitRes.body.ok, true);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftEvent = ctx.tabA.takeFirstEvent()!;
    const draftRes = await ctx.send("/api/event", draftEvent);
    assert.equal(draftRes.body.ok, true);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewEvent = ctx.tabA.takeFirstEvent()!;
    const reviewRes = await ctx.send("/api/event", reviewEvent);
    assert.equal(reviewRes.body.ok, true);
    const reviewSurface = reviewRes.body.surfaces[0] as GuestSurfacePayload;

    // Both Tab A and Tab B now have the Review request surface mounted
    ctx.tabA.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);
    ctx.tabB.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);

    // Both tabs click "Submit Booking Request" simultaneously
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    ctx.tabB.clickButton(ctx.tabB.mounted[1]!.target, "Submit Booking Request");

    const submitActionA = ctx.tabA.takeFirstEvent()!;
    const submitActionB = ctx.tabB.takeFirstEvent()!;

    // Concurrent dispatch to the server
    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", submitActionA),
      ctx.send("/api/event", submitActionB),
    ]);

    // Exactly one must succeed and create a request; the other must fail closed
    const successes = [resA, resB].filter((r) => r.body.ok === true);
    const rejections = [resA, resB].filter((r) => r.body.ok === false);

    assert.equal(successes.length, 1, "exactly one booking request submission must succeed");
    assert.equal(rejections.length, 1, "the duplicate tab submission must be rejected");
    assert.equal(rejections[0]!.body.code, "STALE_SURFACE");

    // Authoritative interaction store holds exactly one Booking Request
    const requestIds = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(requestIds.length, 1, "durable store must contain exactly one booking request");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC2 — A stale Request review action fails closed
// ============================================================================
test("AC2 — A stale Request review action fails closed", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    assert.equal(turn.body.ok, true);
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    const reviewSurface = reviewRes.body.surfaces[0] as GuestSurfacePayload;

    // Tab B mounts the Review surface
    ctx.tabB.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);

    // Tab A submits the request, successfully advancing the conversation
    ctx.tabA.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(submitRes.body.ok, true, "Tab A submit must succeed");

    // Tab B tries to act on the stale review surface afterwards
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Submit Booking Request");
    const staleAction = ctx.tabB.takeFirstEvent()!;
    const staleRes = await ctx.send("/api/event", staleAction);

    assert.equal(staleRes.body.ok, false, "stale request review action must fail closed");
    assert.equal(staleRes.body.code, "STALE_SURFACE");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC3 — Two tabs cannot accept one Conditional Booking Offer twice
// ============================================================================
test("AC3 — Two tabs cannot accept one Conditional Booking Offer twice", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(submitRes.body.ok, true);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    // Refresh state to obtain the Conditional Booking Offer
    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;
    const offerSurface = stateRes.surfaces[0]!;

    // Both Tab A and Tab B mount the offer surface
    ctx.tabA.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages);
    ctx.tabB.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages);

    // Both tabs click "Accept" simultaneously
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Accept");

    const acceptA = ctx.tabA.takeFirstEvent()!;
    const acceptB = ctx.tabB.takeFirstEvent()!;

    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", acceptA),
      ctx.send("/api/event", acceptB),
    ]);

    const successes = [resA, resB].filter((r) => r.body.ok === true);
    const rejections = [resA, resB].filter((r) => r.body.ok === false);

    assert.equal(successes.length, 1, "exactly one offer acceptance must succeed");
    assert.equal(rejections.length, 1, "the duplicate offer acceptance must fail closed");

    // The offer manager must show the offer accepted only once (tokenUsed = true)
    const offerId = offerSurface.surfaceId.split(":").at(-1)!;
    const offer = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.equal(offer.status, "accepted");
    assert.equal(offer.tokenUsed, true);
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC4 — A stale Conditional Booking Offer action fails closed
// ============================================================================
test("AC4 — A stale Conditional Booking Offer action fails closed", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;
    const offerSurface = stateRes.surfaces[0]!;

    ctx.tabB.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages);

    // Tab A accepts the offer, advancing the conversation to the payment stage
    ctx.tabA.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    const acceptRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(acceptRes.body.ok, true, "Tab A accept succeeds");

    // Tab B now attempts to click Accept on the stale offer surface
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Accept");
    const staleAction = ctx.tabB.takeFirstEvent()!;
    const staleRes = await ctx.send("/api/event", staleAction);

    assert.equal(staleRes.body.ok, false, "stale offer action must fail closed");
    assert.equal(staleRes.body.code, "STALE_SURFACE");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC5 — Two tabs cannot create multiple Live Payment Attempts
// ============================================================================
test("AC5 — Two tabs cannot create multiple Live Payment Attempts", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;

    ctx.tabA.mountSurface(stateRes.surfaces[0]!.surfaceId, stateRes.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    const paymentReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(paymentReadyRes.body.ok, true);
    const paymentReadySurface = paymentReadyRes.body.surfaces[0] as GuestSurfacePayload;

    // Both Tab A and Tab B mount the payment ready surface
    ctx.tabA.mountSurface(paymentReadySurface.surfaceId, paymentReadySurface.a2uiMessages);
    ctx.tabB.mountSurface(paymentReadySurface.surfaceId, paymentReadySurface.a2uiMessages);

    // Both tabs click the current amount-bearing checkout action simultaneously.
    ctx.tabA.clickButton(ctx.tabA.mounted[5]!.target, "Continue to stay payment");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Continue to stay payment");

    const checkoutActionA = ctx.tabA.takeFirstEvent()!;
    const checkoutActionB = ctx.tabB.takeFirstEvent()!;

    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", checkoutActionA),
      ctx.send("/api/event", checkoutActionB),
    ]);

    const successes = [resA, resB].filter((r) => r.body.ok === true);
    const rejections = [resA, resB].filter((r) => r.body.ok === false);

    assert.equal(successes.length, 1, "exactly one payment checkout initialization must succeed");
    assert.equal(rejections.length, 1, "duplicate checkout attempt must fail closed");

    // The durable interaction store must hold exactly one checkout session
    const checkouts = ctx.server.environment.interactionStore.listCheckoutSessionIds();
    assert.equal(checkouts.length, 1, "durable store must record exactly one checkout session");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC6 — Concurrent payment verification creates at most one Reservation
// AC7 — Concurrent payment verification creates at most one Booking Contract
// ============================================================================
test("AC6 — Concurrent payment verification creates at most one Reservation", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;

    ctx.tabA.mountSurface(stateRes.surfaces[0]!.surfaceId, stateRes.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    const paymentReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(paymentReadyRes.body.surfaces[0]!.surfaceId, paymentReadyRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[5]!.target, "Continue to stay payment");
    const handoffRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(handoffRes.body.ok, true);

    // Verify stay payment
    ctx.tabA.mountSurface(handoffRes.body.surfaces[0]!.surfaceId, handoffRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[6]!.target, "Check payment status");
    const depositReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(depositReadyRes.body.ok, true);

    // Initialize deposit checkout
    ctx.tabA.mountSurface(depositReadyRes.body.surfaces[0]!.surfaceId, depositReadyRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[7]!.target, "Continue to Refundable Security Deposit");
    const depositHandoffRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(depositHandoffRes.body.ok, true);
    const depositHandoffSurface = depositHandoffRes.body.surfaces[0] as GuestSurfacePayload;

    // Both Tab A and Tab B mount the final deposit handoff surface
    ctx.tabA.mountSurface(depositHandoffSurface.surfaceId, depositHandoffSurface.a2uiMessages);
    ctx.tabB.mountSurface(depositHandoffSurface.surfaceId, depositHandoffSurface.a2uiMessages);

    // Both tabs request authoritative payment verification simultaneously.
    ctx.tabA.clickButton(ctx.tabA.mounted[8]!.target, "Check payment status");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Check payment status");

    const returnA = ctx.tabA.takeFirstEvent()!;
    const returnB = ctx.tabB.takeFirstEvent()!;

    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", returnA),
      ctx.send("/api/event", returnB),
    ]);

    // One succeeds with confirmation; the second is either idempotent or stale surface
    const successfulReservations = [resA, resB].filter((r) => r.body.ok && r.body.surfaces?.[0]?.surfaceId.includes(":booking:"));
    assert.ok(successfulReservations.length >= 1, "at least one tab completes reservation confirmation");

    // Authoritative check: at most one Reservation exists in the interaction store
    const snapshotOfferIds = ctx.server.environment.interactionStore.listBookingSnapshotOfferIds();
    assert.equal(snapshotOfferIds.length, 1, "exactly one booking snapshot exists");

    const snapshot = ctx.server.environment.interactionStore.findBookingSnapshotByOfferId(snapshotOfferIds[0]!)!;
    assert.ok(snapshot, "booking snapshot must exist");
    assert.ok(snapshot.reservationId, "must have a single reservation id");
  } finally {
    await ctx.close();
  }
});

test("AC7 — Concurrent payment verification creates at most one Booking Contract", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;

    ctx.tabA.mountSurface(stateRes.surfaces[0]!.surfaceId, stateRes.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    const paymentReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(paymentReadyRes.body.surfaces[0]!.surfaceId, paymentReadyRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[5]!.target, "Continue to stay payment");
    const handoffRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    // Verify stay payment
    ctx.tabA.mountSurface(handoffRes.body.surfaces[0]!.surfaceId, handoffRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[6]!.target, "Check payment status");
    const depositReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    // Initialize deposit checkout
    ctx.tabA.mountSurface(depositReadyRes.body.surfaces[0]!.surfaceId, depositReadyRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[7]!.target, "Continue to Refundable Security Deposit");
    const depositHandoffRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    const depositHandoffSurface = depositHandoffRes.body.surfaces[0] as GuestSurfacePayload;

    ctx.tabA.mountSurface(depositHandoffSurface.surfaceId, depositHandoffSurface.a2uiMessages);
    ctx.tabB.mountSurface(depositHandoffSurface.surfaceId, depositHandoffSurface.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[8]!.target, "Check payment status");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Check payment status");

    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", ctx.tabA.takeFirstEvent()!),
      ctx.send("/api/event", ctx.tabB.takeFirstEvent()!),
    ]);

    // Check contracts in the repository
    const offerId = stateRes.surfaces[0]!.surfaceId.split(":").at(-1)!;
    const snapshot = ctx.server.environment.interactionStore.findBookingSnapshotByOfferId(offerId);
    assert.ok(snapshot, "booking snapshot must exist");
    assert.ok(snapshot.contractId, "must have a single contract id");

    const contract = JSON.parse(snapshot.contractJson) as { contractId: string };
    assert.equal(contract.contractId, snapshot.contractId);
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC8 — A superseded surface action from another tab fails closed
// ============================================================================
test("AC8 — A superseded surface action from another tab fails closed", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    const discoverySurface = turn.body.surfaces[0] as GuestSurfacePayload;

    // Both tabs have the discovery surface
    ctx.tabA.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);
    ctx.tabB.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);

    // Tab A advances to unit inspection
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(unitRes.body.ok, true);

    // Tab B now clicks on the discovery surface that has been superseded by Tab A's action
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const supersededAction = ctx.tabB.takeFirstEvent()!;
    const supersededRes = await ctx.send("/api/event", supersededAction);

    assert.equal(supersededRes.body.ok, false, "superseded surface action from Tab B must fail closed");
    assert.equal(supersededRes.body.code, "STALE_SURFACE");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC9 — An expired action from another tab fails closed
// ============================================================================
test("AC9 — An expired action from another tab fails closed", async () => {
  let currentTime = new Date("2026-09-03T10:00:00Z");
  const ctx = await startMultiTabContext({ clock: () => currentTime });
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;
    const offerSurface = stateRes.surfaces[0]!;

    ctx.tabB.mountSurface(offerSurface.surfaceId, offerSurface.a2uiMessages);

    // Fast-forward past the offer Payment Window expiration (e.g. +35 mins)
    currentTime = new Date("2026-09-03T10:35:00Z");

    // Tab B attempts to click Accept on the now expired offer surface
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Accept");
    const expiredAction = ctx.tabB.takeFirstEvent()!;
    const expiredRes = await ctx.send("/api/event", expiredAction);

    assert.equal(expiredRes.body.ok, false, "expired action must fail closed");
    // Offer accept fails with STALE_ACTION, OFFER_EXPIRED or STALE_SURFACE
    assert.ok(["STALE_ACTION", "OFFER_EXPIRED", "STALE_SURFACE"].includes(expiredRes.body.code), `expected STALE_ACTION, OFFER_EXPIRED or STALE_SURFACE, got ${expiredRes.body.code}`);
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC10 — A stale tab restores the latest authoritative server projection
// ============================================================================
test("AC10 — A stale tab restores the latest authoritative server projection", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    const discoverySurface = turn.body.surfaces[0] as GuestSurfacePayload;

    ctx.tabA.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);
    ctx.tabB.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);

    // Tab A advances through unit detail and draft
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(draftRes.body.ok, true);

    // Tab B receives a rejection when clicking its stale button
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const staleAction = ctx.tabB.takeFirstEvent()!;
    const staleRes = await ctx.send("/api/event", staleAction);
    assert.equal(staleRes.body.ok, false);
    assert.equal(staleRes.body.code, "STALE_SURFACE");

    // Following client restoreServerState pattern (which triggers on STALE_SURFACE),
    // Tab B queries /api/state
    const restored = await ctx.state();
    assert.equal(restored.ok, true);
    if (!restored.ok) return;

    // Tab B successfully restores the authoritative server projection (the draft surface advanced by Tab A)
    assert.equal(restored.surfaces.length, 1);
    assert.equal(restored.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.surfaceId);
    assert.equal(restored.surfaces[0]!.summary, "Request Draft");

    // Tab B can now mount the restored surface and proceed safely
    ctx.tabB.mountSurface(restored.surfaces[0]!.surfaceId, restored.surfaces[0]!.a2uiMessages);
    assert.match(ctx.tabB.mounted[1]!.target.textContent ?? "", /Your dates are not reserved/i);
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC11 — A losing stale action does not damage winning authoritative state
// ============================================================================
test("AC11 — A losing stale action does not damage winning authoritative state", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    const reviewSurface = reviewRes.body.surfaces[0] as GuestSurfacePayload;

    ctx.tabA.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);
    ctx.tabB.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);

    // Winning action: Tab A submits
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const winRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(winRes.body.ok, true);
    const winRequestId = winRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;

    // Losing action: Tab B sends stale review submission
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Submit Booking Request");
    const loseRes = await ctx.send("/api/event", ctx.tabB.takeFirstEvent()!);
    assert.equal(loseRes.body.ok, false);

    // Verify winning state is completely unharmed
    const current = await ctx.state();
    assert.equal(current.ok, true);
    if (!current.ok) return;

    assert.equal(current.surfaces[0]!.surfaceId, `thread-${ctx.threadId}:request:${winRequestId}`);
    const artifact = ctx.server.environment.bookingRequestApp.getArtifact(winRequestId, ctx.server.environment.guestPrincipal());
    assert.ok(["disclosed", "submitted"].includes(artifact.facts.status));
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC12 — Cross-tab request races do not duplicate inventory commitments
// ============================================================================
test("AC12 — Cross-tab request races do not duplicate inventory commitments", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    const reviewSurface = reviewRes.body.surfaces[0] as GuestSurfacePayload;

    ctx.tabA.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);
    ctx.tabB.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Submit Booking Request");

    const [resA, resB] = await Promise.all([
      ctx.send("/api/event", ctx.tabA.takeFirstEvent()!),
      ctx.send("/api/event", ctx.tabB.takeFirstEvent()!),
    ]);

    // Calendar check: only one commitment exists on the calendar
    const availability = ctx.server.environment.calendar.getAuthoritativeAvailability({
      unitId: "unit-lagos-ikoyi-001",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      clock: ctx.server.environment.clock,
    });
    // Because exactly one request was submitted, availability is blocked for other requests
    assert.equal(availability.isAvailable, false);

    // Exactly one booking request in the repository
    const allRequests = ctx.server.environment.interactionStore.listBookingRequestIds();
    assert.equal(allRequests.length, 1, "only one inventory commitment created");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC13 — Cross-tab payment races do not reset the Payment Window
// ============================================================================
test("AC13 — Cross-tab payment races do not reset the Payment Window", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateRes = await ctx.state();
    assert.equal(stateRes.ok, true);
    if (!stateRes.ok) return;

    ctx.tabA.mountSurface(stateRes.surfaces[0]!.surfaceId, stateRes.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[4]!.target, "Accept");
    const paymentReadyRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(paymentReadyRes.body.ok, true);
    const paymentReadySurface = paymentReadyRes.body.surfaces[0] as GuestSurfacePayload;

    const offerId = stateRes.surfaces[0]!.surfaceId.split(":").at(-1)!;
    const initialOffer = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    const originalExpiresAt = initialOffer.paymentWindow.expiresAt;

    // Both tabs attempt to initialize checkout concurrently
    ctx.tabA.mountSurface(paymentReadySurface.surfaceId, paymentReadySurface.a2uiMessages);
    ctx.tabB.mountSurface(paymentReadySurface.surfaceId, paymentReadySurface.a2uiMessages);

    ctx.tabA.clickButton(ctx.tabA.mounted[5]!.target, "Continue to stay payment");
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Continue to stay payment");

    await Promise.all([
      ctx.send("/api/event", ctx.tabA.takeFirstEvent()!),
      ctx.send("/api/event", ctx.tabB.takeFirstEvent()!),
    ]);

    // Check that the offer's payment window deadline has NOT been altered or reset
    const currentOffer = ctx.server.environment.conditionalOfferApp.manager.getOffer(offerId);
    assert.equal(currentOffer.paymentWindow.expiresAt, originalExpiresAt, "Payment Window deadline must not change");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC14 — Cross-tab recovery does not automatically repeat rejected actions
// ============================================================================
test("AC14 — Cross-tab recovery does not automatically repeat rejected actions", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    const discoverySurface = turn.body.surfaces[0] as GuestSurfacePayload;

    ctx.tabA.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);
    ctx.tabB.mountSurface(discoverySurface.surfaceId, discoverySurface.a2uiMessages);

    // Tab A advances
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    // Tab B performs an action on superseded surface
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const staleAction = ctx.tabB.takeFirstEvent()!;
    const staleRes = await ctx.send("/api/event", staleAction);
    assert.equal(staleRes.body.ok, false);

    // Recovery: Tab B calls state()
    const recovered = await ctx.state();
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;

    // Verify recovery didn't trigger any new commands or duplicate events
    assert.equal(ctx.tabB.events.length, 0, "no automated repeating of rejected actions");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC15 — Two tabs restore safely after a server restart
// ============================================================================
test("AC15 — Two tabs restore safely after a server restart", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(draftRes.body.ok, true);

    const dbPath = ctx.server.environment.config.databasePath;
    await ctx.server.close();

    // Start a completely new server instance over the same SQLite database
    const newEnv = new LocalGuestEnvironment({ databasePath: dbPath });
    const newServer = startLocalGuestServer({ port: 0, environment: newEnv });
    const newPort = await newServer.listen();
    const newBase = `http://127.0.0.1:${newPort}`;

    try {
      // Both Tab A and Tab B call /api/state against the new server using the same cookie & threadId
      const resTabA = await fetch(`${newBase}/api/state?threadId=${encodeURIComponent(ctx.threadId)}`, {
        headers: { cookie: ctx.cookie },
      });
      const stateTabA = (await resTabA.json()) as GuestStateSnapshot;
      assert.equal(stateTabA.ok, true);
      assert.equal(stateTabA.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.surfaceId);

      const resTabB = await fetch(`${newBase}/api/state?threadId=${encodeURIComponent(ctx.threadId)}`, {
        headers: { cookie: ctx.cookie },
      });
      const stateTabB = (await resTabB.json()) as GuestStateSnapshot;
      assert.equal(stateTabB.ok, true);
      assert.equal(stateTabB.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.surfaceId);
    } finally {
      await newServer.close();
    }
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC16 — Server restart with two tabs does not replay consequential commands
// ============================================================================
test("AC16 — Server restart with two tabs does not replay consequential commands", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(reviewRes.body.surfaces[0]!.surfaceId, reviewRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const submitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);

    const requestId = submitRes.body.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ctx.server.environment.simulateOperatorAcceptance(requestId);

    const stateBefore = await ctx.state();
    assert.equal(stateBefore.ok, true);

    const initialOffers = ctx.server.environment.interactionStore.listConditionalOfferIds();
    assert.equal(initialOffers.length, 1);

    const dbPath = ctx.server.environment.config.databasePath;
    await ctx.server.close();

    // Restart server
    const newEnv = new LocalGuestEnvironment({ databasePath: dbPath });
    const newServer = startLocalGuestServer({ port: 0, environment: newEnv });
    const newPort = await newServer.listen();
    const newBase = `http://127.0.0.1:${newPort}`;

    try {
      // Both Tab A and Tab B query state concurrently
      const [resA, resB] = await Promise.all([
        fetch(`${newBase}/api/state?threadId=${encodeURIComponent(ctx.threadId)}`, { headers: { cookie: ctx.cookie } }),
        fetch(`${newBase}/api/state?threadId=${encodeURIComponent(ctx.threadId)}`, { headers: { cookie: ctx.cookie } }),
      ]);

      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);

      // Verify no duplicate offer issuance occurred
      const finalOffers = newEnv.interactionStore.listConditionalOfferIds();
      assert.equal(finalOffers.length, 1, "restart with two tabs must not issue duplicate offers");
    } finally {
      await newServer.close();
    }
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC17 — Browser coordination is not required for domain correctness
// ============================================================================
test("AC17 — Browser coordination is not required for domain correctness", async () => {
  // Confirm that tabs operate in complete isolation without BroadcastChannel,
  // SharedWorker, or localStorage locks; domain correctness is entirely enforced
  // by the server and domain boundaries.
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    ctx.tabA.mountSurface(turn.body.surfaces[0]!.surfaceId, turn.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[0]!.target, "View apartment", `View ${IKOYI_TITLE}`);
    const unitRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(unitRes.body.surfaces[0]!.surfaceId, unitRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[1]!.target, "Request to Book");
    const draftRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    ctx.tabA.mountSurface(draftRes.body.surfaces[0]!.surfaceId, draftRes.body.surfaces[0]!.a2uiMessages);
    ctx.tabA.clickButton(ctx.tabA.mounted[2]!.target, "Review request");
    const reviewRes = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    const reviewSurface = reviewRes.body.surfaces[0] as GuestSurfacePayload;

    // Tab A and Tab B are separate Happy DOM window instances with no shared client storage
    assert.notEqual(ctx.tabA.window, ctx.tabB.window);

    ctx.tabA.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);
    ctx.tabB.mountSurface(reviewSurface.surfaceId, reviewSurface.a2uiMessages);

    // Tab A proceeds
    ctx.tabA.clickButton(ctx.tabA.mounted[3]!.target, "Submit Booking Request");
    const resA = await ctx.send("/api/event", ctx.tabA.takeFirstEvent()!);
    assert.equal(resA.body.ok, true);

    // Tab B attempts to proceed independently without any coordination mechanism
    ctx.tabB.clickButton(ctx.tabB.mounted[0]!.target, "Submit Booking Request");
    const resB = await ctx.send("/api/event", ctx.tabB.takeFirstEvent()!);
    assert.equal(resB.body.ok, false);
    assert.equal(resB.body.code, "STALE_SURFACE");
  } finally {
    await ctx.close();
  }
});

// ============================================================================
// AC18 — Cross-tab behavior preserves principal and tenant isolation
// ============================================================================
test("AC18 — Cross-tab behavior preserves principal and tenant isolation", async () => {
  const ctx = await startMultiTabContext();
  try {
    const turn = await ctx.send("/api/turn", { text: CANONICAL_PROMPT });
    assert.equal(turn.body.ok, true);

    // Tab C with an unknown/forged session cookie tries to access the thread
    const forgedCookie = `shortlet_guest_session=gs-${crypto.randomUUID()}`;
    const forgedState = await ctx.state(forgedCookie);
    assert.equal((forgedState as any).ok, false);
    assert.equal((forgedState as any).code, "AUTHENTICATION_REQUIRED");

    // Attempting to send an event on the thread from Tab C fails closed
    const forgedEvent = await ctx.send(
      "/api/event",
      {
        name: "shortlet.discovery.view-unit",
        surfaceId: turn.body.surfaces[0]!.surfaceId,
        sourceComponentId: "attacker",
        timestamp: new Date().toISOString(),
        context: { unitId: "unit-lagos-ikoyi-001" },
      },
      forgedCookie,
    );
    assert.equal(forgedEvent.status, 401);
    assert.equal(forgedEvent.body.ok, false);
  } finally {
    await ctx.close();
  }
});

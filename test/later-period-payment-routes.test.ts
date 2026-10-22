import assert from "node:assert/strict";
import test from "node:test";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION, type GuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import type { DemoJourneyContext } from "./helpers/demo-extended-journey.js";
import { addDays, extendUnit, withDemoExtendedJourney } from "./helpers/demo-extended-journey.js";
import { createFakeHttpRequest, createFakeHttpResponse, type CapturedResponse } from "./helpers/http-like.js";
import type { Unit } from "../domains/shortlet/src/browse.js";

// Demo-launch issue 12 AC4 (ADR 0092): the guest's later Billing Period schedule and its separate Paystack TEST sessions,
// through the real guest HTTP handler. Provider responses are stubbed; synthetic data only.
// Deviation: these routes were written before these tests (see the issue Comments). The mutation check in the
// Comments shows each refusal assertion fails when its guard is removed.

const CHECK_IN = "2026-09-10";
const CHECK_OUT = addDays(CHECK_IN, 180);
/** Period 1 has started, so period 2 is payable and period 3 is not yet (ADR 0092). */
const PERIOD_1_STARTED = `${CHECK_IN}T10:00:00.000Z`;
const ORIGIN = "http://localhost";

interface RouteContext extends DemoJourneyContext {
  readonly handler: GuestRequestHandler;
  readonly cookie: string;
  /** Every provider reference the TEST start call received, in order. */
  readonly starts: string[];
}

function unitWithTerms(): (seeded: Unit) => Unit {
  return (seeded) => extendUnit(seeded, { claimsThrough: CHECK_OUT });
}

function systemPrincipal(context: DemoJourneyContext) {
  return { id: "synthetic-system", role: "system" as const, tenantId: context.guest.config.tenantId };
}

function cookieOf(response: CapturedResponse): string {
  const header = response.headers.find((entry) => entry.name.toLowerCase() === "set-cookie");
  assert.ok(header, "a session cookie is issued");
  return header.value.split(";")[0]!;
}

async function send(handler: GuestRequestHandler, method: string, path: string, cookie?: string): Promise<CapturedResponse> {
  const headers: Record<string, string> = { host: "localhost", origin: ORIGIN };
  if (cookie !== undefined) headers.cookie = cookie;
  const req = createFakeHttpRequest({ method, url: path, headers });
  const { response, finished } = createFakeHttpResponse();
  await handler.handle(req, response);
  return finished;
}

function location(response: CapturedResponse): string {
  return response.headers.find((entry) => entry.name.toLowerCase() === "location")?.value ?? "";
}

/**
 * The demo journey with period 1 confirmed, the clock inside period 1, and the guest handler. The TEST provider's start
 * calls are recorded so a test can answer the callback for the exact reference the Guest's session received.
 */
async function withConfirmedRoutes(options: { readonly wrongAmount?: { active: boolean } }, run: (context: RouteContext) => Promise<void> | void): Promise<void> {
  await withDemoExtendedJourney({
    unit: unitWithTerms(),
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    outcomeFactory: (reference, amount, payerId) => {
      const wrong = options.wrongAmount?.active === true;
      return {
        reference,
        method: "card",
        verified: true,
        status: "success",
        amountKobo: wrong ? amount + 1 : amount,
        currency: "NGN",
        providerReference: reference,
        payerId,
        environment: "test",
      } as never;
    },
  }, async (context) => {
    const first = context.guest.cardPaymentApp.getCheckoutSession(context.offerId)!;
    const confirmed = await context.guest.cardPaymentApp.verifyAndConfirmPaystack(first.pspReference, systemPrincipal(context));
    assert.equal(confirmed.outcome, "confirmed");
    context.setClock(PERIOD_1_STARTED);
    const starts: string[] = [];
    const payments = context.guest.payments!;
    const start = payments.start.bind(payments);
    payments.start = async (input: { reference: string }) => {
      starts.push(input.reference);
      return start(input as never);
    };
    const handler = createGuestRequestHandler({
      environment: context.guest,
      commerce: GUEST_COMMERCE_COMPOSITION.disabled,
      assets: { text: () => "/* stub */" },
      landingBinaryAssets: { read: () => new Uint8Array([1]) },
    });
    const home = await send(handler, "GET", "/");
    const routeContext: RouteContext = { ...context, handler, cookie: cookieOf(home), starts };
    await run(routeContext);
  });
}

test("AC4: the schedule lists every Billing Period, offers Pay only for the payable period, and never shows a future period as paid", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const response = await send(context.handler, "GET", `/bookings/periods/${encodeURIComponent(context.offerId)}`, context.cookie);
    assert.equal(response.statusCode, 200);
    const html = response.body.toString("utf8");
    for (let index = 1; index <= 6; index += 1) assert.ok(html.includes(`data-period="${index}"`), `period ${index} is listed`);
    assert.ok(html.includes(`data-period="1" data-status="paid"`), "period 1 is paid");
    assert.ok(html.includes(`data-period="2" data-status="payable"`), "period 2 is payable");
    for (let index = 3; index <= 6; index += 1) assert.equal(html.includes(`data-period="${index}" data-status="paid"`), false, `period ${index} is never shown as paid`);
    assert.ok(html.includes(`action="/payments/periods/${encodeURIComponent(context.offerId)}/2"`), "the payable period has its own Pay form");
    for (let index = 1; index <= 6; index += 1) {
      if (index === 2) continue;
      assert.equal(html.includes(`action="/payments/periods/${encodeURIComponent(context.offerId)}/${index}"`), false, `period ${index} has no Pay form`);
    }
  });
});

test("AC4: a future period cannot start a payment session", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const response = await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/3`, context.cookie);
    assert.equal(response.statusCode, 400, "the future period is refused");
    assert.equal(context.starts.length, 0, "no provider session was started");
  });
});

test("AC4: the already-paid first period cannot start a second session", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const response = await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/1`, context.cookie);
    assert.equal(response.statusCode, 400);
    assert.equal(context.starts.length, 0);
  });
});

test("AC4: an unknown period index is refused", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const response = await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/9`, context.cookie);
    assert.equal(response.statusCode, 400);
    assert.equal(context.starts.length, 0);
  });
});

test("AC4: the payable period starts its own Paystack TEST session and redirects to the approved checkout", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const response = await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`, context.cookie);
    assert.equal(response.statusCode, 303);
    assert.ok(location(response).startsWith("https://checkout.paystack.com/"), "the approved TEST checkout");
    assert.equal(context.starts.length, 1, "exactly one provider session for period 2");
  });
});

test("AC4: the callback for a later period's reference confirms that period and returns to its schedule", async () => {
  await withConfirmedRoutes({}, async (context) => {
    await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`, context.cookie);
    const reference = context.starts.at(-1)!;
    const callback = await send(context.handler, "GET", `/payments/paystack/callback?reference=${encodeURIComponent(reference)}`, context.cookie);
    assert.equal(callback.statusCode, 303);
    assert.equal(location(callback), `/bookings/periods/${encodeURIComponent(context.offerId)}`);
    const html = (await send(context.handler, "GET", `/bookings/periods/${encodeURIComponent(context.offerId)}`, context.cookie)).body.toString("utf8");
    assert.ok(html.includes(`data-period="2" data-status="paid"`), "period 2 is now paid");
    assert.equal(html.includes(`data-period="3" data-status="paid"`), false, "period 3 stays unpaid");
  });
});

test("AC4: a duplicate callback for the same later-period reference is idempotent", async () => {
  await withConfirmedRoutes({}, async (context) => {
    await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`, context.cookie);
    const reference = context.starts.at(-1)!;
    const path = `/payments/paystack/callback?reference=${encodeURIComponent(reference)}`;
    assert.equal((await send(context.handler, "GET", path, context.cookie)).statusCode, 303);
    assert.equal((await send(context.handler, "GET", path, context.cookie)).statusCode, 303);
    assert.equal(context.guest.cardPaymentApp.getPeriodPayments(context.offerId).length, 1, "period 2 is recorded once");
  });
});

test("AC4: a later period's callback with a wrong amount is refused and leaves that period unpaid", async () => {
  const wrong = { active: false };
  await withConfirmedRoutes({ wrongAmount: wrong }, async (context) => {
    await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`, context.cookie);
    const reference = context.starts.at(-1)!;
    wrong.active = true;
    const callback = await send(context.handler, "GET", `/payments/paystack/callback?reference=${encodeURIComponent(reference)}`, context.cookie);
    assert.equal(callback.statusCode, 400, "the callback is refused");
    assert.equal(context.guest.cardPaymentApp.getPeriodPayments(context.offerId).length, 0, "no period payment is recorded");
  });
});

test("AC4: an unknown reference is refused and never confirms a period", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const callback = await send(context.handler, "GET", `/payments/paystack/callback?reference=${encodeURIComponent("not-a-reference")}`, context.cookie);
    assert.equal(callback.statusCode, 400);
    assert.equal(context.guest.cardPaymentApp.getPeriodPayments(context.offerId).length, 0);
  });
});

test("AC4: a request with no Guest session can neither see the schedule nor start a period", async () => {
  await withConfirmedRoutes({}, async (context) => {
    const page = await send(context.handler, "GET", `/bookings/periods/${encodeURIComponent(context.offerId)}`);
    assert.equal(page.statusCode, 401);
    const start = await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`);
    assert.equal(start.statusCode, 401);
    assert.equal(context.starts.length, 0);
  });
});

test("AC4: the schedule HTML carries no provider reference, secret key or Guest identity", async () => {
  await withConfirmedRoutes({}, async (context) => {
    await send(context.handler, "POST", `/payments/periods/${encodeURIComponent(context.offerId)}/2`, context.cookie);
    const reference = context.starts.at(-1)!;
    const html = (await send(context.handler, "GET", `/bookings/periods/${encodeURIComponent(context.offerId)}`, context.cookie)).body.toString("utf8");
    assert.equal(html.includes(reference), false, "no provider reference");
    assert.equal(html.includes("sk_test"), false, "no secret key");
    assert.equal(html.includes(context.guest.config.guestId), false, "no Guest identity");
  });
});

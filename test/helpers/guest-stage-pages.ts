import { restartFixture, type RestartStage } from "./guest-restart.js";
import { TEST_MANUAL_ACCOUNT } from "./guest-payment-page.js";

/** One guest page reached at a booking stage: a fixture guest, and the standalone route for that stage. */
export interface StagePageSpec {
  readonly label: string;
  readonly stage: RestartStage;
  /** Starts a bank transfer first, so the page is a transfer screen. */
  readonly start?: "transfer" | "manual-transfer";
  /** Runs before the page is read, for example to move the clock past a deadline. */
  readonly beforeRead?: (fixture: Awaited<ReturnType<typeof restartFixture>>) => void;
}

export const BOOKING_STAGE_PAGES: readonly StagePageSpec[] = [
  { label: "Request review", stage: "review" },
  { label: "Request sent", stage: "pending" },
  { label: "Conditional Booking Offer", stage: "offer" },
  { label: "Offer expired", stage: "offer", beforeRead: (fixture) => fixture.setTime("2026-10-20T10:00:00Z") },
  { label: "Payment choice", stage: "payment-ready" },
  { label: "Provider bank transfer", stage: "payment-ready", start: "transfer" },
  { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" },
  { label: "Reservation confirmed", stage: "confirmed" },
];

const BOOKING_ROUTE = /^\/(booking-requests|conditional-offers|booking-contracts)\//;

export interface StagePageContext {
  readonly fixture: Awaited<ReturnType<typeof restartFixture>>;
  /** The standalone page for this stage, as a path on `fixture.base`. */
  readonly path: string;
  readonly threadId: string;
}

/**
 * Runs `run` with a fresh local Guest advanced to `spec.stage`, then closes it. Local test data only: one
 * fixture per stage keeps each stage independent (only one live payment attempt is allowed, ADR 0046).
 */
export async function withStagePage<T>(spec: StagePageSpec, run: (context: StagePageContext) => Promise<T>): Promise<T> {
  const fixture = await restartFixture({ manualTransferAccount: TEST_MANUAL_ACCOUNT }, { localPayment: true });
  try {
    const routes = new Map<string, string>();
    await fixture.advance(spec.stage, (_stage, result) => {
      for (const surface of result.surfaces) if (surface.conventionalRoute && BOOKING_ROUTE.test(surface.conventionalRoute)) routes.set(surface.conventionalRoute.split("/")[1]!, surface.conventionalRoute);
    });
    const offerId = /^\/conditional-offers\/([^/?]+)/.exec(routes.get("conditional-offers") ?? "")?.[1];
    const payment = offerId ? `/payments/offers/${offerId}` : undefined;
    if (spec.start) {
      if (!payment) throw new Error(`${spec.label}: no offer to pay for`);
      const response = await fetch(`${fixture.base}${payment}/${spec.start}`, { method: "POST", headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
      if (response.status !== 303) throw new Error(`${spec.label}: starting ${spec.start} returned ${response.status}`);
    }
    spec.beforeRead?.(fixture);
    const path = spec.start ? `${payment}/${spec.start}` : spec.stage === "payment-ready" ? payment : [...routes.values()].at(-1);
    if (!path) throw new Error(`${spec.label}: the stage produced no standalone page`);
    return await run({ fixture, path, threadId: fixture.threadId });
  } finally {
    await fixture.close();
  }
}

/** The rail steps in a standalone page's HTML: `[step id, data-state]` in order. */
export function railSteps(html: string): readonly (readonly [string, string])[] {
  return [...html.matchAll(/<li data-step="([a-z]+)" data-state="([a-z]+)"/g)].map((match) => [match[1]!, match[2]!] as const);
}

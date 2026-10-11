import assert from "node:assert/strict";
import { TEST_MANUAL_ACCOUNT } from "./guest-payment-page.js";
import { CapturingEmailSender, accountComposition, TEST_GUEST_PHONE } from "./guest-account-sign-in.js";
import { restartFixture, type RestartStage } from "./guest-restart.js";
import type { GuestSurfacePayload, GuestTurnSuccess } from "../../apps/local-guest/src/guest-server.js";

/** The email the offer tests give the Guest's contact (ADR 0093: the offer is pre-filled from the contact already given). */
export const OFFER_TEST_EMAIL = "ada@example.test";

/** The offer panel in a page's HTML (issue 08): the one `ui-panel` marked `data-sign-in-offer`, or null when none is shown. */
export function offerOf(html: string): string | null {
  return /<section class="ui-panel" data-sign-in-offer[\s\S]*?<\/section>/.exec(html)?.[0] ?? null;
}

/** The fields the offer submits: the pre-filled email and the return path. Both come from the panel's own form. */
export function offerFieldsOf(section: string): { readonly email: string; readonly returnPath: string } {
  const email = /<input[^>]*name="email"[^>]*value="([^"]*)"/.exec(section)?.[1];
  const returnPath = /<input type="hidden" name="return" value="([^"]*)"/.exec(section)?.[1];
  assert.ok(email !== undefined && returnPath !== undefined, "the offer submits its email and a return path");
  return { email, returnPath };
}

/** A chat surface as the server sends it when it carries the sign-in offer (issue 08). */
export type OfferedSurface = GuestSurfacePayload & { readonly signInOffer?: { readonly email: string; readonly returnPath: string } };

/** The chat surface that carries the sign-in offer in a state or turn response, or undefined. */
export function offeredSurfaceOf(surfaces: readonly GuestSurfacePayload[]): OfferedSurface | undefined {
  return (surfaces as readonly OfferedSurface[]).find((surface) => surface.signInOffer !== undefined);
}

export interface OfferStageDevice {
  readonly fixture: Awaited<ReturnType<typeof restartFixture>>;
  readonly sender: CapturingEmailSender;
  /** The device's interaction cookie, `name=value`, before any sign-in. */
  readonly cookie: string;
  /** Every standalone booking page the stage produced, in order (`/booking-requests/...`, `/booking-contracts/...`). */
  readonly routes: readonly string[];
  /** The turn or event response that completed the stage: what the chat workspace renders from. */
  readonly turn: GuestTurnSuccess;
}

/**
 * Runs `run` with one session-scoped device, sign-in enabled, advanced to `stage`. The device's own principal is given a
 * phone and a contact email at discovery, as the Guest's contact steps would give them, so the request can be sent. Local test
 * data only. Pass `accounts: false` for a server with sign-in disabled (its missing key, sender or session scoping).
 */
export async function withOfferStageDevice<T>(
  stage: RestartStage,
  run: (device: OfferStageDevice) => Promise<T>,
  options: { readonly accounts?: boolean } = {},
): Promise<T> {
  const sender = new CapturingEmailSender();
  const composition = accountComposition({ sender });
  const fixture = await restartFixture(
    { manualTransferAccount: TEST_MANUAL_ACCOUNT },
    { localPayment: true, sessionScopedGuestPrincipals: true, guestAccounts: options.accounts === false ? null : composition },
  );
  try {
    const routes: string[] = [];
    const turn = await fixture.advance(stage, (current, result) => {
      if (current === "discovery") recordContactFor(fixture, fixture.threadId);
      for (const surface of result.surfaces) if (surface.conventionalRoute && !routes.includes(surface.conventionalRoute)) routes.push(surface.conventionalRoute);
    });
    return await run({ fixture, sender, cookie: fixture.cookie, routes, turn });
  } finally {
    await fixture.close();
  }
}

/** Gives a conversation's principal the phone and email a booking needs (the same writes the contact steps make). */
export function recordContactFor(fixture: Awaited<ReturnType<typeof restartFixture>>, threadId: string): void {
  const principalId = fixture.environment.interactionStore.findThread(threadId)?.principalId;
  assert.ok(principalId, "the conversation has an owning principal");
  const principal = { id: principalId, role: "guest" as const, tenantId: fixture.environment.config.tenantId };
  fixture.environment.guestContactApp.submitPhone({ phoneNumber: TEST_GUEST_PHONE }, principal);
  fixture.environment.guestContactApp.submitEmail({ contactEmail: OFFER_TEST_EMAIL }, principal);
}

/** The standalone page for a booking route prefix, from the routes a stage produced. */
export function routeFor(routes: readonly string[], prefix: "/booking-requests/" | "/booking-contracts/"): string {
  const route = routes.filter((candidate) => candidate.startsWith(prefix)).at(-1);
  assert.ok(route, `the stage produced a ${prefix} page`);
  return route;
}

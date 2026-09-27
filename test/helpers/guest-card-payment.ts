import { DatabaseSync } from "node:sqlite";
import type { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/index.js";
import { createCardPaymentApplication, type CardPaymentApplication } from "../../apps/web/src/index.js";
import {
  InMemorySecurityDepositAccountingRepository,
  SqliteBookingPaymentJourneyRepository,
  SqliteBookingStateRepository,
  SqliteGuestInteractionStore,
  SqliteLivePaymentAttemptRegistry,
  type PSPVerifyResult,
} from "../../domains/shortlet/src/index.js";
import type { CommandPrincipal } from "../../packages/platform-core/src/index.js";

/** A card last four the provider reports; the back office must never show it (ADR 0075). */
export const TEST_CARD_LAST4 = "4242";
/** The payer email the Guest side holds; the back office must never show it (ADR 0075). */
export const TEST_PAYER_EMAIL = "payer@example.test";

export type ProviderStatus = PSPVerifyResult["status"];

/**
 * The Guest side of a card payment, writing to the operator environment's SQLite file through its own connection,
 * as the pilot's guest server does. The provider is a deterministic stand-in: each verification reports `status`.
 */
export interface GuestCardPayments {
  /** Accepts the Conditional Booking Offer for a confirmed request as its Guest. Returns the offer id. */
  accept(requestId: string): string;
  /** Accepts if needed and opens a card checkout (the Live Payment Attempt). Returns the provider reference. */
  startCard(requestId: string): string;
  /** Verifies the open checkout with the provider reporting `status`. Refusals are swallowed: the state they leave is the point. */
  verify(requestId: string, status?: ProviderStatus): void;
  /** Pays every required component (stay, then any deposit) until the Reservation is confirmed. */
  pay(requestId: string): void;
  close(): void;
}

export function guestCardPayments(env: LocalApartmentOwnerEnvironment, options: { readonly refundStatus?: "pending" | "settled" } = {}): GuestCardPayments {
  const database = new DatabaseSync(env.config.databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  const store = new SqliteGuestInteractionStore(env.config.databasePath, database);
  let providerStatus: ProviderStatus = "success";
  const app: CardPaymentApplication = createCardPaymentApplication({
    conditionalOfferApplication: env.conditionalOfferApp,
    repository: env.unitRepository,
    calendar: env.calendar,
    guestContacts: { find: (guestId: string, tenantId: string) => ({ guestId, tenantId, phoneNumber: "+2348012345678", contactEmail: TEST_PAYER_EMAIL, revision: 1 }) },
    pspClient: {
      verifyTransaction: (pspReference: string) => {
        const session = app.manager.getCheckoutSessionByReference(pspReference);
        const payerId = session ? env.conditionalOfferApp.manager.getOffer(session.offerId).parties.primaryGuest.id : undefined;
        return { verified: providerStatus === "success", status: providerStatus, amountKobo: session?.amountKobo ?? 0, currency: "NGN", pspReference, ...(payerId ? { payerId } : {}), cardMetadata: { brand: "visa", last4: TEST_CARD_LAST4 } };
      },
    },
    journeyRepository: new SqliteBookingPaymentJourneyRepository(database, env.config.databasePath),
    liveAttempts: new SqliteLivePaymentAttemptRegistry(store),
    store,
    securityDepositAccounting: new InMemorySecurityDepositAccountingRepository(),
    securityDepositCapability: { getCapability: ({ paymentMethod }) => ({ capabilityVersion: "test-security-deposit-v1", enabled: true, pspProviderId: "test-psp", pspApproved: true, counselApproved: true, collectionModel: "separate_actual_charge", paymentMethod }) },
    compensationRefundProvider: { refundOrGet: ({ obligationId, amountKobo }) => ({ refundId: `refund-${obligationId}`, status: options.refundStatus ?? "pending", amountKobo, currency: "NGN" }) },
    bookingState: new SqliteBookingStateRepository(database, env.config.databasePath),
    clock: env.clock,
  });

  const offerIdFor = (requestId: string): string => {
    const offer = store.findConditionalOfferByRequestId(requestId);
    if (!offer) throw new Error(`No Conditional Booking Offer for ${requestId}`);
    return offer.offerId;
  };
  const guestFor = (offerId: string): CommandPrincipal => {
    const offer = env.conditionalOfferApp.manager.getOffer(offerId);
    return { id: offer.parties.primaryGuest.id, role: "guest", tenantId: offer.tenantId ?? env.config.tenantId };
  };
  const system: CommandPrincipal = { id: "system-payment-verifier", role: "system", tenantId: env.config.tenantId };

  const accept = (requestId: string): string => {
    const offerId = offerIdFor(requestId);
    const offer = env.conditionalOfferApp.manager.getOffer(offerId);
    if (offer.status !== "accepted") env.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: guestFor(offerId) });
    return offerId;
  };
  const startCard = (requestId: string): string => {
    const offerId = accept(requestId);
    const open = app.manager.getCheckoutSession(offerId);
    return open?.status === "initiated" ? open.pspReference : app.initializeCheckout(offerId, guestFor(offerId)).pspReference;
  };
  const verify = (requestId: string, status: ProviderStatus = "success"): void => {
    const session = app.manager.getCheckoutSession(offerIdFor(requestId));
    if (!session) throw new Error(`No checkout for ${requestId}`);
    providerStatus = status;
    try { app.verifyAndConfirm(session.pspReference, system); } catch { /* the refused state is what the test reads */ }
  };

  return {
    accept,
    startCard,
    verify,
    pay(requestId) {
      for (let component = 0; component < 2; component += 1) {
        startCard(requestId);
        verify(requestId, "success");
        if (store.findBookingSnapshotByOfferId(offerIdFor(requestId))) return;
      }
      throw new Error(`Payment did not confirm a Reservation for ${requestId}`);
    },
    close() { if (database.isOpen) database.close(); },
  };
}

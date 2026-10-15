import { CardPaymentManager, SHORTLET_DOMAIN_ID, type CardCheckoutSession, type CardPaymentManagerOptions, type PSPVerifyResult } from "../../../domains/shortlet/src/index.js";
import { isApprovedPaystackCheckoutUrl, type Payments } from "../../../packages/platform-core/src/payments/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal, type PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { getConditionalOfferManager } from "./conditional-offer-application.js";
import { cardPaymentArtifactFromState, type CardPaymentArtifact } from "./card-payment-artifact.js";

export interface CardPaymentApplicationOptions {
  readonly conditionalOfferApplication: ConditionalOfferApplication;
  readonly repository?: CardPaymentManagerOptions["repository"];
  readonly calendar?: CardPaymentManagerOptions["calendar"];
  readonly audit?: CardPaymentManagerOptions["audit"];
  readonly pspClient?: CardPaymentManagerOptions["pspClient"];
  readonly liveAttempts?: CardPaymentManagerOptions["liveAttempts"];
  readonly clock?: () => Date;
  readonly journeyRepository?: import("../../../domains/shortlet/src/index.js").BookingPaymentJourneyRepository;
  readonly securityDepositCapability?: CardPaymentManagerOptions["securityDepositCapability"];
  readonly securityDepositAccounting?: CardPaymentManagerOptions["securityDepositAccounting"];
  readonly bookingState: NonNullable<CardPaymentManagerOptions["bookingState"]>;
  readonly compensationRefundProvider?: CardPaymentManagerOptions["compensationRefundProvider"];
  readonly store?: import("../../../domains/shortlet/src/index.js").SqliteGuestInteractionStore | null;
  readonly guestContacts: NonNullable<CardPaymentManagerOptions["guestContacts"]>;
  /** The platform Payments module (ADR 0099 rule 2). Absent when hosted card checkout is not configured. */
  readonly payments?: Payments;
  readonly onConfirmedOutcome?: (outcome: { readonly outcome: "confirmed"; readonly reservation: import("../../../domains/shortlet/src/index.js").Reservation; readonly bookingContract: import("../../../domains/shortlet/src/index.js").BookingContract }) => void;
}

const managers = new WeakMap<CardPaymentApplication, CardPaymentManager>();
/** Composition seam: the underlying domain manager, for wiring sibling applications. Not a public application API. */
export function getCardPaymentManager(application: CardPaymentApplication): CardPaymentManager {
  const manager = managers.get(application);
  if (!manager) throw new Error("CardPaymentApplication is not initialized");
  return manager;
}

/** The domain provider state, back from the platform's raw outcome (ADR 0044 grace handling). */
function toProviderResult(outcome: Awaited<ReturnType<Payments["confirm"]>>): PSPVerifyResult {
  return {
    verified: outcome.verified,
    status: outcome.status,
    amountKobo: outcome.amountKobo,
    currency: outcome.currency,
    pspReference: outcome.providerReference,
    ...(outcome.payerId === undefined ? {} : { payerId: outcome.payerId }),
    ...(outcome.environment === undefined ? {} : { environment: outcome.environment }),
    ...(outcome.cardMetadata === undefined ? {} : { cardMetadata: outcome.cardMetadata }),
    ...(outcome.failureReason === undefined ? {} : { failureReason: outcome.failureReason }),
  };
}

export class CardPaymentApplication {
  readonly #manager: CardPaymentManager;
  readonly #conditionalOfferApplication: ConditionalOfferApplication;
  readonly #clock: () => Date;
  readonly #payments?: Payments;
  readonly #onConfirmedOutcome?: CardPaymentApplicationOptions["onConfirmedOutcome"];

  constructor(manager: CardPaymentManager, conditionalOfferApplication: ConditionalOfferApplication, clock: () => Date, payments?: Payments, onConfirmedOutcome?: CardPaymentApplicationOptions["onConfirmedOutcome"]) {
    this.#manager = manager;
    managers.set(this, manager);
    this.#conditionalOfferApplication = conditionalOfferApplication;
    this.#clock = clock;
    this.#payments = payments;
    this.#onConfirmedOutcome = onConfirmedOutcome;
  }

  getArtifact(offerId: string, viewer: CommandPrincipal): CardPaymentArtifact {
    const offer = this.#conditionalOfferApplication.getOffer(offerId);
    const projection = this.#manager.projectInteractionState(offerId);
    const session = this.#manager.getCheckoutSession(offerId);
    const contract = this.#manager.getBookingContract(offerId);
    const reservation = contract && projection.reservationId ? { reservationId: projection.reservationId, contractId: contract.contractId, unitId: contract.unitId, primaryGuestId: contract.parties.primaryGuest.id, dates: contract.dates, status: "confirmed" as const, confirmedAt: contract.paymentDetails.paidAt } : undefined;
    return cardPaymentArtifactFromState({ offer, viewer, session, contract, reservation, journey: this.#manager.getPaymentJourney(offerId), now: this.#clock() });
  }

  /** Façade read of the active card checkout session for an offer. */
  getCheckoutSession(offerId: string): CardCheckoutSession | undefined {
    return this.#manager.getCheckoutSession(offerId);
  }

  /** Façade read of a card checkout session by PSP reference. */
  getCheckoutSessionByReference(pspReference: string): CardCheckoutSession | undefined {
    return this.#manager.getCheckoutSessionByReference(pspReference);
  }

  /** Façade read of the Booking Payment Journey for an offer. */
  getPaymentJourney(offerId: string): ReturnType<CardPaymentManager["getPaymentJourney"]> {
    return this.#manager.getPaymentJourney(offerId);
  }

  initializeCheckout(offerId: string, trustedPayerPrincipal: CommandPrincipal): CardCheckoutSession {
    return this.initializeCheckoutFromCommand(
      createPlatformCommandEnvelope({ commandName: "card_payment.initialize_checkout", principal: trustedPayerPrincipal, payload: { offerId } }),
    );
  }

  /** Runs the gate-built platform command for `shortlet.card-payment.initialize-checkout` (ADR 0072). */
  initializeCheckoutFromCommand(envelope: PlatformCommandEnvelope<{ readonly offerId: string }>): CardCheckoutSession {
    return this.#manager.initializeCardCheckout(envelope, { clock: this.#clock });
  }

  verifyAndConfirm(pspReference: string, trustedServerPrincipal: CommandPrincipal) {
    const session = this.#manager.getCheckoutSessionByReference(pspReference);
    if (!session) throw new Error("Unknown PSP reference");
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.verify_and_confirm", principal: trustedServerPrincipal, payload: { offerId: session.offerId, pspReference } });
    const outcome = this.#manager.verifyAndConfirmCardPayment(envelope, { clock: this.#clock });
    if (outcome.outcome === "confirmed") this.#onConfirmedOutcome?.(outcome);
    return outcome;
  }

  async initializePaystackCheckout(offerId: string, trustedPayerPrincipal: CommandPrincipal, providerOverride?: Payments): Promise<CardCheckoutSession> {
    const payments = providerOverride ?? this.#payments;
    if (!payments) throw new Error("Paystack checkout is not configured");
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.initialize_checkout", principal: trustedPayerPrincipal, payload: { offerId } });
    const existing = this.#manager.getCheckoutSession(offerId);
    if (existing?.status === "initiated" && existing.providerEnvironment !== undefined && isApprovedPaystackCheckoutUrl(existing.checkoutUrl)) return existing;
    const session = existing?.status === "initiated"
      ? existing
      : this.#manager.initializeCardCheckout(envelope, { clock: this.#clock, reuseExisting: true });
    const started = await payments.start({
      domainId: SHORTLET_DOMAIN_ID,
      method: "card",
      reference: session.pspReference,
      email: session.contactEmail,
      amountKobo: session.amountKobo,
      currency: "NGN",
      payerId: trustedPayerPrincipal.id,
    });
    if (started.method !== "card") throw new Error("Paystack initialization returned a non-card checkout");
    return this.#manager.updateCheckoutUrl(session.pspReference, started.authorizationUrl, started.environment);
  }

  async verifyAndConfirmPaystack(pspReference: string, trustedServerPrincipal: CommandPrincipal, providerOverride?: Payments) {
    const payments = providerOverride ?? this.#payments;
    if (!payments) throw new Error("Paystack checkout is not configured");
    const session = this.#manager.getCheckoutSessionByReference(pspReference);
    if (!session) throw new Error("Unknown PSP reference");
    const result = toProviderResult(await payments.confirm(pspReference));
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.verify_and_confirm", principal: trustedServerPrincipal, payload: { offerId: session.offerId, pspReference } });
    const outcome = this.#manager.verifyAndConfirmCardPaymentWithProviderResult(envelope, result, { clock: this.#clock });
    if (outcome.outcome === "confirmed") this.#onConfirmedOutcome?.(outcome);
    return outcome;
  }
}

export function createCardPaymentApplication(options: CardPaymentApplicationOptions): CardPaymentApplication {
  if (!options.bookingState?.saveBookingAtomically || !options.bookingState.removeBookingAtomically) throw new Error("Atomic BookingState authority is required");
  if (!options.guestContacts) throw new Error("Guest contact source is required");
  const { conditionalOfferApplication, clock = () => new Date(), onConfirmedOutcome, ...dependencies } = options;
  const { payments, ...managerDependencies } = dependencies;
  return new CardPaymentApplication(new CardPaymentManager({ ...managerDependencies, offerManager: getConditionalOfferManager(conditionalOfferApplication) }), conditionalOfferApplication, clock, payments, onConfirmedOutcome);
}

import { CardPaymentManager, type CardCheckoutSession, type CardPaymentManagerOptions, type PSPVerifyResult, type PaystackClient, isApprovedPaystackCheckoutUrl } from "../../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { cardPaymentArtifactFromState, type CardPaymentArtifact } from "./card-payment-artifact.js";

export interface CardPaymentApplicationOptions {
  readonly conditionalOfferApplication: ConditionalOfferApplication;
  readonly repository?: CardPaymentManagerOptions["repository"];
  readonly calendar?: CardPaymentManagerOptions["calendar"];
  readonly audit?: CardPaymentManagerOptions["audit"];
  readonly pspClient?: CardPaymentManagerOptions["pspClient"];
  readonly liveAttempts?: CardPaymentManagerOptions["liveAttempts"];
  readonly clock?: () => Date;
  readonly journeyRepository?: import("../../../domains/shortlet/src/booking-payment-journey.js").BookingPaymentJourneyRepository;
  readonly securityDepositCapability?: CardPaymentManagerOptions["securityDepositCapability"];
  readonly securityDepositAccounting?: CardPaymentManagerOptions["securityDepositAccounting"];
  readonly bookingState: NonNullable<CardPaymentManagerOptions["bookingState"]>;
  readonly compensationRefundProvider?: CardPaymentManagerOptions["compensationRefundProvider"];
  readonly store?: import("../../../domains/shortlet/src/guest-interaction-store.js").SqliteGuestInteractionStore | null;
  readonly guestContacts: NonNullable<CardPaymentManagerOptions["guestContacts"]>;
  readonly paystackClient?: PaystackClient;
  readonly onConfirmedOutcome?: (outcome: { readonly outcome: "confirmed"; readonly reservation: import("../../../domains/shortlet/src/index.js").Reservation; readonly bookingContract: import("../../../domains/shortlet/src/index.js").BookingContract }) => void;
}

export class CardPaymentApplication {
  readonly manager: CardPaymentManager;
  readonly #conditionalOfferApplication: ConditionalOfferApplication;
  readonly #clock: () => Date;
  readonly #paystackClient?: PaystackClient;
  readonly #onConfirmedOutcome?: CardPaymentApplicationOptions["onConfirmedOutcome"];

  constructor(manager: CardPaymentManager, conditionalOfferApplication: ConditionalOfferApplication, clock: () => Date, paystackClient?: PaystackClient, onConfirmedOutcome?: CardPaymentApplicationOptions["onConfirmedOutcome"]) {
    this.manager = manager;
    this.#conditionalOfferApplication = conditionalOfferApplication;
    this.#clock = clock;
    this.#paystackClient = paystackClient;
    this.#onConfirmedOutcome = onConfirmedOutcome;
  }

  getArtifact(offerId: string, viewer: CommandPrincipal): CardPaymentArtifact {
    const offer = this.#conditionalOfferApplication.manager.getOffer(offerId);
    const projection = this.manager.projectInteractionState(offerId);
    const session = this.manager.getCheckoutSession(offerId);
    const contract = this.manager.getBookingContract(offerId);
    const reservation = contract && projection.reservationId ? { reservationId: projection.reservationId, contractId: contract.contractId, unitId: contract.unitId, primaryGuestId: contract.parties.primaryGuest.id, dates: contract.dates, status: "confirmed" as const, confirmedAt: contract.paymentDetails.paidAt } : undefined;
    return cardPaymentArtifactFromState({ offer, viewer, session, contract, reservation, journey: this.manager.getPaymentJourney(offerId), now: this.#clock() });
  }

  initializeCheckout(offerId: string, trustedPayerPrincipal: CommandPrincipal): CardCheckoutSession {
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.initialize_checkout", principal: trustedPayerPrincipal, payload: { offerId } });
    return this.manager.initializeCardCheckout(envelope, { clock: this.#clock });
  }

  verifyAndConfirm(pspReference: string, trustedServerPrincipal: CommandPrincipal) {
    const session = this.manager.getCheckoutSessionByReference(pspReference);
    if (!session) throw new Error("Unknown PSP reference");
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.verify_and_confirm", principal: trustedServerPrincipal, payload: { offerId: session.offerId, pspReference } });
    const outcome = this.manager.verifyAndConfirmCardPayment(envelope, { clock: this.#clock });
    if (outcome.outcome === "confirmed") this.#onConfirmedOutcome?.(outcome);
    return outcome;
  }

  async initializePaystackCheckout(offerId: string, trustedPayerPrincipal: CommandPrincipal, providerOverride?: PaystackClient): Promise<CardCheckoutSession> {
    const paystackClient = providerOverride ?? this.#paystackClient;
    if (!paystackClient) throw new Error("Paystack checkout is not configured");
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.initialize_checkout", principal: trustedPayerPrincipal, payload: { offerId } });
    const existing = this.manager.getCheckoutSession(offerId);
    if (existing?.status === "initiated" && existing.providerEnvironment === paystackClient.configuration.environment && existing.checkoutUrl.startsWith("https://checkout.paystack.com/")) return existing;
    const session = existing?.status === "initiated"
      ? existing
      : this.manager.initializeCardCheckout(envelope, { clock: this.#clock, providerEnvironment: paystackClient.configuration.environment, reuseExisting: true });
    const initialized = await paystackClient.initializeTransaction({
      email: session.contactEmail,
      amountKobo: session.amountKobo,
      currency: "NGN",
      reference: session.pspReference,
      callbackUrl: new URL("/payments/paystack/callback", `${paystackClient.configuration.callbackBaseUrl}/`).toString(),
      payerId: trustedPayerPrincipal.id,
    });
    if (!isApprovedPaystackCheckoutUrl(initialized.authorizationUrl)) throw new Error("Paystack initialization returned an invalid checkout");
    return this.manager.updateCheckoutUrl(session.pspReference, initialized.authorizationUrl, initialized.environment);
  }

  async verifyAndConfirmPaystack(pspReference: string, trustedServerPrincipal: CommandPrincipal, providerOverride?: PaystackClient) {
    const paystackClient = providerOverride ?? this.#paystackClient;
    if (!paystackClient) throw new Error("Paystack checkout is not configured");
    const session = this.manager.getCheckoutSessionByReference(pspReference);
    if (!session) throw new Error("Unknown PSP reference");
    const result: PSPVerifyResult = await paystackClient.verifyTransaction(pspReference);
    const envelope = createPlatformCommandEnvelope({ commandName: "card_payment.verify_and_confirm", principal: trustedServerPrincipal, payload: { offerId: session.offerId, pspReference } });
    const outcome = this.manager.verifyAndConfirmCardPaymentWithProviderResult(envelope, result, { clock: this.#clock });
    if (outcome.outcome === "confirmed") this.#onConfirmedOutcome?.(outcome);
    return outcome;
  }
}

export function createCardPaymentApplication(options: CardPaymentApplicationOptions): CardPaymentApplication {
  if (!options.bookingState?.saveBookingAtomically || !options.bookingState.removeBookingAtomically) throw new Error("Atomic BookingState authority is required");
  if (!options.guestContacts) throw new Error("Guest contact source is required");
  const { conditionalOfferApplication, clock = () => new Date(), onConfirmedOutcome, ...dependencies } = options;
  const { paystackClient, ...managerDependencies } = dependencies;
  return new CardPaymentApplication(new CardPaymentManager({ ...managerDependencies, offerManager: conditionalOfferApplication.manager }), conditionalOfferApplication, clock, paystackClient, onConfirmedOutcome);
}

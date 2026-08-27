import { CardPaymentManager, type CardCheckoutSession, type CardPaymentManagerOptions } from "../../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { cardPaymentArtifactFromState, type CardPaymentArtifact } from "./card-payment-artifact.js";

export interface CardPaymentApplicationOptions {
  readonly conditionalOfferApplication: ConditionalOfferApplication;
  readonly repository?: CardPaymentManagerOptions["repository"];
  readonly calendar?: CardPaymentManagerOptions["calendar"];
  readonly audit?: CardPaymentManagerOptions["audit"];
  readonly pspClient: NonNullable<CardPaymentManagerOptions["pspClient"]>;
  readonly liveAttempts?: CardPaymentManagerOptions["liveAttempts"];
  readonly clock?: () => Date;
  readonly journeyRepository?: import("../../../domains/shortlet/src/booking-payment-journey.js").BookingPaymentJourneyRepository;
  readonly securityDepositCapability?: CardPaymentManagerOptions["securityDepositCapability"];
  readonly securityDepositAccounting?: CardPaymentManagerOptions["securityDepositAccounting"];
  readonly bookingState?: CardPaymentManagerOptions["bookingState"];
  readonly compensationRefundProvider?: CardPaymentManagerOptions["compensationRefundProvider"];
}

export class CardPaymentApplication {
  readonly manager: CardPaymentManager;
  readonly #conditionalOfferApplication: ConditionalOfferApplication;
  readonly #clock: () => Date;

  constructor(manager: CardPaymentManager, conditionalOfferApplication: ConditionalOfferApplication, clock: () => Date) {
    this.manager = manager;
    this.#conditionalOfferApplication = conditionalOfferApplication;
    this.#clock = clock;
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
    return this.manager.verifyAndConfirmCardPayment(envelope, { clock: this.#clock });
  }
}

export function createCardPaymentApplication(options: CardPaymentApplicationOptions): CardPaymentApplication {
  const { conditionalOfferApplication, clock = () => new Date(), ...dependencies } = options;
  return new CardPaymentApplication(new CardPaymentManager({ ...dependencies, offerManager: conditionalOfferApplication.manager }), conditionalOfferApplication, clock);
}

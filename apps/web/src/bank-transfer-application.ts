import { BankTransferPaymentManager, type BankTransferCheckoutSession, type BankTransferPaymentManagerOptions } from "../../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { bankTransferArtifactFromState, type BankTransferArtifact } from "./bank-transfer-artifact.js";

export interface BankTransferPaymentApplicationOptions {
  readonly conditionalOfferApplication: ConditionalOfferApplication;
  readonly calendar?: BankTransferPaymentManagerOptions["calendar"];
  readonly audit?: BankTransferPaymentManagerOptions["audit"];
  readonly providerClient: BankTransferPaymentManagerOptions["providerClient"];
  readonly clock?: () => Date;
}

export class BankTransferPaymentApplication {
  readonly manager: BankTransferPaymentManager;
  readonly #conditionalOfferApplication: ConditionalOfferApplication;
  readonly #clock: () => Date;
  constructor(manager: BankTransferPaymentManager, conditionalOfferApplication: ConditionalOfferApplication, clock: () => Date) { this.manager = manager; this.#conditionalOfferApplication = conditionalOfferApplication; this.#clock = clock; }
  getArtifact(offerId: string, viewer: CommandPrincipal): BankTransferArtifact {
    const offer = this.#conditionalOfferApplication.manager.getOffer(offerId);
    const session = this.manager.getSession(offerId); const contract = this.manager.getBookingContract(offerId);
    return bankTransferArtifactFromState({ offer, viewer, session, contract, refundRecord: this.manager.getRefundRecord(offerId), reconciliationRecord: this.manager.getReconciliationRecord(offerId), now: this.#clock() });
  }
  initializeTransfer(offerId: string, trustedPayerPrincipal: CommandPrincipal): BankTransferCheckoutSession {
    return this.manager.initializeBankTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.initialize", principal: trustedPayerPrincipal, payload: { offerId } }), { clock: this.#clock });
  }
  verifyAndProcess(transferReference: string, trustedServerPrincipal: CommandPrincipal) {
    return this.manager.verifyAndProcessTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.verify_and_process", principal: trustedServerPrincipal, payload: { transferReference } }), { clock: this.#clock });
  }
  resolveExpiry(offerId: string, trustedServerPrincipal: CommandPrincipal) {
    return this.manager.resolveExpiry(offerId, trustedServerPrincipal, { clock: this.#clock });
  }
}

export function createBankTransferPaymentApplication(options: BankTransferPaymentApplicationOptions): BankTransferPaymentApplication {
  const { conditionalOfferApplication, clock = () => new Date(), ...dependencies } = options;
  return new BankTransferPaymentApplication(new BankTransferPaymentManager({ ...dependencies, offerManager: conditionalOfferApplication.manager }), conditionalOfferApplication, clock);
}

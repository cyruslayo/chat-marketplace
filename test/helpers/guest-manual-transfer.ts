import { DatabaseSync } from "node:sqlite";
import type { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/index.js";
import { ManualTransferManager, SqliteGuestInteractionStore, SqliteLivePaymentAttemptRegistry, SqliteManualTransferStore, type ManualTransfer } from "../../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../../packages/platform-core/src/index.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS } from "./guest-payment-page.js";

/**
 * The Guest side of a manual transfer (P5), writing to the back office's SQLite file through its own connection, as
 * the pilot's guest server does: accept the offer, start the manual transfer, upload a receipt.
 */
export interface GuestManualTransfers {
  start(requestId: string): ManualTransfer;
  upload(requestId: string, bytes?: Buffer): ManualTransfer;
  close(): void;
}

export function guestManualTransfers(env: LocalApartmentOwnerEnvironment): GuestManualTransfers {
  const database = new DatabaseSync(env.config.databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  const store = new SqliteGuestInteractionStore(env.config.databasePath, database);
  const manager = new ManualTransferManager({
    offerManager: env.conditionalOfferApp.manager,
    store: new SqliteManualTransferStore(database),
    account: TEST_MANUAL_ACCOUNT,
    liveAttempts: new SqliteLivePaymentAttemptRegistry(store),
    calendar: env.calendar,
    receiptMaxBytes: 5 * 1024 * 1024,
  });
  const offerIdFor = (requestId: string) => {
    const offer = store.findConditionalOfferByRequestId(requestId);
    if (!offer) throw new Error(`No Conditional Booking Offer for ${requestId}`);
    return offer.offerId;
  };
  const guestFor = (offerId: string): CommandPrincipal => {
    const offer = env.conditionalOfferApp.manager.getOffer(offerId);
    return { id: offer.parties.primaryGuest.id, role: "guest", tenantId: offer.tenantId ?? env.config.tenantId };
  };
  return {
    start(requestId) {
      const offerId = offerIdFor(requestId);
      const offer = env.conditionalOfferApp.manager.getOffer(offerId);
      if (offer.status !== "accepted") env.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: guestFor(offerId) });
      return manager.start(createPlatformCommandEnvelope({ commandName: "manual_transfer.start", principal: guestFor(offerId), payload: { offerId } }), env.clock);
    },
    upload(requestId, bytes = TEST_RECEIPTS.png) {
      const offerId = offerIdFor(requestId);
      return manager.uploadReceipt(createPlatformCommandEnvelope({ commandName: "manual_transfer.upload_receipt", principal: guestFor(offerId), payload: { offerId } }), { bytes }, env.clock);
    },
    close() { if (database.isOpen) database.close(); },
  };
}

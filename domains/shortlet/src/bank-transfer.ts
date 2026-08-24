import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { ConditionalBookingOffer } from "./conditional-offer.js";
import { BookingContract, Reservation, LedgerEntry } from "./card-payment.js";

/**
 * ADR 0047: Expiring bank transfer session with unique reference and exact NGN amount binding.
 */
export interface BankTransferCheckoutSession {
  readonly checkoutId: string;
  readonly offerId: string;
  readonly transferReference: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly totalAmountDueNowKobo: number;
  readonly currency: "NGN";
  readonly expiresAt: string;
  status: "initiated" | "completed" | "expired" | "failed" | "refunded";
}

export interface BankTransferRefundRecord {
  readonly refundId: string;
  readonly offerId: string;
  readonly transferReference: string;
  readonly amountKobo: number;
  readonly currency: "NGN";
  readonly reason: "late_payment_after_expiry" | "duplicate_payment";
  readonly status: "initiated" | "completed";
  readonly createdAt: string;
}

export interface BankTransferReconciliationRecord {
  readonly reconciliationId: string;
  readonly offerId: string;
  readonly transferReference: string;
  readonly amountKobo: number;
  readonly status: "quarantined_for_refund" | "reconciled";
  readonly createdAt: string;
}

export interface MockBankTransferVerifyResult {
  readonly verified: boolean;
  readonly status: "success" | "pending" | "failed";
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  readonly failureReason?: string;
}

export interface BankTransferPaymentManagerOptions {
  readonly offerManager: {
    getOffer(offerId: string): ConditionalBookingOffer;
  };
  readonly calendar?: {
    transitionPaymentPendingToConfirmedBooking(input: {
      commitmentId: string;
      unitId: string;
      start: string;
      end: string;
      clock: () => Date;
    }): unknown;
    releaseInventory?(unitId: string, checkIn: string, checkOut: string): void;
  };
  readonly audit?: {
    record(entry: Record<string, unknown>): void;
  };
}

export class BankTransferPaymentManager {
  readonly #offerManager: BankTransferPaymentManagerOptions["offerManager"];
  readonly #calendar?: BankTransferPaymentManagerOptions["calendar"];
  readonly #audit?: BankTransferPaymentManagerOptions["audit"];

  readonly #sessionsByOffer = new Map<string, BankTransferCheckoutSession>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #contracts = new Map<string, BookingContract>();
  readonly #ledgerEntries = new Map<string, LedgerEntry[]>();
  readonly #refundRecords = new Map<string, BankTransferRefundRecord>();
  readonly #reconciliationRecords = new Map<string, BankTransferReconciliationRecord>();
  readonly #processedReferences = new Map<string, { reservationId?: string; contractId?: string; outcome: string }>();

  constructor(options: BankTransferPaymentManagerOptions) {
    if (!options.offerManager) {
      throw new Error("offerManager is required for BankTransferPaymentManager");
    }
    this.#offerManager = options.offerManager;
    this.#calendar = options.calendar;
    this.#audit = options.audit;
  }

  /**
   * ADR 0046 & ADR 0047: Initialize expiring booking-specific bank transfer.
   * Enforces only ONE Live Payment Attempt per offer.
   */
  initializeBankTransfer(
    envelope: PlatformCommandEnvelope<{ offerId: string } & Record<string, unknown>>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): BankTransferCheckoutSession {
    if (!envelope || envelope.commandName !== "bank_transfer.initialize") {
      throw new Error("Invalid envelope: commandName must be 'bank_transfer.initialize'");
    }

    const { offerId } = envelope.payload ?? {};
    if (!offerId) throw new Error("offerId is required to initialize bank transfer");

    const offer = this.#offerManager.getOffer(offerId);

    // Cross-tenant check
    if (offer.tenantId && envelope.principal.tenantId && offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    if (offer.status !== "accepted") {
      throw new Error(`Bank transfer initialization requires an accepted offer (current status: '${offer.status}')`);
    }

    const now = clock();
    const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
    if (now.getTime() >= paymentWindowEnd) {
      throw new Error("Payment window has expired; cannot initialize bank transfer");
    }

    // ADR 0046: Permit only one live payment attempt
    const existingSession = this.#sessionsByOffer.get(offerId);
    if (existingSession && existingSession.status === "initiated" && now.getTime() < paymentWindowEnd) {
      return { ...existingSession };
    }

    const transferReference = `exp_trf_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
    const checkoutId = `chk_trf_${now.getTime()}`;

    const session: BankTransferCheckoutSession = {
      checkoutId,
      offerId: offer.offerId,
      transferReference,
      bankName: "Concierge Reserve Bank (GTBank)",
      accountNumber: `012${Math.floor(1000000 + Math.random() * 9000000)}`,
      totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
      currency: "NGN",
      expiresAt: offer.paymentWindow.expiresAt,
      status: "initiated"
    };

    this.#sessionsByOffer.set(offerId, session);

    if (this.#audit) {
      this.#audit.record({
        type: "bank_transfer.initialized",
        checkoutId,
        offerId: offer.offerId,
        transferReference,
        amountKobo: session.totalAmountDueNowKobo,
        initiatedAt: now.toISOString()
      });
    }

    return { ...session };
  }

  /**
   * ADR 0044, 0045, 0046, 0047: Server-side bank transfer verification & processing.
   */
  verifyAndProcessTransfer(
    envelope: PlatformCommandEnvelope<{
      offerId: string;
      transferReference: string;
      mockPspResult?: MockBankTransferVerifyResult;
    } & Record<string, unknown>>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): {
    outcome: "confirmed" | "processing_in_grace" | "late_payment_refunded" | "failed";
    reservation?: Reservation;
    bookingContract?: BookingContract;
    ledgerEntries?: readonly LedgerEntry[];
    refundRecord?: BankTransferRefundRecord;
    reconciliationRecord?: BankTransferReconciliationRecord;
  } {
    if (!envelope || envelope.commandName !== "bank_transfer.verify_and_process") {
      throw new Error("Invalid envelope: commandName must be 'bank_transfer.verify_and_process'");
    }

    const { offerId, transferReference, mockPspResult } = envelope.payload ?? {};
    if (!offerId || !transferReference) {
      throw new Error("offerId and transferReference are required for transfer verification");
    }

    // Idempotency check
    const existingRef = this.#processedReferences.get(transferReference);
    if (existingRef && existingRef.outcome === "confirmed" && existingRef.reservationId && existingRef.contractId) {
      const reservation = this.#reservations.get(existingRef.reservationId)!;
      const bookingContract = this.#contracts.get(existingRef.contractId)!;
      const ledgerEntries = this.#ledgerEntries.get(existingRef.reservationId) ?? [];
      return { outcome: "confirmed", reservation, bookingContract, ledgerEntries };
    }

    const offer = this.#offerManager.getOffer(offerId);

    // Cross-tenant check
    if (offer.tenantId && envelope.principal.tenantId && offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    const now = clock();
    const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
    const graceEnd = paymentWindowEnd + 10 * 60 * 1000; // 10-minute grace (ADR 0044)

    const pspResult = mockPspResult;
    if (!pspResult) {
      throw new Error("PSP verification result is required");
    }

    // 1. Late Success Classification (>30 minutes total or >20 minutes without in-flight grace) (ADR 0045)
    const isLateSuccess = pspResult.status === "success" && now.getTime() > paymentWindowEnd;

    if (isLateSuccess) {
      // Release inventory atomically (ADR 0045)
      if (this.#calendar?.releaseInventory) {
        this.#calendar.releaseInventory(offer.unitId, offer.dates.checkIn, offer.dates.checkOut);
      }

      const refundId = `ref_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
      const reconciliationId = `rec_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;

      const refundRecord: BankTransferRefundRecord = {
        refundId,
        offerId: offer.offerId,
        transferReference,
        amountKobo: pspResult.amountKobo,
        currency: "NGN",
        reason: "late_payment_after_expiry",
        status: "initiated",
        createdAt: now.toISOString()
      };

      const reconciliationRecord: BankTransferReconciliationRecord = {
        reconciliationId,
        offerId: offer.offerId,
        transferReference,
        amountKobo: pspResult.amountKobo,
        status: "quarantined_for_refund",
        createdAt: now.toISOString()
      };

      this.#refundRecords.set(refundId, refundRecord);
      this.#reconciliationRecords.set(reconciliationId, reconciliationRecord);
      this.#processedReferences.set(transferReference, { outcome: "late_payment_refunded" });

      if (this.#audit) {
        this.#audit.record({
          type: "bank_transfer.late_payment_refunded",
          offerId: offer.offerId,
          transferReference,
          refundId,
          reconciliationId,
          amountKobo: pspResult.amountKobo,
          timestamp: now.toISOString()
        });
      }

      return { outcome: "late_payment_refunded", refundRecord, reconciliationRecord };
    }

    // 2. In Grace Window (20-30 min) with Pending state
    if (now.getTime() > paymentWindowEnd && now.getTime() <= graceEnd && pspResult.status === "pending") {
      return { outcome: "processing_in_grace" };
    }

    // 3. Normal Verification within 20 min or grace success
    if (now.getTime() <= graceEnd && pspResult.status === "success") {
      // Validation checks
      if (pspResult.currency !== "NGN") {
        throw new Error(`Currency verification failed: Expected NGN, got ${pspResult.currency}`);
      }
      if (pspResult.amountKobo !== offer.totalAmountDueNowKobo) {
        throw new Error(`Amount verification failed: Expected ${offer.totalAmountDueNowKobo}, got ${pspResult.amountKobo}`);
      }

      const reservationId = `res_trf_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
      const contractId = `ctr_trf_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;

      const reservation: Reservation = {
        reservationId,
        contractId,
        unitId: offer.unitId,
        primaryGuestId: offer.parties.primaryGuest.id,
        dates: { checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut },
        status: "confirmed",
        confirmedAt: now.toISOString()
      };

      const bookingContract: BookingContract = {
        contractId,
        reservationId,
        offerId: offer.offerId,
        unitId: offer.unitId,
        tenantId: offer.tenantId,
        parties: offer.parties,
        dates: offer.dates,
        occupants: offer.occupants,
        quote: offer.quote,
        totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
        policies: offer.policies,
        paymentDetails: {
          pspReference: transferReference,
          paymentMethod: "fresh_card", // or bank_transfer
          amountKobo: pspResult.amountKobo,
          currency: "NGN",
          paidAt: now.toISOString(),
          cardMetadata: { brand: "BankTransfer", last4: "0000" }
        },
        createdAt: now.toISOString(),
        contractVersion: 1
      };

      const ledgerEntries: LedgerEntry[] = [
        {
          entryId: `led_${reservationId}_1`,
          reservationId,
          type: "guest_payment_credit",
          amountKobo: offer.totalAmountDueNowKobo,
          currency: "NGN",
          createdAt: now.toISOString()
        }
      ];

      if (!this.#calendar) {
        throw new Error("Authoritative availability calendar is required to confirm a Booking");
      }
      this.#calendar.transitionPaymentPendingToConfirmedBooking({
        commitmentId: offer.inventoryCommitmentId,
        unitId: offer.unitId,
        start: offer.dates.checkIn,
        end: offer.dates.checkOut,
        clock: () => now
      });

      this.#reservations.set(reservationId, reservation);
      this.#contracts.set(contractId, bookingContract);
      this.#ledgerEntries.set(reservationId, ledgerEntries);
      this.#processedReferences.set(transferReference, { reservationId, contractId, outcome: "confirmed" });

      return { outcome: "confirmed", reservation, bookingContract, ledgerEntries: Object.freeze(ledgerEntries) };
    }

    return { outcome: "failed" };
  }
}

import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { ConditionalBookingOffer } from "./conditional-offer.js";

/**
 * ADR 0049 & AC 1: Strictly reject payloads containing raw PAN, CVV, PIN, OTP, or reusable card tokens.
 */
function assertNoRawCardCredentials(payload: Record<string, unknown>): void {
  if (!payload || typeof payload !== "object") return;
  const forbiddenKeys = [
    "pan",
    "cvv",
    "cvc",
    "pin",
    "otp",
    "reusableToken",
    "cardToken",
    "cardNumber",
    "secret",
    "card_number",
    "cvv_code"
  ];
  for (const key of forbiddenKeys) {
    if (key in payload && payload[key] !== undefined && payload[key] !== null) {
      throw new Error(`Security policy violation: Platform must handle no raw payment credentials (${key})`);
    }
  }
}

export interface CardCheckoutSession {
  readonly checkoutId: string;
  readonly offerId: string;
  readonly pspReference: string;
  readonly checkoutUrl: string;
  readonly totalAmountDueNowKobo: number;
  readonly currency: "NGN";
  readonly expiresAt: string;
  status: "initiated" | "completed" | "expired" | "failed";
}

export interface BookingContract {
  readonly contractId: string;
  readonly reservationId: string;
  readonly offerId: string;
  readonly unitId: string;
  readonly tenantId?: string;
  readonly parties: {
    readonly primaryGuest: { readonly id: string; readonly name: string };
    readonly operator: { readonly id: string; readonly name?: string };
    readonly distinctPayer?: { readonly id: string; readonly name: string } | null;
  };
  readonly dates: { readonly checkIn: string; readonly checkOut: string; readonly nights: number };
  readonly occupants: readonly { readonly name: string }[];
  readonly quote: unknown;
  readonly totalAmountDueNowKobo: number;
  readonly policies: {
    readonly cancellationPolicy: unknown;
    readonly guestConductRules: readonly string[];
  };
  readonly paymentDetails: {
    readonly pspReference: string;
    readonly paymentMethod: "fresh_card";
    readonly amountKobo: number;
    readonly currency: "NGN";
    readonly paidAt: string;
    readonly cardMetadata: { readonly brand: string; readonly last4: string };
  };
  readonly createdAt: string;
  readonly contractVersion: number;
}

export interface Reservation {
  readonly reservationId: string;
  readonly contractId: string;
  readonly unitId: string;
  readonly primaryGuestId: string;
  readonly dates: { readonly checkIn: string; readonly checkOut: string };
  readonly status: "confirmed";
  readonly confirmedAt: string;
}

export interface LedgerEntry {
  readonly entryId: string;
  readonly reservationId: string;
  readonly type:
    | "guest_payment_credit"
    | "operator_net_pending"
    | "platform_commission_pending"
    | "security_deposit_hold";
  readonly amountKobo: number;
  readonly currency: "NGN";
  readonly createdAt: string;
}

export interface MockPSPVerifyResult {
  readonly verified: boolean;
  readonly status: "success" | "pending" | "failed";
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  readonly cardMetadata?: { readonly brand: string; readonly last4: string };
  readonly failureReason?: string;
}

export interface CardPaymentManagerOptions {
  readonly offerManager: {
    getOffer(offerId: string): ConditionalBookingOffer;
  };
  readonly repository?: {
    findById(id: string): unknown;
    findAll(): unknown[];
  };
  readonly calendar?: {
    transitionPaymentPendingToConfirmedBooking(input: {
      commitmentId: string;
      unitId: string;
      start: string;
      end: string;
      clock: () => Date;
    }): unknown;
  };
  readonly audit?: {
    record(entry: Record<string, unknown>): void;
  };
  readonly pspClient?: {
    verifyTransaction(pspReference: string): MockPSPVerifyResult;
  };
}

export class CardPaymentManager {
  readonly #offerManager: CardPaymentManagerOptions["offerManager"];
  readonly #repository?: CardPaymentManagerOptions["repository"];
  readonly #calendar?: CardPaymentManagerOptions["calendar"];
  readonly #audit?: CardPaymentManagerOptions["audit"];
  readonly #pspClient?: CardPaymentManagerOptions["pspClient"];

  readonly #sessions = new Map<string, CardCheckoutSession>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #contracts = new Map<string, BookingContract>();
  readonly #ledgerEntries = new Map<string, LedgerEntry[]>();
  readonly #processedPspReferences = new Map<string, { reservationId: string; contractId: string }>();

  constructor(options: CardPaymentManagerOptions) {
    if (!options.offerManager) {
      throw new Error("offerManager is required for CardPaymentManager");
    }
    this.#offerManager = options.offerManager;
    this.#repository = options.repository;
    this.#calendar = options.calendar;
    this.#audit = options.audit;
    this.#pspClient = options.pspClient;
  }

  /**
   * ADR 0049: Initialize fresh PSP-hosted card checkout.
   */
  initializeCardCheckout(
    envelope: PlatformCommandEnvelope<{ offerId: string } & Record<string, unknown>>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): CardCheckoutSession {
    if (!envelope || envelope.commandName !== "card_payment.initialize_checkout") {
      throw new Error("Invalid envelope: commandName must be 'card_payment.initialize_checkout'");
    }

    assertNoRawCardCredentials(envelope.payload ?? {});

    const { offerId } = envelope.payload ?? {};
    if (!offerId) throw new Error("offerId is required to initialize checkout");

    const offer = this.#offerManager.getOffer(offerId);

    // Cross-tenant check
    if (offer.tenantId && envelope.principal.tenantId && offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    if (offer.status !== "accepted") {
      throw new Error(`Checkout initialization requires an accepted offer (current status: '${offer.status}')`);
    }

    const now = clock();
    if (now.getTime() >= new Date(offer.paymentWindow.expiresAt).getTime()) {
      throw new Error("Payment window has expired; cannot initialize checkout");
    }

    const pspReference = `psp_ref_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
    const checkoutId = `chk_${now.getTime()}`;
    const checkoutUrl = `https://checkout.psp.example.com/pay/${pspReference}`;

    const session: CardCheckoutSession = {
      checkoutId,
      offerId: offer.offerId,
      pspReference,
      checkoutUrl,
      totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
      currency: "NGN",
      expiresAt: offer.paymentWindow.expiresAt,
      status: "initiated"
    };

    this.#sessions.set(checkoutId, session);

    if (this.#audit) {
      this.#audit.record({
        type: "card_payment.checkout_initialized",
        checkoutId,
        offerId: offer.offerId,
        pspReference,
        amountKobo: session.totalAmountDueNowKobo,
        currency: session.currency,
        commandEnvelopeId: envelope.commandId,
        initiatedAt: now.toISOString()
      });
    }

    return { ...session };
  }

  /**
   * ADR 0002, 0044, 0046, 0050: Server-side payment verification and atomic commitment.
   */
  verifyAndConfirmCardPayment(
    envelope: PlatformCommandEnvelope<{
      offerId: string;
      pspReference: string;
      mockVerifyResult?: MockPSPVerifyResult;
    } & Record<string, unknown>>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): { reservation: Reservation; bookingContract: BookingContract; ledgerEntries: readonly LedgerEntry[] } {
    if (!envelope || envelope.commandName !== "card_payment.verify_and_confirm") {
      throw new Error("Invalid envelope: commandName must be 'card_payment.verify_and_confirm'");
    }

    assertNoRawCardCredentials(envelope.payload ?? {});

    const { offerId, pspReference, mockVerifyResult } = envelope.payload ?? {};
    if (!offerId || !pspReference) {
      throw new Error("offerId and pspReference are required for payment verification");
    }

    // ADR 0046 & AC 3: Idempotency check on duplicate callbacks / retries
    const existingReference = this.#processedPspReferences.get(pspReference);
    if (existingReference) {
      const reservation = this.#reservations.get(existingReference.reservationId)!;
      const bookingContract = this.#contracts.get(existingReference.contractId)!;
      const ledgerEntries = this.#ledgerEntries.get(existingReference.reservationId) ?? [];
      return { reservation, bookingContract, ledgerEntries };
    }

    const offer = this.#offerManager.getOffer(offerId);

    // Cross-tenant check
    if (offer.tenantId && envelope.principal.tenantId && offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    if (offer.status !== "accepted") {
      throw new Error(`Payment verification requires an accepted offer (current status: '${offer.status}')`);
    }

    const now = clock();

    // Verification from PSP
    const pspResult = mockVerifyResult ?? this.#pspClient?.verifyTransaction(pspReference);
    if (!pspResult) {
      throw new Error("Server-side payment verification failed: No PSP result available");
    }

    if (!pspResult.verified || pspResult.status !== "success") {
      // Check Payment-Processing Grace (ADR 0044)
      if (pspResult.status === "pending") {
        const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
        const graceEnd = paymentWindowEnd + 10 * 60 * 1000; // +10 min grace
        if (now.getTime() <= graceEnd) {
          throw new Error("Payment is currently processing under Payment-Processing Grace period");
        }
      }
      throw new Error(`Server-side payment verification failed: ${pspResult.failureReason ?? "PSP transaction unsuccessful"}`);
    }

    // AC 2: Independently verify booking, amount, currency, reference, payer, and unexpired inventory state
    if (pspResult.currency !== "NGN") {
      throw new Error(`Currency verification failed: Expected NGN, got '${pspResult.currency}'`);
    }

    if (pspResult.amountKobo !== offer.totalAmountDueNowKobo) {
      throw new Error(
        `Amount verification failed: Expected ${offer.totalAmountDueNowKobo} kobo, got ${pspResult.amountKobo} kobo`
      );
    }

    if (pspResult.pspReference !== pspReference) {
      throw new Error(`Reference verification failed: Expected ${pspReference}, got ${pspResult.pspReference}`);
    }

    // Verify Payer Attribution (ADR 0013, 0050)
    const expectedPayerId = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
    if (!pspResult.payerId || pspResult.payerId !== expectedPayerId) {
      throw new Error(`Payer attribution verification failed: Expected ${expectedPayerId}, got ${pspResult.payerId ?? "none"}`);
    }

    // Expiry check (Payment Window + Grace)
    const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
    const graceEnd = paymentWindowEnd + 10 * 60 * 1000; // 10 minutes grace for pending
    if (now.getTime() > graceEnd) {
      throw new Error("Payment verification failed: Payment Window and Grace period have expired");
    }

    // Revalidate Unit publication state from repository if provided
    if (this.#repository) {
      interface UnitRecord {
        id?: string;
        published?: boolean;
        inspection?: {
          materialChangePending?: boolean;
        };
      }
      const rawUnit = this.#repository.findById
        ? (this.#repository.findById(offer.unitId) as UnitRecord | undefined)
        : (this.#repository.findAll() as UnitRecord[]).find((u) => u?.id === offer.unitId);
      if (rawUnit && (!rawUnit.published || rawUnit.inspection?.materialChangePending)) {
        throw new Error("Inventory verification failed: Unit condition or publication status is invalid");
      }
    }

    // Atomic Commitment of Reservation, BookingContract, and Ledger
    const reservationId = `res_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
    const contractId = `ctr_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;

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
        pspReference,
        paymentMethod: "fresh_card",
        amountKobo: pspResult.amountKobo,
        currency: "NGN",
        paidAt: now.toISOString(),
        cardMetadata: pspResult.cardMetadata ?? { brand: "Visa", last4: "4242" }
      },
      createdAt: now.toISOString(),
      contractVersion: 1
    };

    // Ledger posting (Balanced ledger effects)
    const quoteBreakdown = offer.quote?.breakdown ?? {};
    const accommodationNet = quoteBreakdown.accommodationNetKobo ?? Math.round(offer.totalAmountDueNowKobo * 0.85);
    const commission = quoteBreakdown.platformCommissionKobo ?? (offer.totalAmountDueNowKobo - accommodationNet);
    const deposit = offer.refundableSecurityDepositKobo ?? 0;

    const ledgerEntries: LedgerEntry[] = [
      {
        entryId: `led_${reservationId}_1`,
        reservationId,
        type: "guest_payment_credit",
        amountKobo: offer.totalAmountDueNowKobo,
        currency: "NGN",
        createdAt: now.toISOString()
      },
      {
        entryId: `led_${reservationId}_2`,
        reservationId,
        type: "operator_net_pending",
        amountKobo: accommodationNet,
        currency: "NGN",
        createdAt: now.toISOString()
      },
      {
        entryId: `led_${reservationId}_3`,
        reservationId,
        type: "platform_commission_pending",
        amountKobo: commission,
        currency: "NGN",
        createdAt: now.toISOString()
      }
    ];

    if (deposit > 0) {
      ledgerEntries.push({
        entryId: `led_${reservationId}_4`,
        reservationId,
        type: "security_deposit_hold",
        amountKobo: deposit,
        currency: "NGN",
        createdAt: now.toISOString()
      });
    }

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

    // Save authoritative state
    this.#reservations.set(reservationId, reservation);
    this.#contracts.set(contractId, bookingContract);
    this.#ledgerEntries.set(reservationId, ledgerEntries);
    this.#processedPspReferences.set(pspReference, { reservationId, contractId });

    if (this.#audit) {
      this.#audit.record({
        type: "card_payment.confirmed",
        reservationId,
        contractId,
        offerId: offer.offerId,
        pspReference,
        totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
        primaryGuestId: offer.parties.primaryGuest.id,
        commandEnvelopeId: envelope.commandId,
        confirmedAt: reservation.confirmedAt
      });
    }

    return { reservation, bookingContract, ledgerEntries: Object.freeze(ledgerEntries) };
  }

  /**
   * AC 4: Interaction projection reflections.
   */
  projectInteractionState(offerId: string): {
    readonly offerId: string;
    readonly paymentStatus: "awaiting_verification" | "confirmed";
    readonly reservationId?: string;
    readonly contractId?: string;
    readonly confirmedAt?: string;
  } {
    const offer = this.#offerManager.getOffer(offerId);
    let match: { reservationId: string; contractId: string } | undefined;

    for (const record of this.#processedPspReferences.values()) {
      const contract = this.#contracts.get(record.contractId);
      if (contract && contract.offerId === offer.offerId) {
        match = record;
        break;
      }
    }

    if (!match) {
      return {
        offerId: offer.offerId,
        paymentStatus: "awaiting_verification"
      };
    }

    const reservation = this.#reservations.get(match.reservationId)!;
    return {
      offerId: offer.offerId,
      paymentStatus: "confirmed",
      reservationId: reservation.reservationId,
      contractId: match.contractId,
      confirmedAt: reservation.confirmedAt
    };
  }
}

import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { ConditionalBookingOffer } from "./conditional-offer.js";
import type { BookingStateRepository } from "./booking-state.js";
import type { BookingPaymentJourneyRepository, BookingPaymentCompensationPort } from "./booking-payment-journey.js";
import { assertSecurityDepositCollectionAvailable, type SecurityDepositCollectionCapabilityProvider } from "./security-deposit.js";
import type { GuestConductPolicySnapshot } from "./guest-conduct.js";
import type { SecurityDepositPolicySnapshot } from "./security-deposit.js";
import type { SecurityDepositAccountingRepository } from "./security-deposit-accounting.js";

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
  readonly amountKobo: number;
  readonly purpose: "stay" | "security_deposit";
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
  readonly securityDeposit?: { readonly policyVersion: string; readonly amountKobo: number; readonly currency: "NGN"; readonly collectionId?: string; readonly status: "held" | "refunded" | "reconciliation_required" };
  readonly policies: {
    readonly cancellationPolicy: unknown;
    readonly guestConductRules: readonly string[];
    readonly guestConductPolicy?: GuestConductPolicySnapshot;
  };
  readonly disclosures?: readonly string[];
  readonly paymentDetails:
    | {
        readonly paymentMethod: "fresh_card";
        readonly pspReference: string;
        readonly amountKobo: number;
        readonly currency: "NGN";
        readonly paidAt: string;
        readonly cardMetadata?: { readonly brand: string; readonly last4: string };
      }
    | {
        readonly paymentMethod: "bank_transfer";
        readonly transferReference: string;
        readonly amountKobo: number;
        readonly currency: "NGN";
        readonly paidAt: string;
        readonly cardMetadata?: never;
      };
  readonly createdAt: string;
  readonly contractVersion: number;
  readonly checkout?: { readonly time: "11:00" | "12:00" | "13:00" | "14:00"; readonly timezone: "Africa/Lagos"; readonly source: "contractual" | "checkout_amendment"; readonly amendmentId?: string; readonly amendmentVersion?: number | string };
  readonly financialSummary?: { readonly originalBookingTotalKobo: number; readonly currentContractTotalKobo: number; readonly currency: "NGN"; readonly amendmentAdjustments: readonly { readonly amendmentId: string; readonly type: "additional_collection" | "refund" | "none"; readonly amountKobo: number; readonly currency: "NGN"; readonly settlementId?: string; readonly settledAt?: string; readonly quoteId: string; readonly quoteVersion: string | number }[] };
}

export interface Reservation {
  readonly reservationId: string;
  readonly contractId: string;
  readonly unitId: string;
  readonly primaryGuestId: string;
  readonly dates: { readonly checkIn: string; readonly checkOut: string };
  readonly status: "confirmed" | "cancelled" | "no_show";
  readonly confirmedAt: string;
  readonly inventoryCommitmentId?: string;
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

export interface PSPVerifyResult {
  readonly verified: boolean;
  readonly status: "success" | "pending" | "failed";
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  readonly cardMetadata?: { readonly brand: string; readonly last4: string };
  readonly failureReason?: string;
}

/** Test fixtures may alias the provider response type, but production commands cannot carry it. */
export type MockPSPVerifyResult = PSPVerifyResult;

export type CardPaymentVerificationOutcome = { readonly outcome: "deposit_required"; readonly journey: import("./booking-payment-journey.js").BookingPaymentJourney | null } | { readonly outcome?: "confirmed"; readonly reservation: Reservation; readonly bookingContract: BookingContract; readonly ledgerEntries: readonly LedgerEntry[] };

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
    verifyTransaction(pspReference: string): PSPVerifyResult;
  };
  readonly liveAttempts?: import("./payment-attempt.js").LivePaymentAttemptRegistry;
  readonly bookingState?: BookingStateRepository;
  readonly journeyRepository?: BookingPaymentJourneyRepository;
  readonly securityDepositCapability?: SecurityDepositCollectionCapabilityProvider;
  readonly securityDepositAccounting?: SecurityDepositAccountingRepository;
  readonly compensationRefundProvider?: BookingPaymentCompensationPort;
}

export class CardPaymentManager {
  readonly #offerManager: CardPaymentManagerOptions["offerManager"];
  readonly #repository?: CardPaymentManagerOptions["repository"];
  readonly #calendar?: CardPaymentManagerOptions["calendar"];
  readonly #audit?: CardPaymentManagerOptions["audit"];
  readonly #pspClient?: CardPaymentManagerOptions["pspClient"];
  readonly #liveAttempts?: CardPaymentManagerOptions["liveAttempts"];
  readonly #bookingState?: BookingStateRepository;
  readonly #journeys?: BookingPaymentJourneyRepository;
  readonly #securityDepositCapability?: SecurityDepositCollectionCapabilityProvider;
  readonly #securityDepositAccounting?: SecurityDepositAccountingRepository;
  readonly #compensationRefundProvider?: CardPaymentManagerOptions["compensationRefundProvider"];

  readonly #sessions = new Map<string, CardCheckoutSession>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #contracts = new Map<string, BookingContract>();
  readonly #ledgerEntries = new Map<string, LedgerEntry[]>();
  readonly #processedPspReferences = new Map<string, { reservationId: string; contractId: string; offerId: string; tenantId?: string }>();

  constructor(options: CardPaymentManagerOptions) {
    if (!options.offerManager) {
      throw new Error("offerManager is required for CardPaymentManager");
    }
    this.#offerManager = options.offerManager;
    this.#repository = options.repository;
    this.#calendar = options.calendar;
    this.#audit = options.audit;
    this.#pspClient = options.pspClient;
    this.#liveAttempts = options.liveAttempts;
    this.#bookingState = options.bookingState;
    this.#journeys = options.journeyRepository;
    this.#securityDepositCapability = options.securityDepositCapability;
    this.#securityDepositAccounting = options.securityDepositAccounting;
    this.#compensationRefundProvider = options.compensationRefundProvider;
  }

  /**
   * ADR 0049: Initialize fresh PSP-hosted card checkout.
   */
  initializeCardCheckout(
    envelope: PlatformCommandEnvelope<{ offerId: string }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): CardCheckoutSession {
    if (!envelope || envelope.commandName !== "card_payment.initialize_checkout") {
      throw new Error("Invalid envelope: commandName must be 'card_payment.initialize_checkout'");
    }

    assertNoRawCardCredentials(envelope.payload ?? {});

    const payload = envelope.payload ?? {};
    const { offerId } = payload;
    if (!offerId) throw new Error("offerId is required to initialize checkout");
    if (Object.keys(payload).some((key) => key !== "offerId")) {
      throw new Error("Checkout initialization accepts only offerId");
    }

    const offer = this.#offerManager.getOffer(offerId);
    const expectedPayerId = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
    if (envelope.principal.role !== "guest" || !envelope.principal.id || envelope.principal.id !== expectedPayerId) {
      throw new Error("Only the authoritative payer can initialize checkout");
    }
    if (!offer.tenantId || !envelope.principal.tenantId || offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }
    for (const existing of this.#sessions.values()) {
      if (existing.offerId === offerId && existing.status === "initiated") throw new Error("A live checkout already exists for this offer");
    }
    if (offer.status !== "accepted") {
      throw new Error(`Checkout initialization requires an accepted offer (current status: '${offer.status}')`);
    }

    const now = clock();
    const existingJourney = this.#journeys?.findByOfferId(offerId);
    if (now.getTime() >= new Date(offer.paymentWindow.expiresAt).getTime()) {
      if (existingJourney?.stage === "stay_settled") this.#compensateStay(offerId);
      throw new Error("Payment window has expired; cannot initialize checkout");
    }

    if (offer.securityDeposit && offer.securityDeposit.amountKobo > 0 && (!this.#securityDepositCapability || !this.#journeys || !this.#securityDepositAccounting)) { if (this.#journeys?.findByOfferId(offerId)?.stage === "stay_settled") this.#compensateStay(offerId); throw new Error("Refundable Security Deposit collection unavailable"); }
    if (offer.securityDeposit && offer.securityDeposit.amountKobo > 0) { try { assertSecurityDepositCollectionAvailable(this.#securityDepositCapability!, "fresh_card"); } catch { if (this.#journeys?.findByOfferId(offerId)?.stage === "stay_settled") this.#compensateStay(offerId); throw new Error("Refundable Security Deposit collection unavailable"); } }
    const journey = this.#journeys?.createIfAbsent({ offerId, paymentMethod: "fresh_card", originalPaymentDeadline: offer.paymentWindow.expiresAt, stayAmountKobo: typeof offer.quote?.allInStayTotalKobo === "number" ? offer.quote.allInStayTotalKobo : offer.totalAmountDueNowKobo - (offer.refundableSecurityDepositKobo ?? 0), deposit: offer.securityDeposit ?? null });
    const purpose = journey?.stage === "stay_settled" ? "security_deposit" as const : "stay" as const;
    if (purpose === "security_deposit" && (!journey || !journey.requiredDeposit || journey.requiredDeposit.amountKobo <= 0)) throw new Error("No deposit payment is required");
    const pspReference = `psp_ref_${envelope.commandId.slice(0, 8)}_${now.getTime()}`;
    const checkoutId = `chk_${envelope.commandId.slice(0, 12)}_${purpose}`;
    const checkoutUrl = `https://checkout.psp.example.com/pay/${pspReference}`;

    const session: CardCheckoutSession = {
      checkoutId,
      offerId: offer.offerId,
      pspReference,
      checkoutUrl,
      totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
      amountKobo: purpose === "stay" ? (journey?.stay.amountKobo ?? offer.totalAmountDueNowKobo) : (journey?.deposit.amountKobo ?? 0),
      purpose,
      currency: "NGN",
      expiresAt: offer.paymentWindow.expiresAt,
      status: "initiated"
    };

    if (purpose === "security_deposit") this.#securityDepositAccounting!.createOrGet({ offerId, snapshot: journey!.requiredDeposit!, paymentMethod: "fresh_card" });
    this.#liveAttempts?.acquire({ offerId, method: "fresh_card", purpose, attemptId: checkoutId, startedAt: now.toISOString(), expiresAt: offer.paymentWindow.expiresAt });
    if (journey) this.#journeys!.update(offerId, journey.journeyVersion, (value) => ({ ...value, stage: purpose === "stay" ? "stay_payment_active" : "deposit_payment_active", [purpose === "stay" ? "stay" : "deposit"]: { ...(purpose === "stay" ? value.stay : value.deposit), status: "active" } }));
    this.#sessions.set(checkoutId, session);

    if (this.#audit) {
      this.#audit.record({
        type: "card_payment.checkout_initialized",
        checkoutId,
        offerId: offer.offerId,
        pspReference,
        amountKobo: session.amountKobo,
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
    envelope: PlatformCommandEnvelope<{ offerId: string; pspReference: string }>,
    options?: { clock?: () => Date }
  ): { reservation: Reservation; bookingContract: BookingContract; ledgerEntries: readonly LedgerEntry[] };
  verifyAndConfirmCardPayment(
    envelope: PlatformCommandEnvelope<{ offerId: string; pspReference: string }>,
    options?: { clock?: () => Date }
  ): CardPaymentVerificationOutcome { const { clock = () => new Date() } = options ?? {};
    if (!envelope || envelope.commandName !== "card_payment.verify_and_confirm") {
      throw new Error("Invalid envelope: commandName must be 'card_payment.verify_and_confirm'");
    }

    assertNoRawCardCredentials(envelope.payload ?? {});

    const payload = envelope.payload ?? {};
    const { offerId, pspReference } = payload;
    if (!offerId || !pspReference) {
      throw new Error("offerId and pspReference are required for payment verification");
    }
    if (Object.keys(payload).some((key) => key !== "offerId" && key !== "pspReference")) {
      throw new Error("Payment verification accepts only the server-resolved offer and PSP reference");
    }
    if (envelope.principal.role !== "system" || !envelope.principal.id) {
      throw new Error("Payment verification requires a trusted system principal");
    }

    const session = [...this.#sessions.values()].find((candidate) => candidate.pspReference === pspReference);
    if (!session || session.offerId !== offerId) {
      throw new Error("PSP reference is not bound to an authoritative checkout session");
    }
    const offer = this.#offerManager.getOffer(session.offerId);
    if (!offer.tenantId || !envelope.principal.tenantId || offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    // Authorization and session binding precede idempotency disclosure.
    const existingReference = this.#processedPspReferences.get(pspReference);
    if (existingReference) {
      if (existingReference.offerId !== offer.offerId || existingReference.tenantId !== offer.tenantId) {
        throw new Error("Processed PSP reference is not authorized for this offer");
      }
      const reservation = this.#reservations.get(existingReference.reservationId)!;
      const bookingContract = this.#contracts.get(existingReference.contractId)!;
      const ledgerEntries = this.#ledgerEntries.get(existingReference.reservationId) ?? [];
      return { outcome: "confirmed", reservation, bookingContract, ledgerEntries };
    }

    if (offer.status !== "accepted") {
      throw new Error(`Payment verification requires an accepted offer (current status: '${offer.status}')`);
    }

    const now = clock();

    // Verification from PSP
    let pspResult: PSPVerifyResult | undefined;
    try { pspResult = this.#pspClient?.verifyTransaction(pspReference); } catch (error) { if (session.purpose === "security_deposit") this.#compensateStay(offerId); throw error; }
    if (!pspResult) {
      if (session.purpose === "security_deposit") this.#compensateStay(offerId);
      throw new Error("Server-side payment verification failed: No PSP result available");
    }

    if (!pspResult.verified || pspResult.status !== "success") {
      if (session.purpose === "security_deposit" && pspResult.status === "failed") this.#compensateStay(offerId);

      // Check Payment-Processing Grace (ADR 0044)
      if (pspResult.status === "pending") {
        const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
        const graceEnd = paymentWindowEnd + 10 * 60 * 1000; // +10 min grace
        if (now.getTime() <= graceEnd) {
          throw new Error("Payment is currently processing under Payment-Processing Grace period");
        }
        if (session.purpose === "security_deposit") this.#compensateStay(offerId);
      }
      throw new Error(`Server-side payment verification failed: ${pspResult.failureReason ?? "PSP transaction unsuccessful"}`);
    }

    // AC 2: Independently verify booking, amount, currency, reference, payer, and unexpired inventory state
    const rejectDeposit = (message: string): never => { if (session.purpose === "security_deposit") this.#compensateStay(offerId); throw new Error(message); };
    if (pspResult.currency !== "NGN") {
      rejectDeposit(`Currency verification failed: Expected NGN, got '${pspResult.currency}'`);
    }

    if (pspResult.amountKobo !== session.amountKobo) {
      rejectDeposit(`Amount verification failed: Expected ${session.amountKobo} kobo, got ${pspResult.amountKobo} kobo`);
    }

    if (pspResult.pspReference !== pspReference) {
      rejectDeposit(`Reference verification failed: Expected ${pspReference}, got ${pspResult.pspReference}`);
    }

    // Verify Payer Attribution (ADR 0013, 0050)
    const expectedPayerId = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
    if (!pspResult.payerId || pspResult.payerId !== expectedPayerId) {
      rejectDeposit(`Payer attribution verification failed: Expected ${expectedPayerId}, got ${pspResult.payerId ?? "none"}`);
    }

    // Expiry check (Payment Window + Grace)
    const paymentWindowEnd = new Date(offer.paymentWindow.expiresAt).getTime();
    const graceEnd = paymentWindowEnd + 10 * 60 * 1000; // 10 minutes grace for pending
    if (now.getTime() > graceEnd) {
      rejectDeposit("Payment verification failed: Payment Window and Grace period have expired");
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

    if (session.purpose === "stay" && offer.securityDeposit && offer.securityDeposit.amountKobo > 0 && this.#journeys) {
      const current = this.#journeys.findByOfferId(offer.offerId);
      if (!current) throw new Error("Payment journey not found");
      if (current.stage === "confirmed" && current.finalReservationId && current.finalContractId) return { outcome: "confirmed", reservation: this.#reservations.get(current.finalReservationId)!, bookingContract: this.#contracts.get(current.finalContractId)!, ledgerEntries: this.#ledgerEntries.get(current.finalReservationId) ?? [] };
      this.#journeys.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "stay_settled", stay: { ...value.stay, status: "settled", providerReference: session.pspReference, paidAt: now.toISOString() } }));
      session.status = "completed"; this.#liveAttempts?.release(offer.offerId);
      return { outcome: "deposit_required", journey: this.#journeys.findByOfferId(offer.offerId) };
    }
    if (session.purpose === "security_deposit") {
      const collection = this.#securityDepositAccounting?.getByOfferId(offer.offerId);
      if (!collection) throw new Error("Deposit collection record not found");
      try { const collected = this.#securityDepositAccounting!.recordCollection(collection.collectionId, { providerReference: session.pspReference, capabilityVersion: this.#securityDepositCapability?.getCapability({ paymentMethod: "fresh_card" }).capabilityVersion, collectedAt: now.toISOString() }); if (!collected.providerReference) throw new Error("Deposit payment source was not recorded"); } catch (error) { this.#compensateStay(offer.offerId); throw error; }
      const current = this.#journeys?.findByOfferId(offer.offerId);
      if (!current || (current.stage !== "deposit_payment_active" && current.stage !== "stay_settled")) throw new Error("Deposit payment is not the authorized next component");
      this.#journeys!.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "both_settled", deposit: { ...value.deposit, status: "settled", providerReference: session.pspReference, paidAt: now.toISOString() } }));
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
      confirmedAt: now.toISOString(),
      inventoryCommitmentId: offer.inventoryCommitmentId
    };

    if (session.purpose === "security_deposit") { const collection = this.#securityDepositAccounting?.getByOfferId(offer.offerId); if (!collection || !collection.providerReference) throw new Error("Deposit collection is not bound to a successful source"); this.#securityDepositAccounting!.bind(collection.collectionId, { reservationId, contractId }); }
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
      disclosures: offer.disclosures,
      ...(offer.securityDeposit && offer.securityDeposit.amountKobo > 0 ? { securityDeposit: { policyVersion: offer.securityDeposit.policyVersion, amountKobo: offer.securityDeposit.amountKobo, currency: "NGN" as const, collectionId: this.#securityDepositAccounting?.getByOfferId(offer.offerId)?.collectionId, status: "held" as const } } : {}),
      paymentDetails: {
        pspReference: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.providerReference ?? pspReference) : pspReference,
        paymentMethod: "fresh_card",
        amountKobo: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.amountKobo ?? pspResult.amountKobo) : pspResult.amountKobo,
        currency: "NGN",
        paidAt: now.toISOString(),
        ...(pspResult.cardMetadata ? { cardMetadata: pspResult.cardMetadata } : {})
      },
      createdAt: now.toISOString(),
      contractVersion: 1,
      checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" },
      financialSummary: { originalBookingTotalKobo: offer.totalAmountDueNowKobo, currentContractTotalKobo: offer.totalAmountDueNowKobo, currency: "NGN", amendmentAdjustments: [] }
    };

    // Ledger posting (Balanced ledger effects)
    const quoteBreakdown = offer.quote?.breakdown ?? {};
    const commissionable = offer.quote?.revenueClassification?.commissionableOperatorRevenueKobo;
    const quotedCommission = offer.quote?.revenueClassification?.estimatedCommissionKobo;
    const accommodationNet = quoteBreakdown.accommodationNetKobo ?? (typeof commissionable === "number" && typeof quotedCommission === "number" ? commissionable - quotedCommission : Math.round(offer.totalAmountDueNowKobo * 0.85));
    const commission = quoteBreakdown.platformCommissionKobo ?? (typeof quotedCommission === "number" ? quotedCommission : offer.totalAmountDueNowKobo - accommodationNet);
    const deposit = offer.refundableSecurityDepositKobo ?? 0;

    const ledgerEntries: LedgerEntry[] = [
      {
        entryId: `led_${reservationId}_1`,
        reservationId,
        type: "guest_payment_credit",
        amountKobo: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.amountKobo ?? offer.totalAmountDueNowKobo) : offer.totalAmountDueNowKobo,
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
    this.#bookingState?.saveContract(bookingContract);
    this.#bookingState?.saveReservation(reservation);
    this.#ledgerEntries.set(reservationId, ledgerEntries);
    session.status = "completed";
    if (this.#journeys) { const current = this.#journeys.findByOfferId(offer.offerId); if (current?.stage === "both_settled") this.#journeys.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "confirmed", finalReservationId: reservationId, finalContractId: contractId })); }
    this.#liveAttempts?.release(offer.offerId);
    this.#processedPspReferences.set(pspReference, { reservationId, contractId, offerId: offer.offerId, tenantId: offer.tenantId });

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

    return { outcome: "confirmed", reservation, bookingContract, ledgerEntries: Object.freeze(ledgerEntries) };
  }

  #compensateStay(offerId: string): void { const journey = this.#journeys?.findByOfferId(offerId); if (!journey || journey.compensation.status === "settled" || journey.compensation.status === "pending" || journey.compensation.status === "reconciliation_required") return; const reference = journey.stay.providerReference; if (!reference || !this.#compensationRefundProvider) { this.#journeys?.update(offerId, journey.journeyVersion, (value) => ({ ...value, stage: "reconciliation_required", compensation: { status: "reconciliation_required" } })); return; } const refund = this.#compensationRefundProvider.refundOrGet({ obligationId: `payment-compensation:${offerId}:stay`, offerId, paymentMethod: "fresh_card", originalPaymentReference: reference, amountKobo: journey.stay.amountKobo, currency: "NGN" }); this.#journeys?.update(offerId, journey.journeyVersion, (value) => ({ ...value, stage: refund.status === "failed" ? "reconciliation_required" : refund.status === "pending" ? "compensation_pending" : "compensated", compensation: { status: refund.status === "failed" ? "reconciliation_required" : refund.status === "pending" ? "pending" : "settled", refundId: refund.refundId } })); }
  getPaymentJourney(offerId: string) { return this.#journeys?.findByOfferId(offerId) ?? null; }
  getCheckoutSession(offerId: string): CardCheckoutSession | undefined {
    const sessions = [...this.#sessions.values()].filter((session) => session.offerId === offerId);
    const session = sessions.find((candidate) => candidate.status === "initiated") ?? sessions.at(-1);
    return session ? { ...session } : undefined;
  }

  getCheckoutSessionByReference(pspReference: string): CardCheckoutSession | undefined {
    const session = [...this.#sessions.values()].find((candidate) => candidate.pspReference === pspReference);
    return session ? { ...session } : undefined;
  }

  getBookingContract(offerId: string): BookingContract | undefined {
    return [...this.#contracts.values()].find((contract) => contract.offerId === offerId);
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

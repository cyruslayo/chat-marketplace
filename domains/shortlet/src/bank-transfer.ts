import { createHash } from "node:crypto";
import type { PlatformCommandEnvelope, CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { ConditionalBookingOffer } from "./conditional-offer.js";
import type { BookingContract, LedgerEntry, Reservation } from "./card-payment.js";
import type { BookingStateRepository } from "./booking-state.js";
import type { BookingPaymentJourneyRepository, BookingPaymentCompensationPort } from "./booking-payment-journey.js";
import { assertSecurityDepositCollectionAvailable, type SecurityDepositCollectionCapabilityProvider } from "./security-deposit.js";
import type { SecurityDepositAccountingRepository } from "./security-deposit-accounting.js";

export interface BankTransferCheckoutSession {
  readonly checkoutId: string;
  readonly offerId: string;
  readonly transferReference: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly totalAmountDueNowKobo: number;
  readonly amountKobo: number;
  readonly purpose: "stay" | "security_deposit";
  readonly currency: "NGN";
  readonly expiresAt: string;
  readonly graceEndsAt: string;
  status: "initiated" | "processing_in_grace" | "completed" | "expired" | "refunded";
  readonly processingStartedAt?: string;
}

export interface BankTransferProviderResult {
  readonly verified: boolean;
  readonly status: "success" | "pending" | "failed";
  readonly amountKobo: number;
  readonly currency: string;
  readonly pspReference: string;
  readonly payerId?: string;
  /** Provider evidence that the designated transaction was in flight before the deadline. */
  readonly processingStartedAt?: string;
  readonly failureReason?: string;
}

/** Retained as a test-fixture compatibility name; production commands cannot carry it. */
export type MockBankTransferVerifyResult = BankTransferProviderResult;

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

export interface BankTransferProviderClient {
  verifyTransfer(transferReference: string): BankTransferProviderResult;
}

export interface BankTransferPaymentManagerOptions {
  readonly offerManager: { getOffer(offerId: string): ConditionalBookingOffer };
  readonly calendar?: {
    transitionPaymentPendingToConfirmedBooking(input: { commitmentId: string; unitId: string; start: string; end: string; clock: () => Date }): unknown;
    releasePaymentPending?(commitmentId: string, options?: { clock?: () => Date }): void;
    extendPaymentPending?(commitmentId: string, expiresAt: string, options?: { clock?: () => Date }): void;
  };
  readonly audit?: { record(entry: Record<string, unknown>): void };
  readonly providerClient: BankTransferProviderClient;
  readonly liveAttempts?: import("./payment-attempt.js").LivePaymentAttemptRegistry;
  readonly bookingState?: BookingStateRepository;
  readonly journeyRepository?: BookingPaymentJourneyRepository;
  readonly securityDepositCapability?: SecurityDepositCollectionCapabilityProvider;
  readonly securityDepositAccounting?: SecurityDepositAccountingRepository;
  readonly compensationRefundProvider?: BookingPaymentCompensationPort;
}

type Outcome = "confirmed" | "deposit_required" | "processing_in_grace" | "late_payment_refunded" | "failed" | "expired";
type Processed = { offerId: string; tenantId?: string; outcome: Outcome; reservationId?: string; contractId?: string; refundId?: string; reconciliationId?: string };

const GRACE_MS = 10 * 60 * 1000; // ADR-0044: one ten-minute grace after the twenty-minute Payment Window.
function deterministicSuffix(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 12); }
function authorizedPayer(offer: ConditionalBookingOffer): string { return offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id; }
function assertServer(principal: CommandPrincipal, offer: ConditionalBookingOffer): void {
  if (principal.role !== "system" || !principal.id || !offer.tenantId || !principal.tenantId || principal.tenantId !== offer.tenantId) throw new Error("Trusted system principal with matching tenant is required");
}

export class BankTransferPaymentManager {
  readonly #offerManager: BankTransferPaymentManagerOptions["offerManager"];
  readonly #calendar?: BankTransferPaymentManagerOptions["calendar"];
  readonly #audit?: BankTransferPaymentManagerOptions["audit"];
  readonly #providerClient: BankTransferProviderClient;
  readonly #liveAttempts?: BankTransferPaymentManagerOptions["liveAttempts"];
  readonly #bookingState?: BookingStateRepository;
  readonly #journeys?: BookingPaymentJourneyRepository;
  readonly #securityDepositCapability?: SecurityDepositCollectionCapabilityProvider;
  readonly #securityDepositAccounting?: SecurityDepositAccountingRepository;
  readonly #compensationRefundProvider?: BankTransferPaymentManagerOptions["compensationRefundProvider"];
  readonly #sessionsByOffer = new Map<string, BankTransferCheckoutSession>();
  readonly #sessionsByReference = new Map<string, BankTransferCheckoutSession>();
  readonly #reservations = new Map<string, Reservation>();
  readonly #contracts = new Map<string, BookingContract>();
  readonly #ledgerEntries = new Map<string, LedgerEntry[]>();
  readonly #refundRecords = new Map<string, BankTransferRefundRecord>();
  readonly #reconciliationRecords = new Map<string, BankTransferReconciliationRecord>();
  readonly #processedReferences = new Map<string, Processed>();

  constructor(options: BankTransferPaymentManagerOptions) {
    if (!options.offerManager || !options.providerClient) throw new Error("offerManager and providerClient are required for BankTransferPaymentManager");
    this.#offerManager = options.offerManager; this.#calendar = options.calendar; this.#audit = options.audit; this.#providerClient = options.providerClient; this.#liveAttempts = options.liveAttempts; this.#bookingState = options.bookingState; this.#journeys = options.journeyRepository; this.#securityDepositCapability = options.securityDepositCapability; this.#securityDepositAccounting = options.securityDepositAccounting; this.#compensationRefundProvider = options.compensationRefundProvider;
  }

  initializeBankTransfer(envelope: PlatformCommandEnvelope<{ offerId: string }>, { clock = () => new Date() }: { clock?: () => Date } = {}): BankTransferCheckoutSession {
    if (!envelope || envelope.commandName !== "bank_transfer.initialize") throw new Error("Invalid bank transfer initialization command");
    if (Object.keys(envelope.payload ?? {}).length !== 1 || !envelope.payload.offerId) throw new Error("Initialization accepts only offerId");
    const offer = this.#offerManager.getOffer(envelope.payload.offerId);
    if (envelope.principal.role !== "guest" || !envelope.principal.id || envelope.principal.id !== authorizedPayer(offer)) throw new Error("Only the authoritative payer can initialize bank transfer");
    if (!offer.tenantId || !envelope.principal.tenantId || envelope.principal.tenantId !== offer.tenantId) throw new Error("Cross-tenant offer access denied");
    if (offer.status !== "accepted") throw new Error("Bank transfer initialization requires an accepted offer");
    const now = clock(); const deadline = new Date(offer.paymentWindow.expiresAt).getTime(); const existingJourney = this.#journeys?.findByOfferId(offer.offerId);
    if (now.getTime() >= deadline) { if (existingJourney?.stage === "stay_settled") this.#compensateStay(offer.offerId); throw new Error("Payment window has expired; cannot initialize bank transfer"); }
    const existing = this.#sessionsByOffer.get(offer.offerId);
    if (existing && (existing.status === "initiated" || existing.status === "processing_in_grace")) return { ...existing };
    if (offer.securityDeposit && offer.securityDeposit.amountKobo > 0 && (!this.#securityDepositCapability || !this.#journeys || !this.#securityDepositAccounting)) throw new Error("Refundable Security Deposit collection unavailable");
    if (offer.securityDeposit && offer.securityDeposit.amountKobo > 0) assertSecurityDepositCollectionAvailable(this.#securityDepositCapability!, "bank_transfer");
    const journey = this.#journeys?.createIfAbsent({ offerId: offer.offerId, paymentMethod: "bank_transfer", originalPaymentDeadline: offer.paymentWindow.expiresAt, stayAmountKobo: typeof offer.quote?.allInStayTotalKobo === "number" ? offer.quote.allInStayTotalKobo : offer.totalAmountDueNowKobo - (offer.refundableSecurityDepositKobo ?? 0), deposit: offer.securityDeposit ?? null });
    const purpose = journey?.stage === "stay_settled" ? "security_deposit" as const : "stay" as const;
    const transferReference = `exp_trf_${deterministicSuffix(`${offer.offerId}:${envelope.commandId}:${purpose}`)}`;
    const session: BankTransferCheckoutSession = {
      checkoutId: `chk_trf_${deterministicSuffix(transferReference)}`, offerId: offer.offerId, transferReference,
      bankName: "Concierge Reserve Bank (GTBank)", accountNumber: `012${deterministicSuffix(offer.tenantId).slice(0, 7)}`,
      totalAmountDueNowKobo: offer.totalAmountDueNowKobo, amountKobo: purpose === "stay" ? (journey?.stay.amountKobo ?? offer.totalAmountDueNowKobo) : (journey?.deposit.amountKobo ?? 0), purpose, currency: "NGN", expiresAt: offer.paymentWindow.expiresAt,
      graceEndsAt: new Date(deadline + GRACE_MS).toISOString(), status: "initiated"
    };
    if (purpose === "security_deposit") this.#securityDepositAccounting!.createOrGet({ offerId: offer.offerId, snapshot: journey!.requiredDeposit!, paymentMethod: "bank_transfer" });
    this.#liveAttempts?.acquire({ offerId: offer.offerId, method: "bank_transfer", purpose, attemptId: session.checkoutId, startedAt: now.toISOString(), expiresAt: session.graceEndsAt }); if (journey) this.#journeys!.update(offer.offerId, journey.journeyVersion, (value) => ({ ...value, stage: purpose === "stay" ? "stay_payment_active" : "deposit_payment_active", [purpose === "stay" ? "stay" : "deposit"]: { ...(purpose === "stay" ? value.stay : value.deposit), status: "active" } })); this.#sessionsByOffer.set(offer.offerId, session); this.#sessionsByReference.set(transferReference, session);
    this.#audit?.record({ type: "bank_transfer.initialized", checkoutId: session.checkoutId, offerId: offer.offerId, commandEnvelopeId: envelope.commandId, initiatedAt: now.toISOString() });
    return { ...session };
  }

  getPaymentJourney(offerId: string) { return this.#journeys?.findByOfferId(offerId) ?? null; }
  getSession(offerId: string): BankTransferCheckoutSession | undefined { const s = this.#sessionsByOffer.get(offerId); return s ? { ...s } : undefined; }
  getSessionByReference(reference: string): BankTransferCheckoutSession | undefined { const s = this.#sessionsByReference.get(reference); return s ? { ...s } : undefined; }
  getBookingContract(offerId: string): BookingContract | undefined { return [...this.#contracts.values()].find((c) => c.offerId === offerId); }
  getRefundRecord(offerId: string): BankTransferRefundRecord | undefined { return [...this.#refundRecords.values()].find((r) => r.offerId === offerId); }
  getReconciliationRecord(offerId: string): BankTransferReconciliationRecord | undefined { return [...this.#reconciliationRecords.values()].find((r) => r.offerId === offerId); }

  #validateProvider(session: BankTransferCheckoutSession, offer: ConditionalBookingOffer, result: BankTransferProviderResult): void {
    if (!result || result.verified !== true || result.pspReference !== session.transferReference) throw new Error("Bank transfer provider verification failed: reference");
    if (result.currency !== session.currency) throw new Error("Currency verification failed");
    if (result.amountKobo !== session.amountKobo) throw new Error("Amount verification failed");
    if (!result.payerId || result.payerId !== authorizedPayer(offer)) throw new Error("Payer attribution verification failed");
    if (result.status === "pending") {
      if (!result.processingStartedAt || new Date(result.processingStartedAt).getTime() > new Date(offer.paymentWindow.expiresAt).getTime()) throw new Error("Payment is not eligible for processing grace");
    }
  }

  resolveExpiry(offerId: string, principal: CommandPrincipal, { clock = () => new Date() }: { clock?: () => Date } = {}): BankTransferCheckoutSession {
    const offer = this.#offerManager.getOffer(offerId); assertServer(principal, offer); const session = this.#sessionsByOffer.get(offerId);
    if (!session) throw new Error("No bank transfer session");
    const now = clock(); if (now.getTime() < new Date(session.graceEndsAt).getTime()) throw new Error("Payment release deadline has not been reached");
    if (session.status === "expired" || session.status === "refunded") return { ...session };
    this.#calendar?.releasePaymentPending?.(offer.inventoryCommitmentId, { clock: () => now });
    if (session.purpose === "security_deposit") this.#compensateStay(offerId);
    const expired = { ...session, status: "expired" as const }; this.#liveAttempts?.release(offerId); this.#sessionsByOffer.set(offerId, expired); this.#sessionsByReference.set(session.transferReference, expired);
    this.#audit?.record({ type: "bank_transfer.expired", offerId, checkoutId: session.checkoutId, commandEnvelopeId: principal.id, expiredAt: now.toISOString() });
    return { ...expired };
  }

  verifyAndProcessTransfer(envelope: PlatformCommandEnvelope<{ transferReference: string }>, { clock = () => new Date() }: { clock?: () => Date } = {}): { outcome: Outcome; reservation?: Reservation; bookingContract?: BookingContract; ledgerEntries?: readonly LedgerEntry[]; refundRecord?: BankTransferRefundRecord; reconciliationRecord?: BankTransferReconciliationRecord } {
    if (!envelope || envelope.commandName !== "bank_transfer.verify_and_process") throw new Error("Invalid bank transfer verification command");
    if (Object.keys(envelope.payload ?? {}).length !== 1 || !envelope.payload.transferReference) throw new Error("Verification accepts only transferReference");
    const session = this.#sessionsByReference.get(envelope.payload.transferReference); if (!session) throw new Error("Unknown transfer reference");
    const offer = this.#offerManager.getOffer(session.offerId); assertServer(envelope.principal, offer);
    const processed = this.#processedReferences.get(session.transferReference);
    if (processed) {
      if (processed.tenantId !== offer.tenantId || processed.offerId !== offer.offerId) throw new Error("Processed bank transfer reference is not authorized");
      if (processed.outcome === "confirmed" && processed.reservationId && processed.contractId) return { outcome: "confirmed", reservation: this.#reservations.get(processed.reservationId), bookingContract: this.#contracts.get(processed.contractId), ledgerEntries: this.#ledgerEntries.get(processed.reservationId) };
      if (processed.outcome === "late_payment_refunded" && processed.refundId && processed.reconciliationId) return { outcome: "late_payment_refunded", refundRecord: this.#refundRecords.get(processed.refundId), reconciliationRecord: this.#reconciliationRecords.get(processed.reconciliationId) };
    }
    let result: BankTransferProviderResult;
    try { result = this.#providerClient.verifyTransfer(session.transferReference); this.#validateProvider(session, offer, result); } catch (error) { if (session.purpose === "security_deposit") this.#compensateStay(offer.offerId); throw error; }
    const now = clock(); const deadline = new Date(session.expiresAt).getTime(); const graceEnd = new Date(session.graceEndsAt).getTime();
    if (result.status === "pending") {
      if (now.getTime() >= graceEnd) { this.resolveExpiry(offer.offerId, envelope.principal, { clock }); return { outcome: "expired" }; }
      const updated = { ...session, status: "processing_in_grace" as const, processingStartedAt: result.processingStartedAt };
      if (now.getTime() >= deadline) this.#calendar?.extendPaymentPending?.(offer.inventoryCommitmentId, session.graceEndsAt, { clock: () => now });
      this.#sessionsByOffer.set(offer.offerId, updated); this.#sessionsByReference.set(session.transferReference, updated); return { outcome: "processing_in_grace" };
    }
    const eligibleSuccess = result.status === "success" && (now.getTime() < deadline || (session.processingStartedAt !== undefined && now.getTime() < graceEnd));
    if (result.status === "success" && !eligibleSuccess) return this.#lateRefund(offer, session, result, envelope, now);
    if (result.status !== "success" || now.getTime() >= graceEnd) { if (session.purpose === "security_deposit") this.#compensateStay(offer.offerId); return { outcome: "failed" }; }
    if (session.purpose === "stay" && offer.securityDeposit && offer.securityDeposit.amountKobo > 0 && this.#journeys) {
      const current = this.#journeys.findByOfferId(offer.offerId); if (!current) throw new Error("Payment journey not found"); if (current.stage === "confirmed" && current.finalReservationId && current.finalContractId) return { outcome: "confirmed", reservation: this.#reservations.get(current.finalReservationId), bookingContract: this.#contracts.get(current.finalContractId), ledgerEntries: this.#ledgerEntries.get(current.finalReservationId) };
      this.#journeys.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "stay_settled", stay: { ...value.stay, status: "settled", providerReference: session.transferReference, paidAt: now.toISOString() } }));
      this.#sessionsByOffer.set(offer.offerId, { ...session, status: "completed" }); this.#liveAttempts?.release(offer.offerId); return { outcome: "deposit_required" };
    }
    if (session.purpose === "security_deposit") {
      const collection = this.#securityDepositAccounting?.getByOfferId(offer.offerId); if (!collection) throw new Error("Deposit collection record not found");
      try { const collected = this.#securityDepositAccounting!.recordCollection(collection.collectionId, { providerReference: session.transferReference, capabilityVersion: this.#securityDepositCapability?.getCapability({ paymentMethod: "bank_transfer" }).capabilityVersion, collectedAt: now.toISOString() }); if (!collected.providerReference) throw new Error("Deposit payment source was not recorded"); } catch (error) { this.#compensateStay(offer.offerId); throw error; }
      const current = this.#journeys?.findByOfferId(offer.offerId); if (!current || (current.stage !== "deposit_payment_active" && current.stage !== "stay_settled")) throw new Error("Deposit payment is not the authorized next component");
      this.#journeys!.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "both_settled", deposit: { ...value.deposit, status: "settled", providerReference: session.transferReference, paidAt: now.toISOString() } }));
    }
    if (!this.#calendar) throw new Error("Authoritative availability calendar is required to confirm a Booking");
    this.#calendar.transitionPaymentPendingToConfirmedBooking({ commitmentId: offer.inventoryCommitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => now });
    const reservationId = `res_trf_${deterministicSuffix(session.transferReference)}`; const contractId = `ctr_trf_${deterministicSuffix(session.transferReference)}`;
    const reservation: Reservation = { reservationId, contractId, unitId: offer.unitId, primaryGuestId: offer.parties.primaryGuest.id, dates: { checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut }, status: "confirmed", confirmedAt: now.toISOString(), inventoryCommitmentId: offer.inventoryCommitmentId };
    if (session.purpose === "security_deposit") { const collection = this.#securityDepositAccounting?.getByOfferId(offer.offerId); if (!collection || !collection.providerReference) throw new Error("Deposit collection is not bound to a successful source"); this.#securityDepositAccounting!.bind(collection.collectionId, { reservationId, contractId }); }
    const bookingContract: BookingContract = { contractId, reservationId, offerId: offer.offerId, unitId: offer.unitId, tenantId: offer.tenantId, parties: offer.parties, dates: offer.dates, occupants: offer.occupants, quote: offer.quote, totalAmountDueNowKobo: offer.totalAmountDueNowKobo, ...(offer.securityDeposit ? { securityDeposit: { policyVersion: offer.securityDeposit.policyVersion, amountKobo: offer.securityDeposit.amountKobo, currency: "NGN" as const, collectionId: this.#securityDepositAccounting?.getByOfferId(offer.offerId)?.collectionId, status: "held" as const } } : {}), policies: offer.policies, disclosures: offer.disclosures, paymentDetails: { paymentMethod: "bank_transfer", transferReference: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.providerReference ?? session.transferReference) : session.transferReference, amountKobo: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.amountKobo ?? result.amountKobo) : result.amountKobo, currency: "NGN", paidAt: now.toISOString() }, createdAt: now.toISOString(), contractVersion: 1, checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" }, financialSummary: { originalBookingTotalKobo: offer.totalAmountDueNowKobo, currentContractTotalKobo: offer.totalAmountDueNowKobo, currency: "NGN", amendmentAdjustments: [] } };
    const ledgerEntries: LedgerEntry[] = [{ entryId: `led_${reservationId}_1`, reservationId, type: "guest_payment_credit", amountKobo: session.purpose === "security_deposit" ? (this.#journeys?.findByOfferId(offer.offerId)?.stay.amountKobo ?? offer.totalAmountDueNowKobo) : offer.totalAmountDueNowKobo, currency: "NGN", createdAt: now.toISOString() }];
    this.#reservations.set(reservationId, reservation); this.#contracts.set(contractId, bookingContract); this.#bookingState?.saveContract(bookingContract); this.#bookingState?.saveReservation(reservation); this.#ledgerEntries.set(reservationId, ledgerEntries); this.#sessionsByOffer.set(offer.offerId, { ...session, status: "completed" }); if (this.#journeys) { const current = this.#journeys.findByOfferId(offer.offerId); if (current?.stage === "both_settled") this.#journeys.update(offer.offerId, current.journeyVersion, (value) => ({ ...value, stage: "confirmed", finalReservationId: reservationId, finalContractId: contractId })); } this.#liveAttempts?.release(offer.offerId); this.#processedReferences.set(session.transferReference, { offerId: offer.offerId, tenantId: offer.tenantId, outcome: "confirmed", reservationId, contractId });
    return { outcome: "confirmed", reservation, bookingContract, ledgerEntries: Object.freeze(ledgerEntries) };
  }

  #compensateStay(offerId: string): void { const journey = this.#journeys?.findByOfferId(offerId); if (!journey || journey.compensation.status === "settled" || journey.compensation.status === "pending" || journey.compensation.status === "reconciliation_required") return; const reference = journey.stay.providerReference; if (!reference || !this.#compensationRefundProvider) { this.#journeys?.update(offerId, journey.journeyVersion, (value) => ({ ...value, stage: "reconciliation_required", compensation: { status: "reconciliation_required" } })); return; } const refund = this.#compensationRefundProvider.refundOrGet({ obligationId: `payment-compensation:${offerId}:stay`, offerId, paymentMethod: "bank_transfer", originalPaymentReference: reference, amountKobo: journey.stay.amountKobo, currency: "NGN" }); this.#journeys?.update(offerId, journey.journeyVersion, (value) => ({ ...value, stage: refund.status === "failed" ? "reconciliation_required" : refund.status === "pending" ? "compensation_pending" : "compensated", compensation: { status: refund.status === "failed" ? "reconciliation_required" : refund.status === "pending" ? "pending" : "settled", refundId: refund.refundId } })); }
  #lateRefund(offer: ConditionalBookingOffer, session: BankTransferCheckoutSession, result: BankTransferProviderResult, envelope: PlatformCommandEnvelope<{ transferReference: string }>, now: Date) {
    this.#calendar?.releasePaymentPending?.(offer.inventoryCommitmentId, { clock: () => now });
    const refundId = `ref_${deterministicSuffix(session.transferReference)}`; const reconciliationId = `rec_${deterministicSuffix(session.transferReference)}`;
    const refundRecord: BankTransferRefundRecord = { refundId, offerId: offer.offerId, transferReference: session.transferReference, amountKobo: result.amountKobo, currency: "NGN", reason: "late_payment_after_expiry", status: "initiated", createdAt: now.toISOString() };
    const reconciliationRecord: BankTransferReconciliationRecord = { reconciliationId, offerId: offer.offerId, transferReference: session.transferReference, amountKobo: result.amountKobo, status: "quarantined_for_refund", createdAt: now.toISOString() };
    this.#liveAttempts?.release(offer.offerId); if (session.purpose === "security_deposit") this.#compensateStay(offer.offerId); this.#refundRecords.set(refundId, refundRecord); this.#reconciliationRecords.set(reconciliationId, reconciliationRecord); this.#processedReferences.set(session.transferReference, { offerId: offer.offerId, tenantId: offer.tenantId, outcome: "late_payment_refunded", refundId, reconciliationId }); this.#sessionsByOffer.set(offer.offerId, { ...session, status: "refunded" });
    this.#audit?.record({ type: "bank_transfer.late_payment_refunded", offerId: offer.offerId, commandEnvelopeId: envelope.commandId, refundId, reconciliationId, timestamp: now.toISOString() });
    return { outcome: "late_payment_refunded" as const, refundRecord, reconciliationRecord };
  }
}

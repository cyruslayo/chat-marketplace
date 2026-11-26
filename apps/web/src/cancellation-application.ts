import { createPlatformCommandEnvelope, type CommandPrincipal, type PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import {
  CANCELLATION_CASES_SCHEMA,
  CancellationNoShowManager,
  InMemoryCancellationCaseRepository,
  SqliteCancellationCaseRepository,
  extensionStatusAt,
  type BookingContract,
  type BookingStateRepository,
  type CancellationArrivalStateProvider,
  type CancellationCase,
  type CancellationCaseRepository,
  type CancellationEconomicsProvider,
  type CancellationLiability,
  type CancellationLiabilityAuthority,
  type CancellationOutcome,
  type ContractualCheckInWindowProvider,
  type NoShowContactAttemptProvider,
  type OwnerPayableLedger,
  type Reservation,
  validateCancellationPolicy,
} from "../../../domains/shortlet/src/index.js";
import { cancellationArtifactId, cancellationProjectionVersion, type CancellationArtifact } from "./cancellation-artifact.js";
import type { CancellationActionContext } from "./cancellation-actions.js";

export {
  CANCELLATION_CASES_SCHEMA,
  InMemoryCancellationCaseRepository,
  SqliteCancellationCaseRepository,
  type CancellationCase,
  type CancellationCaseRepository,
  type CancellationOutcome,
};

export interface RefundProvider {
  initiateOrGetRefund(input: {
    cancellationId: string;
    reservationId: string;
    paymentMethod: "fresh_card" | "bank_transfer";
    originalPaymentReference: string;
    amountKobo: number;
    currency: "NGN";
  }): { refundId: string; status: "pending" | "settled" | "failed"; amountKobo: number; currency: "NGN" };
}
export interface SecurityDepositCancellationRefundPort {
  initiateOrGetRefund(input: {
    cancellationId: string;
    reservationId: string;
    collectionId: string;
    amountKobo: number;
    currency: "NGN";
  }): { refundId: string; status: "pending" | "settled" | "failed" | "reconciliation_required"; amountKobo: number; currency: string };
}
interface LedgerPort {
  postCancellation(input: {
    cancellationId: string;
    reservationId: string;
    liability: string;
    amountKobo: number;
    retainedCancellationBaseKobo: number;
    retainedCommissionKobo: number;
    currency: "NGN";
  }): { ledgerRecordId: string; status: "posted" };
}
interface ReleasePort {
  releaseConfirmedBooking(input: { commitmentId: string; unitId: string; start: string; end: string }): void;
}
export interface CancellationAmendmentPort {
  hasSettlementInFlight(contractId: string): boolean;
  closeUnpaidAmendmentsForCancellation(contractId: string, clock?: () => Date): readonly unknown[];
}
export interface CancellationExtensionPort {
  closeWaitingExtensionForCancellation(contractId: string, actorId: string): unknown;
}

/**
 * Pilot refund port (D4, D28 P2, `docs/policy/shortlet-pilot-payments.md`): records a deterministic refund
 * obligation without calling Paystack's Refund API. Status is `"settled"` when 0 kobo is owed or staff have
 * already recorded full manual refunds in `OwnerPayableLedger`; otherwise `"pending"`.
 */
export function recordedCancellationRefundPort(ledger: Pick<OwnerPayableLedger, "listGuestRefunds">): RefundProvider {
  return {
    initiateOrGetRefund: ({ cancellationId, reservationId, amountKobo }) => {
      const refundedKobo = ledger.listGuestRefunds(reservationId).reduce((sum, item) => sum + item.amountKobo, 0);
      return {
        refundId: `cancellation-refund:${cancellationId}`,
        status: amountKobo === 0 || refundedKobo >= amountKobo ? "settled" : "pending",
        amountKobo,
        currency: "NGN",
      };
    },
  };
}

/**
 * Pilot security-deposit refund port (D4, ADR 0016): records a deterministic manual deposit refund obligation
 * separate from stay refunds, without calling the Paystack Refund API.
 */
export function recordedDepositRefundPort(): SecurityDepositCancellationRefundPort {
  return {
    initiateOrGetRefund: ({ cancellationId, amountKobo }) => ({
      refundId: `cancellation-deposit-refund:${cancellationId}`,
      status: amountKobo === 0 ? "settled" : "pending",
      amountKobo,
      currency: "NGN",
    }),
  };
}

export interface CancellationApplicationOptions { readonly manager: CancellationNoShowManager;
  readonly state: BookingStateRepository;
  readonly timing: ContractualCheckInWindowProvider;
  readonly economics: CancellationEconomicsProvider;
  readonly arrival: CancellationArrivalStateProvider;
  readonly liability?: CancellationLiabilityAuthority;
  readonly contacts?: NoShowContactAttemptProvider;
  readonly refunds: RefundProvider;
  readonly depositRefunds?: SecurityDepositCancellationRefundPort;
  readonly ledger: LedgerPort;
  readonly availability: ReleasePort;
  /** Required durable case store (Issue 05, D4, ADR 0095). */
  readonly cases: CancellationCaseRepository;
  readonly amendments?: CancellationAmendmentPort;
  readonly extensions?: CancellationExtensionPort;
  readonly audit?: { record(entry: Record<string, unknown>): void };
  readonly clock?: () => Date;
}

function guestAuthorized(contract: BookingContract, reservation: Reservation, principal: CommandPrincipal): void {
  if (
    principal.role !== "guest" ||
    !principal.id ||
    principal.id !== contract.parties.primaryGuest.id ||
    !contract.tenantId ||
    !principal.tenantId ||
    principal.tenantId !== contract.tenantId ||
    reservation.contractId !== contract.contractId
  ) {
    throw new Error("Access denied or resource not found");
  }
}

function staffAuthorized(contract: BookingContract, principal: CommandPrincipal): void {
  if (principal.role !== "authorized_staff" && principal.role !== "admin") {
    throw new Error("Authorized human staff is required");
  }
  if (!contract.tenantId || !principal.tenantId || principal.tenantId !== contract.tenantId) {
    throw new Error("Access denied or resource not found");
  }
}

function systemOrStaffAuthorized(contract: BookingContract, principal: CommandPrincipal): void {
  if (principal.role !== "authorized_staff" && principal.role !== "admin" && principal.role !== "system") {
    throw new Error("Authorized staff or system principal is required");
  }
  if (!principal.id || !contract.tenantId || !principal.tenantId || principal.tenantId !== contract.tenantId) {
    throw new Error("Access denied or resource not found");
  }
}

export class CancellationApplication {
  readonly #o: CancellationApplicationOptions;
  readonly #manager: CancellationNoShowManager;
  readonly #cases: CancellationCaseRepository;
  readonly #activeResumes = new Set<string>();

  constructor(options: CancellationApplicationOptions) {
    if (!options.cases) {
      throw new Error("cases repository is required for CancellationApplication");
    }
    this.#o = options;
    this.#manager = options.manager;
    this.#cases = options.cases;
  }

  #assertNoAmendmentSettlementInFlight(contractId: string): void {
    // D3: settlement in flight must finish first; refuse cancellation with reason rather than losing money.
    if (this.#o.amendments?.hasSettlementInFlight(contractId)) {
      throw new Error("Cancellation cannot proceed while a Booking Amendment settlement is in flight; settle the amendment first");
    }
  }

  #closePendingChangesForCancellation(contract: BookingContract, actorId: string): BookingContract {
    this.#o.amendments?.closeUnpaidAmendmentsForCancellation(contract.contractId, this.#o.clock);
    if (this.#o.extensions) {
      this.#o.extensions.closeWaitingExtensionForCancellation(contract.contractId, actorId);
      return this.#o.state.findContractById(contract.contractId) ?? contract;
    }
    const now = this.#o.clock?.() ?? new Date();
    if (contract.extensionRequest && extensionStatusAt(contract.extensionRequest, now) === "awaiting_operator") {
      return this.#o.state.mutateContract(contract.contractId, contract.contractVersion, (current) => ({
        ...current,
        contractVersion: current.contractVersion + 1,
        extensionRequest: {
          ...current.extensionRequest!,
          status: "cancelled",
          decidedAt: now.toISOString(),
          decidedBy: actorId,
        },
      }));
    }
    return contract;
  }

  #acquireResumeGuard(reservationId: string): (() => void) | null {
    const repoRelease = this.#cases.tryAcquireResumeGuard?.(reservationId);
    if (this.#cases.tryAcquireResumeGuard && repoRelease === null) {
      return null;
    }
    if (this.#activeResumes.has(reservationId)) {
      repoRelease?.();
      return null;
    }
    this.#activeResumes.add(reservationId);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#activeResumes.delete(reservationId);
        repoRelease?.();
      }
    };
  }

  #isCaseFinished(current: CancellationCase): boolean {
    return (
      current.ledgerStatus === "posted" &&
      current.inventoryReleaseStatus === "released" &&
      (current.refundStatus === "pending" || current.refundStatus === "settled") &&
      (current.depositRefundStatus === "not_applicable" ||
        current.depositRefundStatus === "pending" ||
        current.depositRefundStatus === "settled")
    );
  }

  /**
   * Authoritative stay and deposit refund split with conservation bounds (AC4, rules 01 S4 & S7, ADR 0016, 0058).
   * Security deposit is never merged into the stay refund, and refunds never exceed the collected amounts.
   */
  #authoritativeObligations(
    reservationId: string,
    contract: BookingContract,
    liability: CancellationLiability,
  ): {
    readonly policy: ReturnType<typeof validateCancellationPolicy>;
    readonly economics: ReturnType<CancellationEconomicsProvider["getEconomics"]>;
    readonly estimate: ReturnType<CancellationNoShowManager["calculateAuthoritative"]>;
    readonly stayRefundKobo: number;
    readonly depositRefundKobo: number;
  } {
    const economics = this.#o.economics.getEconomics({ reservationId, contract });
    const policy = validateCancellationPolicy(contract.policies.cancellationPolicy);
    const window = this.#o.timing.getWindow(reservationId, contract);
    const estimate = this.#manager.calculateAuthoritative({
      reservationId,
      contract,
      economics,
      policy,
      checkInWindowStartIso: window.startIso,
      at: this.#o.clock?.() ?? new Date(),
      liability,
    });
    const stayRefundKobo = estimate.totalRefundKobo - estimate.securityDepositRefundKobo;
    const collectedDepositKobo = contract.securityDeposit?.amountKobo ?? 0;
    const depositRefundKobo = contract.securityDeposit && contract.securityDeposit.amountKobo > 0 ? contract.securityDeposit.amountKobo : 0;
    if (stayRefundKobo < 0 || stayRefundKobo > contract.paymentDetails.amountKobo) {
      throw new Error("Cancellation stay refund exceeds total stay amount paid");
    }
    if (depositRefundKobo < 0 || depositRefundKobo > collectedDepositKobo) {
      throw new Error("Cancellation deposit refund exceeds security deposit collected");
    }
    if (stayRefundKobo + depositRefundKobo > contract.paymentDetails.amountKobo + collectedDepositKobo) {
      throw new Error("Total cancellation refunds exceed total amount paid");
    }
    return { policy, economics, estimate, stayRefundKobo, depositRefundKobo };
  }

  getArtifact(reservationId: string, principal: CommandPrincipal): CancellationArtifact {
    const reservation = this.#o.state.findReservationById(reservationId);
    const contract = reservation ? this.#o.state.findContractById(reservation.contractId) : null;
    if (!reservation || !contract) throw new Error("Access denied or resource not found");
    const isStaff = principal.role === "authorized_staff" || principal.role === "admin";
    if (isStaff) staffAuthorized(contract, principal);
    else guestAuthorized(contract, reservation, principal);

    // D4: retry unfinished ledger posting and date release on the next read without duplicating settled steps.
    const existing = this.#cases.findByReservationId(reservationId);
    if (
      reservation.status !== "confirmed" &&
      existing &&
      (existing.ledgerStatus !== "posted" || existing.inventoryReleaseStatus !== "released")
    ) {
      this.#resumeCase(reservationId, contract, reservation, { onlyLedgerAndRelease: true });
    }

    return this.#buildArtifact(reservationId, contract, reservation, principal);
  }

  #buildArtifact(
    reservationId: string,
    contract: BookingContract,
    reservation: Reservation,
    principal: CommandPrincipal,
  ): CancellationArtifact {
    const isStaff = principal.role === "authorized_staff" || principal.role === "admin";
    const policy = validateCancellationPolicy(contract.policies.cancellationPolicy);
    const window = this.#o.timing.getWindow(reservationId, contract);
    const economics = this.#o.economics.getEconomics({ reservationId, contract });
    const arrival = this.#o.arrival.getState(reservationId);
    const contact = this.#o.contacts?.getStatus(reservationId);
    const estimate = this.#manager.calculateAuthoritative({
      reservationId,
      contract,
      economics,
      policy,
      checkInWindowStartIso: window.startIso,
      at: this.#o.clock?.() ?? new Date(),
      liability: "guest",
    });
    const existing = this.#cases.findByReservationId(reservationId);
    const id = cancellationArtifactId(reservationId);
    const markers = {
      reservationStatus: reservation.status,
      contractVersion: contract.contractVersion,
      policyVersion: policy.version,
      economicsVersion: economics.version,
      estimate: { percentage: estimate.refundPercentage, total: estimate.totalRefundKobo },
      arrivalVersion: arrival.version,
      contactAttemptVersion: contact?.version,
      caseState: existing,
    };
    const projectionVersion = cancellationProjectionVersion(markers);
    const actions: Array<CancellationArtifact["actions"][number]> = [];
    const preStay = arrival.status === "awaiting_access";
    if (!isStaff && principal.role === "guest" && reservation.status === "confirmed" && preStay) {
      actions.push({
        type: "cancel_booking",
        artifactId: id,
        reservationId,
        expectedReservationStatus: "confirmed",
        expectedContractVersion: contract.contractVersion,
        policyVersion: policy.version,
        economicsVersion: economics.version,
        arrivalVersion: arrival.version,
        projectionVersion,
      });
    }
    let noShow: CancellationArtifact["facts"]["noShow"];
    if (contact) {
      let eligible = false;
      try {
        this.#manager.assertNoShowEligible({
          reservation,
          checkInDate: contract.dates.checkIn,
          now: this.#o.clock?.() ?? new Date(),
          arrival,
          contact,
        });
        eligible = true;
      } catch {
        /* projection remains safe and non-actionable */
      }
      noShow = { deadline: this.#manager.noShowDeadline(contract.dates.checkIn), eligible };
      if (isStaff && eligible) {
        actions.push({
          type: "confirm_no_show",
          artifactId: id,
          reservationId,
          expectedReservationStatus: "confirmed",
          expectedContractVersion: contract.contractVersion,
          policyVersion: policy.version,
          economicsVersion: economics.version,
          arrivalVersion: arrival.version,
          contactAttemptVersion: contact.version,
          projectionVersion,
        });
      }
    }

    const stayAmountKobo = existing?.stayRefundAmountKobo ?? Math.max(0, estimate.totalRefundKobo - estimate.securityDepositRefundKobo);
    const depositAmountKobo = existing?.depositRefundAmountKobo ?? (contract.securityDeposit && contract.securityDeposit.amountKobo > 0 ? contract.securityDeposit.amountKobo : 0);
    const refundsProjection = existing
      ? {
          stay: Object.freeze({
            amountKobo: stayAmountKobo,
            status: existing.refundStatus,
            paymentMethod: contract.paymentDetails.paymentMethod,
          }),
          deposit: Object.freeze({
            amountKobo: depositAmountKobo,
            status: existing.depositRefundStatus ?? (depositAmountKobo > 0 ? ("pending" as const) : ("not_applicable" as const)),
          }),
        }
      : undefined;

    return Object.freeze({
      id,
      kind: "shortlet.cancellation",
      schemaVersion: "shortlet.cancellation/v1",
      projectionVersion,
      facts: Object.freeze({
        reservationId,
        contractId: contract.contractId,
        reservationStatus: reservation.status,
        contractVersion: contract.contractVersion,
        dates: Object.freeze({ checkIn: contract.dates.checkIn, checkOut: contract.dates.checkOut }),
        policy,
        contractualCheckInWindowStart: window.startIso,
        timezone: "Africa/Lagos" as const,
        economicsVersion: economics.version,
        arrivalVersion: arrival.version,
        ...(contact ? { contactAttemptVersion: contact.version } : {}),
        currentRefundEstimate: estimate,
        ...(contract.securityDeposit
          ? {
              refundableSecurityDepositKobo: contract.securityDeposit.amountKobo,
              securityDepositPolicyVersion: contract.securityDeposit.policyVersion,
            }
          : {}),
        ...(refundsProjection ? { refunds: Object.freeze(refundsProjection) } : {}),
        ...(existing ? { case: existing } : {}),
        ...(noShow ? { noShow } : {}),
      }),
      actions: Object.freeze(actions),
    });
  }

  cancel(reservationId: string, principal: CommandPrincipal, context?: CancellationActionContext): CancellationArtifact {
    const reservation = this.#o.state.findReservationById(reservationId);
    if (!reservation) throw new Error("Access denied or resource not found");
    const contract = this.#o.state.findContractById(reservation.contractId);
    if (!contract) throw new Error("Access denied or resource not found");
    guestAuthorized(contract, reservation, principal);
    const current = this.getArtifact(reservationId, principal);
    const envelope = createPlatformCommandEnvelope({
      commandName: "shortlet.cancellation.cancel",
      principal,
      payload: {
        reservationId,
        ...(context ?? {
          artifactId: current.id,
          expectedReservationStatus: "confirmed",
          expectedContractVersion: current.facts.contractVersion,
          policyVersion: current.facts.policy.version,
          economicsVersion: current.facts.economicsVersion,
          arrivalVersion: current.facts.arrivalVersion,
          projectionVersion: current.projectionVersion,
        }),
      },
    });
    return this.commitGuestCancellation(envelope, principal);
  }

  commitGuestCancellation(envelope: PlatformCommandEnvelope<unknown>, principal: CommandPrincipal): CancellationArtifact {
    const payload = envelope.payload as unknown as CancellationActionContext & { reservationId: string };
    const reservation = this.#o.state.findReservationById(payload.reservationId);
    if (!reservation) throw new Error("Access denied or resource not found");
    const contract = this.#o.state.findContractById(reservation.contractId);
    if (!contract) throw new Error("Access denied or resource not found");
    guestAuthorized(contract, reservation, principal);
    const current = this.getArtifact(payload.reservationId, principal);
    if (
      !current.actions.some((action) => action.type === "cancel_booking") ||
      payload.artifactId !== current.id ||
      payload.expectedReservationStatus !== current.facts.reservationStatus ||
      payload.expectedContractVersion !== current.facts.contractVersion ||
      payload.policyVersion !== current.facts.policy.version ||
      payload.economicsVersion !== current.facts.economicsVersion ||
      payload.arrivalVersion !== current.facts.arrivalVersion ||
      payload.projectionVersion !== current.projectionVersion
    ) {
      throw new Error("STALE_ACTION");
    }
    this.#assertNoAmendmentSettlementInFlight(contract.contractId);
    // Validate obligations before changing reservation status so invalid economics never strand a booking.
    this.#authoritativeObligations(payload.reservationId, contract, "guest");
    const changed = this.#o.state.transitionReservationStatus(payload.reservationId, "confirmed", "cancelled");
    const latestContract = this.#closePendingChangesForCancellation(contract, principal.id ?? "guest");
    return this.#complete(payload.reservationId, latestContract, changed, "guest_cancellation", "guest", principal);
  }

  processReviewedCancellation(reservationId: string, principal: CommandPrincipal, context?: CancellationActionContext): CancellationArtifact {
    const reservation = this.#o.state.findReservationById(reservationId);
    if (!reservation) throw new Error("Access denied or resource not found");
    const contract = this.#o.state.findContractById(reservation.contractId);
    if (!contract) throw new Error("Access denied or resource not found");
    staffAuthorized(contract, principal);
    const decision = this.#o.liability?.getDecision({ reservationId });
    if (!decision?.valid) throw new Error("Trusted cancellation liability decision is required");
    if (context && context.decisionVersion !== decision.decisionVersion) throw new Error("STALE_ACTION");
    const existing = this.#cases.findByReservationId(reservationId);
    if (existing) return this.getArtifact(reservationId, principal);
    this.#assertNoAmendmentSettlementInFlight(contract.contractId);
    this.#authoritativeObligations(reservationId, contract, decision.liability);
    const changed = this.#o.state.transitionReservationStatus(reservationId, "confirmed", "cancelled");
    const latestContract = this.#closePendingChangesForCancellation(contract, principal.id ?? "staff");
    return this.#complete(reservationId, latestContract, changed, "reviewed_cancellation", decision.liability, principal);
  }

  confirmNoShow(reservationId: string, principal: CommandPrincipal, context?: CancellationActionContext): CancellationArtifact {
    const reservation = this.#o.state.findReservationById(reservationId);
    if (!reservation) throw new Error("Access denied or resource not found");
    const contract = this.#o.state.findContractById(reservation.contractId);
    if (!contract) throw new Error("Access denied or resource not found");
    staffAuthorized(contract, principal);
    const arrival = this.#o.arrival.getState(reservationId);
    const contact = this.#o.contacts?.getStatus(reservationId);
    if (!contact || (context && context.contactAttemptVersion !== contact.version)) throw new Error("STALE_ACTION");
    this.#manager.assertNoShowEligible({
      reservation,
      checkInDate: contract.dates.checkIn,
      now: this.#o.clock?.() ?? new Date(),
      arrival,
      contact,
    });
    const existing = this.#cases.findByReservationId(reservationId);
    if (existing) return this.getArtifact(reservationId, principal);
    this.#assertNoAmendmentSettlementInFlight(contract.contractId);
    this.#authoritativeObligations(reservationId, contract, "guest");
    const changed = this.#o.state.transitionReservationStatus(reservationId, "confirmed", "no_show");
    const latestContract = this.#closePendingChangesForCancellation(contract, principal.id ?? "staff");
    return this.#complete(reservationId, latestContract, changed, "no_show", "guest", principal);
  }

  /**
   * Idempotent staff/system resume for an incomplete cancellation (Issue 05 AC1-AC3, AC6, D4).
   * Refuses guests, missing/mismatched tenants, missing reservations, and non-cancelled stays.
   */
  resumeCancellation(reservationId: string, principal: CommandPrincipal): CancellationArtifact {
    const reservation = this.#o.state.findReservationById(reservationId);
    const contract = reservation ? this.#o.state.findContractById(reservation.contractId) : null;
    if (!reservation || !contract) {
      if (principal.role !== "authorized_staff" && principal.role !== "admin" && principal.role !== "system") {
        throw new Error("Authorized staff or system principal is required");
      }
      throw new Error("Access denied or resource not found");
    }
    systemOrStaffAuthorized(contract, principal);
    if (reservation.status === "confirmed") {
      throw new Error("STALE_ACTION");
    }
    const existing = this.#cases.findByReservationId(reservationId);
    if (!existing) {
      throw new Error("STALE_ACTION");
    }
    this.#resumeCase(reservationId, contract, reservation);
    return this.#buildArtifact(reservationId, contract, reservation, principal);
  }

  #complete(
    reservationId: string,
    contract: BookingContract,
    reservation: Reservation,
    outcome: CancellationCase["outcome"],
    liability: CancellationLiability,
    viewer: CommandPrincipal,
  ): CancellationArtifact {
    const effectiveLiability = outcome === "no_show" ? "guest" : liability;
    const { policy, economics, stayRefundKobo, depositRefundKobo } = this.#authoritativeObligations(
      reservationId,
      contract,
      effectiveLiability,
    );
    const cancellationId = `cancellation:${reservationId}`;
    const cancelledAt = (this.#o.clock?.() ?? new Date()).toISOString();
    this.#cases.createIfAbsent({
      cancellationId,
      reservationId,
      caseVersion: 1,
      outcome,
      liability: effectiveLiability,
      stayDates: { checkIn: contract.dates.checkIn, checkOut: contract.dates.checkOut },
      cancelledAt,
      stayRefundAmountKobo: stayRefundKobo,
      depositRefundAmountKobo: depositRefundKobo,
      refundStatus: "not_started",
      inventoryReleaseStatus: "pending",
      ledgerStatus: "pending",
    });

    const current = this.#resumeCase(reservationId, contract, reservation);
    this.#o.audit?.record({
      type: outcome === "no_show" ? "no_show.confirmed" : "cancellation.committed",
      reservationId,
      cancellationId,
      contractVersion: contract.contractVersion,
      policyVersion: policy.version,
      economicsVersion: economics.version,
      liability: effectiveLiability,
      refundStatus: current.refundStatus,
      depositRefundStatus: current.depositRefundStatus,
      inventoryReleaseStatus: current.inventoryReleaseStatus,
      ledgerStatus: current.ledgerStatus,
      recordedAt: cancelledAt,
    });
    return this.#buildArtifact(reservationId, contract, reservation, viewer);
  }

  #resumeCase(
    reservationId: string,
    contract: BookingContract,
    reservation: Reservation,
    options: { readonly onlyLedgerAndRelease?: boolean } = {},
  ): CancellationCase {
    const initial = this.#cases.findByReservationId(reservationId);
    if (!initial) throw new Error("STALE_ACTION");
    if (this.#isCaseFinished(initial)) return initial;
    if (options.onlyLedgerAndRelease && initial.ledgerStatus === "posted" && initial.inventoryReleaseStatus === "released") {
      return initial;
    }

    const releaseGuard = this.#acquireResumeGuard(reservationId);
    if (!releaseGuard) return initial;

    try {
      let current = this.#cases.findByReservationId(reservationId);
      if (!current) throw new Error("STALE_ACTION");
      if (this.#isCaseFinished(current)) return current;

      const effectiveLiability: CancellationLiability =
        current.outcome === "no_show" ? "guest" : (current.liability ?? "guest");
      const { estimate, stayRefundKobo, depositRefundKobo } = this.#authoritativeObligations(
        reservationId,
        contract,
        effectiveLiability,
      );

      // Step 1: post cancellation to ledger (failure never blocks dates release or refund obligations).
      if (current.ledgerStatus !== "posted") {
        try {
          const ledger = this.#o.ledger.postCancellation({
            cancellationId: current.cancellationId,
            reservationId,
            liability: effectiveLiability,
            amountKobo: stayRefundKobo,
            retainedCancellationBaseKobo: estimate.retainedCancellationBaseKobo,
            retainedCommissionKobo: estimate.retainedCommissionKobo,
            currency: "NGN",
          });
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            ledgerStatus: ledger.status,
            ledgerRecordId: ledger.ledgerRecordId,
          }));
        } catch {
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            ledgerStatus: "reconciliation_required",
          }));
        }
      }

      // Step 2: release dates independently of ledger or refund status.
      if (current.inventoryReleaseStatus !== "released") {
        try {
          if (!reservation.inventoryCommitmentId) throw new Error("Reservation commitment is missing");
          this.#o.availability.releaseConfirmedBooking({
            commitmentId: reservation.inventoryCommitmentId,
            unitId: reservation.unitId,
            start: reservation.dates.checkIn,
            end: reservation.dates.checkOut,
          });
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            inventoryReleaseStatus: "released",
          }));
        } catch {
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            inventoryReleaseStatus: "reconciliation_required",
          }));
        }
      }

      if (options.onlyLedgerAndRelease) {
        return current;
      }

      // Step 3: stay refund obligation (never includes security deposit).
      if (current.refundStatus !== "pending" && current.refundStatus !== "settled") {
        const payment = contract.paymentDetails;
        const source = payment.paymentMethod === "fresh_card" ? payment.pspReference : payment.transferReference;
        try {
          const refund = this.#o.refunds.initiateOrGetRefund({
            cancellationId: current.cancellationId,
            reservationId,
            paymentMethod: payment.paymentMethod,
            originalPaymentReference: source,
            amountKobo: stayRefundKobo,
            currency: "NGN",
          });
          if (refund.amountKobo !== stayRefundKobo || refund.currency !== "NGN") {
            throw new Error("Refund provider result does not match the authoritative obligation");
          }
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            refundStatus: refund.status,
            refundId: refund.refundId,
          }));
        } catch {
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            refundStatus: "failed",
          }));
        }
      }

      // Step 4: security deposit refund obligation (separate from stay refund, ADR 0016, rules 01 S7).
      if (
        current.depositRefundStatus !== "not_applicable" &&
        current.depositRefundStatus !== "pending" &&
        current.depositRefundStatus !== "settled"
      ) {
        if (depositRefundKobo > 0) {
          if (!contract.securityDeposit?.collectionId || !this.#o.depositRefunds) {
            current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
              ...value,
              caseVersion: value.caseVersion + 1,
              depositRefundStatus: "reconciliation_required",
            }));
          } else {
            try {
              const refund = this.#o.depositRefunds.initiateOrGetRefund({
                cancellationId: current.cancellationId,
                reservationId,
                collectionId: contract.securityDeposit.collectionId,
                amountKobo: depositRefundKobo,
                currency: "NGN",
              });
              if (refund.amountKobo !== depositRefundKobo || refund.currency !== "NGN") {
                throw new Error("Deposit refund obligation mismatch");
              }
              current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
                ...value,
                caseVersion: value.caseVersion + 1,
                depositRefundStatus: refund.status,
                depositRefundId: refund.refundId,
              }));
            } catch {
              current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
                ...value,
                caseVersion: value.caseVersion + 1,
                depositRefundStatus: "reconciliation_required",
              }));
            }
          }
        } else {
          current = this.#cases.update(reservationId, current.caseVersion, (value) => ({
            ...value,
            caseVersion: value.caseVersion + 1,
            depositRefundStatus: "not_applicable",
          }));
        }
      }

      return current;
    } finally {
      releaseGuard();
    }
  }
}

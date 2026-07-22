import { SecurityContext } from "./thread.js";
import { PlatformCommandEnvelope } from "./envelope.js";
import { InMemoryAuditLog } from "./index.js";

/**
 * AC 1: Restricted store that preserves original provider payload provenance
 * and exposes only redacted operational facts.
 */
export class RestrictedPayloadStore {
  readonly #payloads = new Map<
    string,
    {
      payloadId: string;
      providerId: string;
      eventType: string;
      rawPayload: Record<string, unknown>;
      headers?: Record<string, string>;
      signature?: string;
      receivedAt: string;
    }
  >();

  saveRawPayload(
    providerId: string,
    eventType: string,
    rawPayload: Record<string, unknown>,
    headers?: Record<string, string>,
    signature?: string
  ): string {
    const payloadId = `payload-${crypto.randomUUID()}`;
    const entry = {
      payloadId,
      providerId,
      eventType,
      rawPayload: Object.freeze({ ...rawPayload }),
      headers: headers ? Object.freeze({ ...headers }) : undefined,
      signature,
      receivedAt: new Date().toISOString()
    };
    this.#payloads.set(payloadId, entry);
    return payloadId;
  }

  getRawPayload(
    payloadId: string,
    context: SecurityContext & { role?: string }
  ) {
    if (!context || (context.role !== "admin" && context.role !== "authorized_staff")) {
      throw new Error("Unauthorized access to restricted payload store");
    }

    const entry = this.#payloads.get(payloadId);
    if (!entry) {
      throw new Error(`Payload ${payloadId} not found in restricted store`);
    }
    return entry;
  }

  getRedactedOperationalFacts(payloadId: string): Record<string, unknown> {
    const entry = this.#payloads.get(payloadId);
    if (!entry) {
      throw new Error(`Payload ${payloadId} not found`);
    }

    const raw = entry.rawPayload;
    return Object.freeze({
      payloadId: entry.payloadId,
      providerId: entry.providerId,
      eventType: entry.eventType,
      transactionRef: raw.transactionRef ?? raw.txRef ?? "tx-unknown",
      status: raw.status ?? "received",
      amountKobo: raw.amountKobo ?? raw.amount ?? 0,
      currency: raw.currency ?? "NGN",
      receivedAt: entry.receivedAt,
      providerReference: raw.providerReference ?? entry.signature ? "[REDACTED_REF]" : "ref-none"
    });
  }
}

/**
 * AC 2: Ledger balance guard ensuring debits equal credits.
 */
export class LedgerBalanceGuard {
  static verifyBalancedLedger(
    entries: Array<{ accountId: string; debitKobo: number; creditKobo: number }>
  ): boolean {
    if (!entries || entries.length === 0) {
      throw new Error("Ledger balance violation: entries required");
    }

    const totalDebits = entries.reduce((sum, e) => sum + (e.debitKobo ?? 0), 0);
    const totalCredits = entries.reduce((sum, e) => sum + (e.creditKobo ?? 0), 0);

    if (totalDebits !== totalCredits) {
      throw new Error("Ledger balance violation: total debits must equal total credits");
    }

    return true;
  }
}

export interface RecoveryCommandPayload {
  actionType: "reconcile_late_payment" | "reconcile_duplicate_callback" | "reconcile_refund_drift" | "reconcile_revenue_release" | "reconcile_deposit_claim";
  transactionRef: string;
  expectedVersion?: number;
  providerReference?: string;
  amountKobo?: number;
  ledgerEntries?: Array<{ accountId: string; debitKobo: number; creditKobo: number }>;
  isPendingProviderCompletion?: boolean;
  [key: string]: unknown;
}

/**
 * ADR 0001, ADR 0002, ADR 0021, ADR 0024, ADR 0045, ADR 0046, ADR 0072, ADR 0079, ADR 0080 & Issue 41:
 * External event reconciliation engine for late/duplicate events and financial inconsistency.
 */
export class ExternalEventReconciler {
  readonly #audit?: InMemoryAuditLog;
  readonly #payloadStore?: RestrictedPayloadStore;
  readonly #executedCommands = new Map<string, any>();
  readonly #reconciledEntities = new Map<string, any>();
  readonly #entityVersions = new Map<string, number>();

  constructor(options?: { audit?: InMemoryAuditLog; payloadStore?: RestrictedPayloadStore }) {
    this.#audit = options?.audit;
    this.#payloadStore = options?.payloadStore;
  }

  /**
   * AC 2: Recovery commands are authorized, idempotent, expected-version checked, auditable, and balanced in the ledger.
   */
  executeRecoveryCommand(envelope: PlatformCommandEnvelope<RecoveryCommandPayload>): Record<string, unknown> {
    // 1. Authorization check
    const role = envelope.principal.role;
    if (role !== "authorized_staff" && role !== "admin") {
      throw new Error("Unauthorized recovery command: caller lacks authorized staff role");
    }

    // 2. Idempotency check
    const idempotencyKey = envelope.idempotencyKey ?? envelope.commandId;
    if (this.#executedCommands.has(idempotencyKey)) {
      return this.#executedCommands.get(idempotencyKey);
    }

    const { transactionRef, ledgerEntries, isPendingProviderCompletion } = envelope.payload;
    const expectedVersion = envelope.expectedVersion ?? envelope.payload.expectedVersion;

    // 3. Expected version check
    if (expectedVersion !== undefined) {
      const currentVersion = this.#entityVersions.get(transactionRef) ?? 1;
      if (currentVersion !== expectedVersion) {
        throw new Error(`Version conflict: expected version ${expectedVersion} but found ${currentVersion}`);
      }
    }

    // 4. Ledger balance check
    if (ledgerEntries) {
      LedgerBalanceGuard.verifyBalancedLedger(ledgerEntries);
    }

    // 5. Reprocessing prevention check (AC 3)
    const existing = this.#reconciledEntities.get(transactionRef);
    if (existing) {
      const result = Object.freeze({
        status: "reconciled",
        isDuplicateReprocessing: true,
        entity: existing,
        providerCompletionStatus: isPendingProviderCompletion ? "pending_provider_completion" : "completed"
      });
      this.#executedCommands.set(idempotencyKey, result);
      return result;
    }

    // Apply state change
    const newVersion = (this.#entityVersions.get(transactionRef) ?? 1) + 1;
    this.#entityVersions.set(transactionRef, newVersion);

    const entity = {
      transactionRef,
      actionType: envelope.payload.actionType,
      providerReference: envelope.payload.providerReference ?? "pref-reconciled",
      amountKobo: envelope.payload.amountKobo ?? 0,
      version: newVersion,
      reconciledAt: new Date().toISOString()
    };

    this.#reconciledEntities.set(transactionRef, entity);

    const result = Object.freeze({
      status: "reconciled",
      isDuplicateReprocessing: false,
      entity,
      providerCompletionStatus: isPendingProviderCompletion ? "pending_provider_completion" : "completed"
    });

    this.#executedCommands.set(idempotencyKey, result);

    // Audit logging
    if (this.#audit) {
      this.#audit.record({
        type: "reconciliation.command_executed",
        commandId: envelope.commandId,
        commandName: envelope.commandName,
        principal: envelope.principal,
        resultStatus: "committed"
      });
    }

    return result;
  }

  /**
   * AC 3: Reprocessing cannot form duplicate Reservations, refunds, releases, claims, or fund movements.
   */
  reconcileLatePayment(payload: { transactionRef: string; amountKobo: number; providerReference: string }, expectedVersion?: number) {
    const existing = this.#reconciledEntities.get(payload.transactionRef);
    if (existing) {
      return Object.freeze({
        entityType: "Refund",
        refundId: existing.refundId ?? `ref-${payload.transactionRef}`,
        isDuplicate: true,
        reconciled: true
      });
    }

    const refundId = `ref-${payload.transactionRef}`;
    const entity = {
      entityType: "Refund",
      refundId,
      transactionRef: payload.transactionRef,
      amountKobo: payload.amountKobo,
      providerReference: payload.providerReference,
      status: "refunded_late_payment"
    };

    this.#reconciledEntities.set(payload.transactionRef, entity);
    return Object.freeze({ ...entity, isDuplicate: false, reconciled: true });
  }

  reconcileDuplicateCallback(payload: { eventId: string; transactionRef: string; providerReference: string }) {
    const existing = this.#reconciledEntities.get(payload.transactionRef);
    if (existing) {
      return Object.freeze({
        entityType: "Reservation",
        reservationId: existing.reservationId ?? `res-${payload.transactionRef}`,
        isDuplicate: true,
        reconciled: true
      });
    }

    const reservationId = `res-${payload.transactionRef}`;
    const entity = {
      entityType: "Reservation",
      reservationId,
      transactionRef: payload.transactionRef,
      providerReference: payload.providerReference,
      status: "confirmed"
    };

    this.#reconciledEntities.set(payload.transactionRef, entity);
    return Object.freeze({ ...entity, isDuplicate: false, reconciled: true });
  }

  reconcileRefundDrift(payload: { reservationId: string; refundAmountKobo: number; transactionRef: string }) {
    const existing = this.#reconciledEntities.get(payload.transactionRef);
    if (existing) {
      return Object.freeze({
        entityType: "Refund",
        refundId: existing.refundId ?? `refund-drift-${payload.reservationId}`,
        isDuplicate: true,
        reconciled: true
      });
    }

    const refundId = `refund-drift-${payload.reservationId}`;
    const entity = {
      entityType: "Refund",
      refundId,
      reservationId: payload.reservationId,
      transactionRef: payload.transactionRef,
      amountKobo: payload.refundAmountKobo,
      status: "drift_reconciled"
    };

    this.#reconciledEntities.set(payload.transactionRef, entity);
    return Object.freeze({ ...entity, isDuplicate: false, reconciled: true });
  }

  reconcileRevenueRelease(payload: { reservationId: string; operatorNetKobo: number; transactionRef: string }) {
    const existing = this.#reconciledEntities.get(payload.transactionRef);
    if (existing) {
      return Object.freeze({
        entityType: "RevenueRelease",
        releaseId: existing.releaseId ?? `rel-${payload.reservationId}`,
        isDuplicate: true,
        reconciled: true
      });
    }

    const releaseId = `rel-${payload.reservationId}`;
    const entity = {
      entityType: "RevenueRelease",
      releaseId,
      reservationId: payload.reservationId,
      transactionRef: payload.transactionRef,
      operatorNetKobo: payload.operatorNetKobo,
      status: "released"
    };

    this.#reconciledEntities.set(payload.transactionRef, entity);
    return Object.freeze({ ...entity, isDuplicate: false, reconciled: true });
  }

  reconcileDepositClaim(payload: { claimId: string; claimAmountKobo: number; transactionRef: string }) {
    const existing = this.#reconciledEntities.get(payload.transactionRef);
    if (existing) {
      return Object.freeze({
        entityType: "DepositClaim",
        claimId: existing.claimId ?? payload.claimId,
        isDuplicate: true,
        reconciled: true
      });
    }

    const entity = {
      entityType: "DepositClaim",
      claimId: payload.claimId,
      transactionRef: payload.transactionRef,
      claimAmountKobo: payload.claimAmountKobo,
      status: "reconciled"
    };

    this.#reconciledEntities.set(payload.transactionRef, entity);
    return Object.freeze({ ...entity, isDuplicate: false, reconciled: true });
  }

  /**
   * AC 4: Staff and guest/Operator projections update from the committed correction
   * and clearly distinguish pending provider completion.
   */
  getReconciledProjection(
    transactionRef: string,
    viewerRole: "staff" | "guest" | "operator",
    options?: { isPendingProviderCompletion?: boolean }
  ): Record<string, unknown> {
    const entity = this.#reconciledEntities.get(transactionRef);
    const providerCompletionStatus = options?.isPendingProviderCompletion
      ? "pending_provider_completion"
      : "completed";

    if (!entity) {
      return Object.freeze({
        transactionRef,
        status: "unreconciled",
        providerCompletionStatus,
        viewerRole
      });
    }

    if (viewerRole === "staff") {
      return Object.freeze({
        transactionRef,
        status: "reconciled",
        providerCompletionStatus,
        entity,
        viewerRole: "staff"
      });
    }

    // Guest / Operator view has redacted operational facts
    return Object.freeze({
      transactionRef,
      status: "reconciled",
      providerCompletionStatus,
      amountKobo: entity.amountKobo ?? entity.operatorNetKobo ?? entity.claimAmountKobo ?? 0,
      viewerRole
    });
  }
}

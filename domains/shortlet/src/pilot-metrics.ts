import type { AccessStatus } from "./checkin-support.js";
import type { OwnerPayableStatus } from "./owner-payable.js";

/**
 * Pilot metrics for the back office (production-launch issue 09, wrapping pilot-launch-readiness/13).
 *
 * Every metric name here is defined in `domains/shortlet/CONTEXT.md` under "Pilot metrics". A metric with no
 * durable production source is reported as unavailable with a reason, never as zero (issue 09 "What to build").
 * Reads and scope live in `apps/local-owner`; this module only aggregates rows it is handed.
 */

export type PilotPaymentMethod = "fresh_card" | "manual_transfer" | "bank_transfer";

export interface PilotRequestRecord {
  readonly disclosedAt: string;
  readonly confirmedAt: string | null;
  readonly status: string;
}

export interface PilotCardSessionRecord {
  readonly status: "initiated" | "completed" | "expired" | "failed";
}

/** A refund recorded inside a card or bank-transfer payment journey (ADR 0045 compensation). */
export interface PilotJourneyRefundRecord {
  readonly method: "fresh_card" | "bank_transfer";
  readonly status: "pending" | "settled";
  readonly amountKobo: number;
}

export interface PilotManualTransferRecord {
  readonly status: "awaiting_receipt" | "awaiting_verification" | "confirmed" | "rejected" | "expired";
  readonly amountKobo: number;
  /** ADR 0045/0090: money that arrived after the transfer closed, recorded for refund. */
  readonly refundOwedKobo: number | null;
}

export interface PilotBankTransferRecord {
  readonly status: "initiated" | "processing_in_grace" | "completed" | "expired" | "refunded";
  readonly amountKobo: number;
}

export interface PilotCheckInRecord {
  readonly accessStatus: AccessStatus | null;
  readonly incidents: number;
}

export interface PilotRefundRecord {
  readonly source: "guest_refund" | "cancellation" | "period_payment" | "manual_transfer_late_credit";
  readonly amountKobo: number;
}

export interface PilotPayableRecord {
  readonly status: OwnerPayableStatus;
  readonly marginEarnedKobo: number;
  readonly ownerPayableKobo: number;
  readonly paidKobo: number;
  readonly outstandingKobo: number;
}

export interface PilotRequestMetrics {
  /** Booking Requests received (disclosed to the owner). */
  readonly received: number;
  readonly confirmed: number;
  readonly declined: number;
  /** Confirmed ÷ received, from 0 to 1; null when no request was received. */
  readonly confirmedShare: number | null;
  /** Median milliseconds from disclosure to confirmation; null until a request is confirmed. */
  readonly medianTimeToConfirmMs: number | null;
}

export interface PilotPaymentStats {
  readonly started: number;
  readonly completed: number;
  readonly expired: number;
  readonly failed: number;
  /** Refunds recorded for this method: settled (or recorded as made), plus a separate pending count. */
  readonly refunded: number;
  readonly refundedKobo: number;
  readonly refundsPending: number;
  readonly refundsPendingKobo: number;
}

export type PilotPaymentMetric =
  | ({ readonly method: PilotPaymentMethod; readonly available: true } & PilotPaymentStats)
  | { readonly method: PilotPaymentMethod; readonly available: false; readonly reason: string };

export interface PilotCheckInMetrics {
  /** Reservations the signed-in representative acts for. */
  readonly reservations: number;
  /** Reservations with Verified Access (verified, or a valid late voluntary arrival). */
  readonly verifiedAccess: number;
  readonly verifiedAccessShare: number | null;
  /** Blocking Fulfilment Complaints recorded against those reservations. */
  readonly incidents: number;
  readonly incidentsPerStay: number | null;
}

export interface PilotRefundAmount {
  readonly count: number;
  readonly amountKobo: number;
}

/**
 * Refund amounts by the stage their durable source records. The groups are kept apart because they describe the
 * same money at different stages: a cancellation decides a refund, guest_refunds records payments of it, and a
 * payment reversal records money for refund. Adding them together would double-count.
 */
export interface PilotRefundMetrics {
  /** Refunds recorded as paid to the Guest (guest_refunds). */
  readonly paidToGuests: PilotRefundAmount;
  /** Amounts decided under a cancellation policy (owner_payable_cancellations). */
  readonly decidedByPolicy: PilotRefundAmount;
  /** Money recorded for refund by the period-payment and manual-transfer reversal paths. */
  readonly recordedForRefund: PilotRefundAmount;
}

export interface PilotMoneyMetrics {
  readonly marginEarnedKobo: number;
  readonly ownerPayablesDueKobo: number;
  readonly ownerPayablesPaidKobo: number;
  readonly ownerPayablesNotYetDueKobo: number;
}

export type PilotRelocationMetrics =
  | { readonly available: true; readonly count: number; readonly amountKobo: number }
  | { readonly available: false; readonly reason: string };

export interface PilotMetricsReport {
  readonly generatedAt: string;
  readonly requests: PilotRequestMetrics;
  readonly payments: readonly PilotPaymentMetric[];
  readonly checkIns: PilotCheckInMetrics;
  readonly refunds: PilotRefundMetrics;
  readonly relocations: PilotRelocationMetrics;
  readonly money: PilotMoneyMetrics;
}

export interface PilotMetricsInput {
  readonly requests: readonly PilotRequestRecord[];
  readonly cardSessions: readonly PilotCardSessionRecord[];
  readonly journeyRefunds: readonly PilotJourneyRefundRecord[];
  /** Undefined when the deployment has no manual-transfer store: reported unavailable, never zero. */
  readonly manualTransfers?: readonly PilotManualTransferRecord[];
  /** Undefined when the deployment has no bank-transfer store: reported unavailable, never zero. */
  readonly bankTransfers?: readonly PilotBankTransferRecord[];
  readonly checkIns: readonly PilotCheckInRecord[];
  readonly refunds: readonly PilotRefundRecord[];
  readonly payables: readonly PilotPayableRecord[];
  readonly relocations: PilotRelocationMetrics;
  readonly generatedAt: string;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function summarisePilotRequests(records: readonly PilotRequestRecord[]): PilotRequestMetrics {
  const received = records.length;
  const confirmed = records.filter((record) => record.status === "confirmed" && record.confirmedAt !== null).length;
  const declined = records.filter((record) => record.status === "declined").length;
  const durations = records.flatMap((record): number[] => {
    if (record.status !== "confirmed" || record.confirmedAt === null) return [];
    const disclosed = Date.parse(record.disclosedAt);
    const confirmedAt = Date.parse(record.confirmedAt);
    return Number.isFinite(disclosed) && Number.isFinite(confirmedAt) && confirmedAt >= disclosed ? [confirmedAt - disclosed] : [];
  });
  return Object.freeze({
    received,
    confirmed,
    declined,
    confirmedShare: rate(confirmed, received),
    medianTimeToConfirmMs: median(durations),
  });
}

function mergePayment(
  method: PilotPaymentMethod,
  stats: {
    readonly started: number;
    readonly completed: number;
    readonly expired: number;
    readonly failed: number;
    readonly refunds: readonly { readonly status: "pending" | "settled"; readonly amountKobo: number }[];
  },
): PilotPaymentMetric {
  const settled = stats.refunds.filter((refund) => refund.status === "settled");
  const pending = stats.refunds.filter((refund) => refund.status === "pending");
  return Object.freeze({
    method,
    available: true as const,
    started: stats.started,
    completed: stats.completed,
    expired: stats.expired,
    failed: stats.failed,
    refunded: settled.length,
    refundedKobo: settled.reduce((sum, refund) => sum + refund.amountKobo, 0),
    refundsPending: pending.length,
    refundsPendingKobo: pending.reduce((sum, refund) => sum + refund.amountKobo, 0),
  });
}

export function summarisePilotPayments(input: PilotMetricsInput): readonly PilotPaymentMetric[] {
  const cardRefunds = input.journeyRefunds.filter((refund) => refund.method === "fresh_card");
  const bankRefunds = input.journeyRefunds.filter((refund) => refund.method === "bank_transfer");
  const card = mergePayment("fresh_card", {
    started: input.cardSessions.length,
    completed: input.cardSessions.filter((session) => session.status === "completed").length,
    expired: input.cardSessions.filter((session) => session.status === "expired").length,
    failed: input.cardSessions.filter((session) => session.status === "failed").length,
    refunds: cardRefunds,
  });
  const manual: PilotPaymentMetric = input.manualTransfers === undefined
    ? Object.freeze({ method: "manual_transfer", available: false as const, reason: "The deployment has no manual bank-transfer store (ADR 0090)." })
    : mergePayment("manual_transfer", {
        started: input.manualTransfers.length,
        completed: input.manualTransfers.filter((transfer) => transfer.status === "confirmed").length,
        expired: input.manualTransfers.filter((transfer) => transfer.status === "expired").length,
        failed: input.manualTransfers.filter((transfer) => transfer.status === "rejected").length,
        refunds: input.manualTransfers.flatMap((transfer) =>
          transfer.refundOwedKobo === null ? [] : [{ status: "settled" as const, amountKobo: transfer.refundOwedKobo }]),
      });
  const bank: PilotPaymentMetric = input.bankTransfers === undefined
    ? Object.freeze({ method: "bank_transfer", available: false as const, reason: "The deployment has no Paystack bank-transfer store (ADR 0088)." })
    : mergePayment("bank_transfer", {
        started: input.bankTransfers.length,
        completed: input.bankTransfers.filter((session) => session.status === "completed").length,
        expired: input.bankTransfers.filter((session) => session.status === "expired").length,
        failed: 0,
        refunds: [
          ...bankRefunds,
          ...input.bankTransfers.flatMap((session) =>
            session.status === "refunded" ? [{ status: "settled" as const, amountKobo: session.amountKobo }] : []),
        ],
      });
  return Object.freeze([card, manual, bank]);
}

export function summarisePilotCheckIns(records: readonly PilotCheckInRecord[]): PilotCheckInMetrics {
  const reservations = records.length;
  const verifiedAccess = records.filter((record) =>
    record.accessStatus === "verified_access" || record.accessStatus === "late_voluntary_arrival").length;
  const incidents = records.reduce((sum, record) => sum + record.incidents, 0);
  return Object.freeze({
    reservations,
    verifiedAccess,
    verifiedAccessShare: rate(verifiedAccess, reservations),
    incidents,
    incidentsPerStay: rate(incidents, reservations),
  });
}

export function summarisePilotRefunds(records: readonly PilotRefundRecord[]): PilotRefundMetrics {
  const amount = (sources: readonly PilotRefundRecord["source"][]): PilotRefundAmount => {
    const matching = records.filter((record) => sources.includes(record.source));
    return Object.freeze({ count: matching.length, amountKobo: matching.reduce((sum, record) => sum + record.amountKobo, 0) });
  };
  return Object.freeze({
    paidToGuests: amount(["guest_refund"]),
    decidedByPolicy: amount(["cancellation"]),
    recordedForRefund: amount(["period_payment", "manual_transfer_late_credit"]),
  });
}

export function summarisePilotMoney(payables: readonly PilotPayableRecord[]): PilotMoneyMetrics {
  return Object.freeze({
    marginEarnedKobo: payables.reduce((sum, payable) => sum + payable.marginEarnedKobo, 0),
    ownerPayablesDueKobo: payables.reduce((sum, payable) => sum + (payable.status === "due" ? payable.outstandingKobo : 0), 0),
    ownerPayablesPaidKobo: payables.reduce((sum, payable) => sum + payable.paidKobo, 0),
    ownerPayablesNotYetDueKobo: payables.reduce(
      (sum, payable) => sum + (payable.status === "not_yet_due" || payable.status === "paused" ? payable.ownerPayableKobo : 0),
      0,
    ),
  });
}

export function buildPilotMetrics(input: PilotMetricsInput): PilotMetricsReport {
  return Object.freeze({
    generatedAt: input.generatedAt,
    requests: summarisePilotRequests(input.requests),
    payments: summarisePilotPayments(input),
    checkIns: summarisePilotCheckIns(input.checkIns),
    refunds: summarisePilotRefunds(input.refunds),
    relocations: input.relocations,
    money: summarisePilotMoney(input.payables),
  });
}

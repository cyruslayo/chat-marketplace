import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { SqlDatabase, SqlRow, SqlValue } from "../../../packages/platform-core/src/sql-database.js";
import {
  buildPilotMetrics,
  type OperatorRepresentativeGrant,
  type PilotBankTransferRecord,
  type PilotCardSessionRecord,
  type PilotCheckInRecord,
  type PilotJourneyRefundRecord,
  type PilotManualTransferRecord,
  type PilotMetricsReport,
  type PilotPayableRecord,
  type PilotRefundRecord,
  type PilotRequestRecord,
  type AccessStatus,
  type CheckInSupportState,
} from "../../../domains/shortlet/src/index.js";
import type { OperatorOwnerPayable } from "./local-owner-environment.js";

/**
 * Reads the pilot metrics from the authoritative SQLite handle (production-launch issue 09). The same code runs on
 * Node and inside the Cloudflare Durable Object, because both pass a `SqlDatabase` and a check-in store.
 *
 * Scope is the owner or owners the signed-in Operator representative currently acts for (ADR 0082): a revoked or
 * expired grant removes that owner's rows. A metric with no durable source is returned as unavailable, never zero.
 */

export interface PilotMetricsReaderInput {
  readonly database: SqlDatabase;
  readonly principal: CommandPrincipal;
  readonly clock: () => Date;
  readonly grantStore: { listGrants(): readonly OperatorRepresentativeGrant[] };
  readonly checkInStore: { load(reservationId: string): CheckInSupportState | null };
  readonly ownerPayables: readonly OperatorOwnerPayable[];
}

const MANUAL_TRANSFER_STATUSES = ["awaiting_receipt", "awaiting_verification", "confirmed", "rejected", "expired"] as const;
const BANK_TRANSFER_STATUSES = ["initiated", "processing_in_grace", "completed", "expired", "refunded"] as const;
const CARD_SESSION_STATUSES = ["initiated", "completed", "expired", "failed"] as const;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  const json = text(value);
  if (json === null) return null;
  try {
    return object(JSON.parse(json));
  } catch {
    return null;
  }
}

function tableExists(database: SqlDatabase, name: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get([name]) !== undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;
}

/** The operator ids this representative may act for now (ADR 0082); expired and revoked grants are excluded. */
function ownedOperatorIds(input: PilotMetricsReaderInput, now: Date): string[] {
  return [...new Set(input.grantStore.listGrants()
    .filter((grant) => grant.actorId === input.principal.id && grant.tenantId === input.principal.tenantId)
    .filter((grant) => !grant.revokedAtIso && Number.isFinite(Date.parse(grant.expiresAtIso)) && Date.parse(grant.expiresAtIso) > now.getTime())
    .map((grant) => grant.operatorId))];
}

function scope(operatorIds: readonly string[]): { readonly placeholders: string; readonly params: readonly SqlValue[] } {
  return { placeholders: operatorIds.map(() => "?").join(", "), params: [...operatorIds] };
}

interface ScopedQuery {
  readonly select: string;
  /** A table expression aliased `t`, joined to the owned offers and requests. */
  readonly table: string;
  readonly extraWhere?: string;
  readonly extraParams?: readonly SqlValue[];
}

function offerScopedRows(database: SqlDatabase, query: ScopedQuery, tenantId: string, operatorIds: readonly string[]): SqlRow[] {
  const owned = scope(operatorIds);
  return database.prepare(
    `SELECT ${query.select} FROM ${query.table}
       JOIN guest_conditional_offers o ON o.offer_id = t.offer_id
       JOIN guest_booking_requests r ON r.request_id = o.request_id
      WHERE r.tenant_id = ? AND r.operator_id IN (${owned.placeholders})${query.extraWhere ?? ""}`,
  ).all([tenantId, ...owned.params, ...(query.extraParams ?? [])]);
}

function reservationScopedRows(database: SqlDatabase, query: ScopedQuery, tenantId: string, operatorIds: readonly string[]): SqlRow[] {
  const owned = scope(operatorIds);
  return database.prepare(
    `SELECT ${query.select} FROM ${query.table}
       JOIN guest_booking_snapshots b ON b.reservation_id = t.reservation_id
       JOIN guest_conditional_offers o ON o.offer_id = b.offer_id
       JOIN guest_booking_requests r ON r.request_id = o.request_id
      WHERE r.tenant_id = ? AND r.operator_id IN (${owned.placeholders})`,
  ).all([tenantId, ...owned.params]);
}

export function readPilotMetrics(input: PilotMetricsReaderInput): PilotMetricsReport {
  const principal = input.principal;
  if (principal.role !== "operator" || !principal.id || !principal.tenantId) {
    throw new Error("Pilot metrics require an Operator representative");
  }
  const tenantId = principal.tenantId;
  const now = input.clock();
  const operatorIds = ownedOperatorIds(input, now);
  const generatedAt = now.toISOString();
  const relocations = Object.freeze({
    available: false as const,
    reason: "No durable relocation record exists. The relocation remedy runs in memory (apps/web/src/relocation-application.ts) and is not wired into the production composition, so relocation outcomes and amounts cannot yet be counted.",
  });

  if (operatorIds.length === 0) {
    return buildPilotMetrics({
      requests: [], cardSessions: [], journeyRefunds: [], checkIns: [], refunds: [], payables: [], relocations, generatedAt,
    });
  }

  const owned = scope(operatorIds);
  const requests: PilotRequestRecord[] = input.database.prepare(
    `SELECT disclosed_at, confirmed_at, status FROM guest_booking_requests
      WHERE tenant_id = ? AND operator_id IN (${owned.placeholders})`,
  ).all([tenantId, ...owned.params]).flatMap((row): PilotRequestRecord[] => {
    const disclosedAt = text(row.disclosed_at);
    const status = text(row.status);
    return disclosedAt === null || status === null ? [] : [{ disclosedAt, status, confirmedAt: text(row.confirmed_at) }];
  });

  const cardSessions: PilotCardSessionRecord[] = offerScopedRows(
    input.database,
    { select: "t.status AS status", table: "guest_checkout_sessions t", extraWhere: " AND t.purpose = ?", extraParams: ["stay"] },
    tenantId,
    operatorIds,
  ).flatMap((row): PilotCardSessionRecord[] => {
    const status = oneOf(row.status, CARD_SESSION_STATUSES);
    return status === null ? [] : [{ status }];
  });

  const journeyRefunds: PilotJourneyRefundRecord[] = offerScopedRows(
    input.database,
    { select: "t.journey_json AS journey_json", table: "guest_payment_journey_snapshots t" },
    tenantId,
    operatorIds,
  ).flatMap((row): PilotJourneyRefundRecord[] => {
    const journey = parseJson(row.journey_json);
    if (journey === null) return [];
    const method = journey.paymentMethod === "bank_transfer" ? "bank_transfer" as const : journey.paymentMethod === "fresh_card" ? "fresh_card" as const : null;
    const compensation = object(journey.compensation);
    if (method === null || compensation === null) return [];
    return (["stay", "deposit"] as const).flatMap((componentName): PilotJourneyRefundRecord[] => {
      const component = object(compensation[componentName]);
      if (component === null || component.required !== true) return [];
      const status = component.status === "pending" ? "pending" as const : component.status === "settled" ? "settled" as const : null;
      const amountKobo = integer(component.amountKobo);
      return status === null || amountKobo === null ? [] : [{ method, status, amountKobo }];
    });
  });

  let manualTransfers: PilotManualTransferRecord[] | undefined;
  if (tableExists(input.database, "manual_transfers")) {
    manualTransfers = offerScopedRows(
      input.database,
      { select: "t.transfer_json AS transfer_json", table: "manual_transfers t" },
      tenantId,
      operatorIds,
    ).flatMap((row): PilotManualTransferRecord[] => {
      const transfer = parseJson(row.transfer_json);
      if (transfer === null) return [];
      const status = oneOf(transfer.status, MANUAL_TRANSFER_STATUSES);
      const amountKobo = integer(transfer.amountKobo);
      if (status === null || amountKobo === null) return [];
      const refund = object(transfer.refundOwed);
      return [{ status, amountKobo, refundOwedKobo: refund === null ? null : integer(refund.amountReceivedKobo) }];
    });
  }

  let bankTransfers: PilotBankTransferRecord[] | undefined;
  if (tableExists(input.database, "bank_transfer_sessions")) {
    bankTransfers = offerScopedRows(
      input.database,
      { select: "t.session_json AS session_json", table: "bank_transfer_sessions t" },
      tenantId,
      operatorIds,
    ).flatMap((row): PilotBankTransferRecord[] => {
      const session = parseJson(row.session_json);
      if (session === null) return [];
      const status = oneOf(session.status, BANK_TRANSFER_STATUSES);
      const amountKobo = integer(session.amountKobo);
      return status === null || amountKobo === null ? [] : [{ status, amountKobo }];
    });
  }

  const checkIns: PilotCheckInRecord[] = offerScopedRows(
    input.database,
    { select: "t.reservation_id AS reservation_id", table: "guest_booking_snapshots t" },
    tenantId,
    operatorIds,
  ).flatMap((row): PilotCheckInRecord[] => {
    const reservationId = text(row.reservation_id);
    if (reservationId === null) return [];
    const state = input.checkInStore.load(reservationId);
    const accessStatus: AccessStatus | null = state?.result?.status ?? null;
    return [{ accessStatus, incidents: state?.complaints.length ?? 0 }];
  });

  const refunds: PilotRefundRecord[] = [];
  if (tableExists(input.database, "guest_refunds")) {
    for (const row of reservationScopedRows(
      input.database,
      { select: "t.amount_kobo AS amount_kobo", table: "guest_refunds t" },
      tenantId,
      operatorIds,
    )) {
      const amountKobo = integer(row.amount_kobo);
      if (amountKobo !== null) refunds.push({ source: "guest_refund", amountKobo });
    }
  }
  if (tableExists(input.database, "owner_payable_cancellations")) {
    for (const row of reservationScopedRows(
      input.database,
      { select: "t.refund_kobo AS refund_kobo", table: "owner_payable_cancellations t" },
      tenantId,
      operatorIds,
    )) {
      const amountKobo = integer(row.refund_kobo);
      if (amountKobo !== null) refunds.push({ source: "cancellation", amountKobo });
    }
  }
  if (tableExists(input.database, "guest_period_payment_refunds")) {
    for (const row of offerScopedRows(
      input.database,
      { select: "t.amount_kobo AS amount_kobo", table: "guest_period_payment_refunds t" },
      tenantId,
      operatorIds,
    )) {
      const amountKobo = integer(row.amount_kobo);
      if (amountKobo !== null) refunds.push({ source: "period_payment", amountKobo });
    }
  }
  for (const transfer of manualTransfers ?? []) {
    if (transfer.refundOwedKobo !== null) refunds.push({ source: "manual_transfer_late_credit", amountKobo: transfer.refundOwedKobo });
  }

  const payables: PilotPayableRecord[] = input.ownerPayables.flatMap((item): PilotPayableRecord[] => {
    if (item.periods !== null) {
      return item.periods.map((period) => ({
        status: period.status,
        marginEarnedKobo: period.marginEarnedKobo,
        ownerPayableKobo: period.ownerPayableKobo,
        paidKobo: period.paidKobo,
        outstandingKobo: period.outstandingKobo,
      }));
    }
    const payable = item.payable;
    if (payable === null) return [];
    const earned = payable.status === "due" || payable.status === "paid" || payable.status === "overpaid";
    return [{
      status: payable.status,
      marginEarnedKobo: earned ? payable.marginKobo : 0,
      ownerPayableKobo: payable.ownerPayableKobo,
      paidKobo: payable.paidKobo,
      outstandingKobo: payable.outstandingKobo,
    }];
  });

  return buildPilotMetrics({
    requests,
    cardSessions,
    journeyRefunds,
    ...(manualTransfers === undefined ? {} : { manualTransfers }),
    ...(bankTransfers === undefined ? {} : { bankTransfers }),
    checkIns,
    refunds,
    payables,
    relocations,
    generatedAt,
  });
}

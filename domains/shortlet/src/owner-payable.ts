import { createHash, randomUUID } from "node:crypto";
import { ownerPayableDueAt } from "./checkin-support.js";
import { normalizeBankReference } from "./manual-transfer.js";
import type { OwnerSettlementSnapshot } from "./owner-terms.js";

/**
 * What the platform owes each owner (ADR 0089, B7). The owner payable and the margin are the confirmation snapshot
 * (P4); the ledger adds the cancellation policy outcome and the payouts you record. Status is evaluated against the
 * clock on every read, never stored (the due time passes without any event).
 */

export type OwnerPayableStatus = "not_yet_due" | "due" | "paused" | "paid" | "nothing_owed";

/** The cancellation policy outcome as the cancellation ledger port receives it (apps/web CancellationApplication). */
export interface OwnerPayableCancellation {
  readonly cancellationId: string;
  readonly reservationId: string;
  readonly liability: string;
  readonly refundKobo: number;
  readonly retainedCancellationBaseKobo: number;
  readonly postedAt: string;
}

export interface OwnerPayout {
  readonly payoutId: string;
  readonly reservationId: string;
  readonly amountKobo: number;
  /** The date you paid, YYYY-MM-DD in WAT. */
  readonly paidOn: string;
  /** Your bank or Paystack Transfers reference. Shown to you; never audited or logged (ADR 0075). */
  readonly reference: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface OwnerPayableProjection {
  /** The snapshot captured at confirmation (P4), never recalculated (ADR 0077). */
  readonly captured: { readonly ownerPayableKobo: number; readonly marginKobo: number };
  /** What the owner is owed after any cancellation policy outcome (ADR 0014, 0089). */
  readonly ownerPayableKobo: number;
  readonly marginKobo: number;
  readonly cancelled: boolean;
  readonly dueAt: string | null;
  readonly status: OwnerPayableStatus;
  readonly paidKobo: number;
  readonly outstandingKobo: number;
  readonly payouts: readonly OwnerPayout[];
  /** The version a payout form carries (ADR 0072). */
  readonly version: string;
}

export interface OwnerPayableInput {
  readonly settlement: OwnerSettlementSnapshot;
  /** When the protection window started (Verified Access), or null. */
  readonly protectionWindowStartsAt: string | null;
  readonly blockingComplaintOpen: boolean;
  readonly cancellation: OwnerPayableCancellation | null;
  readonly payouts: readonly OwnerPayout[];
  readonly now: Date;
}

/**
 * Decided 27 Sept 2026 (B7): after a cancellation the owner payable and the margin shrink by the fraction of the
 * Cancellation Base the policy kept (pro rata), and what remains is due when the outcome is posted, as no Verified
 * Access will follow. The margin is rounded down to whole kobo, as it is when quoted; the owner keeps the remainder.
 */
export function ownerShareAfterCancellation(settlement: Pick<OwnerSettlementSnapshot, "ownerPayableKobo" | "marginKobo">, retainedCancellationBaseKobo: number): { readonly ownerPayableKobo: number; readonly marginKobo: number } {
  const base = settlement.ownerPayableKobo + settlement.marginKobo;
  if (base <= 0) return { ownerPayableKobo: 0, marginKobo: 0 };
  const retained = Math.min(Math.max(0, retainedCancellationBaseKobo), base);
  const marginKobo = Math.floor((settlement.marginKobo * retained) / base);
  return { ownerPayableKobo: Math.min(settlement.ownerPayableKobo, retained - marginKobo), marginKobo };
}

export function projectOwnerPayable(input: OwnerPayableInput): OwnerPayableProjection {
  const captured = { ownerPayableKobo: input.settlement.ownerPayableKobo, marginKobo: input.settlement.marginKobo };
  const owed = input.cancellation ? ownerShareAfterCancellation(captured, input.cancellation.retainedCancellationBaseKobo) : captured;
  const paidKobo = input.payouts.reduce((sum, payout) => sum + payout.amountKobo, 0);
  const outstandingKobo = Math.max(0, owed.ownerPayableKobo - paidKobo);
  // ADR 0089: 24 hours after Verified Access with no Blocking Fulfilment Complaint open; after a cancellation, when posted.
  const dueAt = input.cancellation ? input.cancellation.postedAt
    : input.protectionWindowStartsAt && !input.blockingComplaintOpen ? ownerPayableDueAt(input.protectionWindowStartsAt) : null;
  const status: OwnerPayableStatus = owed.ownerPayableKobo === 0 ? "nothing_owed"
    : outstandingKobo === 0 ? "paid"
      : !input.cancellation && input.blockingComplaintOpen ? "paused"
        : dueAt !== null && input.now.getTime() >= Date.parse(dueAt) ? "due" : "not_yet_due";
  const version = createHash("sha256").update(JSON.stringify([status, dueAt, owed.ownerPayableKobo, input.payouts.map((payout) => payout.payoutId)])).digest("hex").slice(0, 16);
  return Object.freeze({
    captured: Object.freeze(captured),
    ownerPayableKobo: owed.ownerPayableKobo,
    marginKobo: owed.marginKobo,
    cancelled: input.cancellation !== null,
    dueAt,
    status,
    paidKobo,
    outstandingKobo,
    payouts: Object.freeze([...input.payouts]),
    version,
  });
}

export type OwnerPayoutProblem = "amount_required" | "date_required" | "reference_required" | "not_due" | "paused" | "already_paid" | "exceeds_due" | "reference_used" | "stale";

const OWNER_PAYOUT_MESSAGES: Readonly<Record<OwnerPayoutProblem, string>> = {
  amount_required: "Enter the amount paid in naira, for example 200,000",
  date_required: "Enter the date you paid, not later than today",
  reference_required: "Enter the payment reference from your bank or Paystack",
  not_due: "This owner payable is not due yet",
  paused: "This owner payable is paused while a Blocking Fulfilment Complaint is open",
  already_paid: "This owner payable is already paid",
  exceeds_due: "The amount is more than is due",
  reference_used: "That reference is already recorded for this booking with a different amount or date",
  stale: "This payable changed since you opened it",
};

export class OwnerPayoutError extends Error {
  constructor(readonly problem: OwnerPayoutProblem) { super(OWNER_PAYOUT_MESSAGES[problem]); this.name = "OwnerPayoutError"; }
  /** A problem with what was typed (400), rather than with the payable's state (409). */
  get isInput(): boolean { return this.problem === "amount_required" || this.problem === "date_required" || this.problem === "reference_required"; }
}

export interface OwnerPayableLedger {
  /** The cancellation ledger port (`LedgerPort` in apps/web CancellationApplication). Idempotent per cancellation. */
  postCancellation(input: { readonly cancellationId: string; readonly reservationId: string; readonly liability: string; readonly amountKobo: number; readonly retainedCancellationBaseKobo: number; readonly retainedCommissionKobo: number; readonly currency: "NGN" }): { readonly ledgerRecordId: string; readonly status: "posted" };
  findCancellation(reservationId: string): OwnerPayableCancellation | null;
  listPayouts(reservationId: string): readonly OwnerPayout[];
  /** Fails if the reservation already has a payout with this reference. */
  insertPayout(payout: OwnerPayout): void;
}

function lagosDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * B7 AC3: record a payout against a due payable. Refuses one not yet due or paused, more than is due, and paying
 * again once paid. A replay of the same reference, amount and date returns the recorded payout (ADR 0072).
 */
export function recordOwnerPayout(input: {
  readonly ledger: OwnerPayableLedger;
  readonly reservationId: string;
  readonly payable: OwnerPayableProjection;
  readonly basedOnVersion: string;
  readonly amountKobo: number | null;
  readonly paidOn: string;
  readonly reference: string;
  readonly recordedBy: string;
  readonly now: Date;
}): { readonly payout: OwnerPayout; readonly replayed: boolean } {
  const reference = normalizeBankReference(input.reference);
  if (input.amountKobo === null || !Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) throw new OwnerPayoutError("amount_required");
  if (!validDate(input.paidOn) || input.paidOn > lagosDate(input.now)) throw new OwnerPayoutError("date_required");
  if (reference === "") throw new OwnerPayoutError("reference_required");

  const earlier = input.payable.payouts.find((payout) => payout.reference === reference);
  if (earlier) {
    if (earlier.amountKobo === input.amountKobo && earlier.paidOn === input.paidOn) return { payout: earlier, replayed: true };
    throw new OwnerPayoutError("reference_used");
  }
  if (input.basedOnVersion !== input.payable.version) throw new OwnerPayoutError("stale");
  if (input.payable.status === "paid" || input.payable.status === "nothing_owed") throw new OwnerPayoutError("already_paid");
  if (input.payable.status === "paused") throw new OwnerPayoutError("paused");
  if (input.payable.status !== "due") throw new OwnerPayoutError("not_due");
  if (input.amountKobo > input.payable.outstandingKobo) throw new OwnerPayoutError("exceeds_due");

  const payout: OwnerPayout = Object.freeze({
    payoutId: `payout-${randomUUID()}`,
    reservationId: input.reservationId,
    amountKobo: input.amountKobo,
    paidOn: input.paidOn,
    reference,
    recordedAt: input.now.toISOString(),
    recordedBy: input.recordedBy,
  });
  input.ledger.insertPayout(payout);
  return { payout, replayed: false };
}

function isCancellationRow(value: unknown): value is { cancellation_id: string; reservation_id: string; liability: string; refund_kobo: number; retained_base_kobo: number; posted_at: string } {
  const row = value as Record<string, unknown> | undefined;
  return !!row && typeof row.cancellation_id === "string" && typeof row.reservation_id === "string" && typeof row.liability === "string"
    && typeof row.refund_kobo === "number" && typeof row.retained_base_kobo === "number" && typeof row.posted_at === "string";
}

function isPayoutRow(value: unknown): value is { payout_id: string; reservation_id: string; amount_kobo: number; paid_on: string; reference: string; recorded_at: string; recorded_by: string } {
  const row = value as Record<string, unknown> | undefined;
  return !!row && typeof row.payout_id === "string" && typeof row.reservation_id === "string" && typeof row.amount_kobo === "number"
    && typeof row.paid_on === "string" && typeof row.reference === "string" && typeof row.recorded_at === "string" && typeof row.recorded_by === "string";
}

/** The owner-payable ledger in the shared SQLite database, read fresh on every call (no cross-process cache). */
export class SqliteOwnerPayableLedger implements OwnerPayableLedger {
  readonly #database: import("node:sqlite").DatabaseSync;
  readonly #clock: () => Date;
  constructor(database: import("node:sqlite").DatabaseSync, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS owner_payable_cancellations (reservation_id TEXT PRIMARY KEY, cancellation_id TEXT NOT NULL UNIQUE, liability TEXT NOT NULL, refund_kobo INTEGER NOT NULL, retained_base_kobo INTEGER NOT NULL, posted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_payouts (payout_id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, amount_kobo INTEGER NOT NULL, paid_on TEXT NOT NULL, reference TEXT NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL, UNIQUE (reservation_id, reference));
      CREATE INDEX IF NOT EXISTS idx_owner_payouts_reservation ON owner_payouts (reservation_id, recorded_at);
    `);
  }
  postCancellation(input: Parameters<OwnerPayableLedger["postCancellation"]>[0]): { readonly ledgerRecordId: string; readonly status: "posted" } {
    // ADR 0072: a repeated post for the same cancellation keeps the first outcome.
    this.#database.prepare("INSERT INTO owner_payable_cancellations (reservation_id, cancellation_id, liability, refund_kobo, retained_base_kobo, posted_at) VALUES ($reservationId, $cancellationId, $liability, $refund, $retained, $postedAt) ON CONFLICT(reservation_id) DO NOTHING")
      .run({ $reservationId: input.reservationId, $cancellationId: input.cancellationId, $liability: input.liability, $refund: input.amountKobo, $retained: input.retainedCancellationBaseKobo, $postedAt: this.#clock().toISOString() });
    return { ledgerRecordId: `owner-payable:${input.cancellationId}`, status: "posted" };
  }
  findCancellation(reservationId: string): OwnerPayableCancellation | null {
    const row: unknown = this.#database.prepare("SELECT * FROM owner_payable_cancellations WHERE reservation_id = $id").get({ $id: reservationId });
    if (!isCancellationRow(row)) return null;
    return Object.freeze({ cancellationId: row.cancellation_id, reservationId: row.reservation_id, liability: row.liability, refundKobo: row.refund_kobo, retainedCancellationBaseKobo: row.retained_base_kobo, postedAt: row.posted_at });
  }
  listPayouts(reservationId: string): readonly OwnerPayout[] {
    const rows: unknown[] = this.#database.prepare("SELECT * FROM owner_payouts WHERE reservation_id = $id ORDER BY recorded_at, payout_id").all({ $id: reservationId });
    return rows.filter(isPayoutRow).map((row) => Object.freeze({ payoutId: row.payout_id, reservationId: row.reservation_id, amountKobo: row.amount_kobo, paidOn: row.paid_on, reference: row.reference, recordedAt: row.recorded_at, recordedBy: row.recorded_by }));
  }
  insertPayout(payout: OwnerPayout): void {
    this.#database.prepare("INSERT INTO owner_payouts (payout_id, reservation_id, amount_kobo, paid_on, reference, recorded_at, recorded_by) VALUES ($id, $reservationId, $amount, $paidOn, $reference, $recordedAt, $recordedBy)")
      .run({ $id: payout.payoutId, $reservationId: payout.reservationId, $amount: payout.amountKobo, $paidOn: payout.paidOn, $reference: payout.reference, $recordedAt: payout.recordedAt, $recordedBy: payout.recordedBy });
  }
}

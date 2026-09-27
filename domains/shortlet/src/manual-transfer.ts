import { createHash, randomBytes } from "node:crypto";
import type { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import type { ConditionalBookingOffer } from "./conditional-offer.js";
import type { LivePaymentAttemptRegistryPort } from "./payment-attempt.js";
import type { BookingContract, Reservation } from "./card-payment.js";
import type { BookingStateRepository } from "./booking-state.js";

/**
 * Manual bank transfer with receipt upload (ADR 0090, P5). The Guest pays the business account and uploads a
 * receipt; the receipt is evidence only. The booking confirms only when a back-office user verifies the matching
 * credit (B6). Receipts are stored in the database (outside any web root), never logged, and deleted 90 days after
 * the stay's checkout or, when no booking formed, 90 days after the attempt.
 */

/** ADR 0090: the one fixed business account. Configuration, never code. */
export interface ManualTransferAccount {
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
}

/** ADR 0090: dates stay held for up to 60 minutes after the Payment Window deadline while the credit is checked. */
export const MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES = 60;
/** ADR 0090: the whole timeline must fit inside 8:00 AM–8:00 PM WAT. Minutes after midnight, Africa/Lagos. */
export const MANUAL_TRANSFER_HOURS_WAT = Object.freeze({ opensAtMinutes: 8 * 60, closesAtMinutes: 20 * 60 });
/** ADR 0090: receipts are deleted 90 days after the stay (or after the attempt when no booking formed). */
export const RECEIPT_RETENTION_DAYS = 90;
/** ADR 0090: images or PDF. Checked against the file's own bytes, not the declared type. */
export const RECEIPT_CONTENT_TYPES = Object.freeze(["image/jpeg", "image/png", "application/pdf"] as const);
export type ReceiptContentType = typeof RECEIPT_CONTENT_TYPES[number];

export type ManualTransferStatus = "awaiting_receipt" | "awaiting_verification" | "confirmed" | "rejected" | "expired";

export interface ManualTransferReceipt {
  readonly receiptId: string;
  readonly contentType: ReceiptContentType;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
}

export interface ManualTransfer {
  readonly transferId: string;
  readonly offerId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly unitId: string;
  readonly payerId: string;
  /** The unique reference the Guest must include with the transfer (ADR 0090). */
  readonly bookingReference: string;
  readonly amountKobo: number;
  readonly currency: "NGN";
  readonly account: ManualTransferAccount;
  readonly startedAt: string;
  /** The Payment Window deadline: transfer and upload by then (ADR 0044). */
  readonly paymentDeadlineAt: string;
  /** Payment Window deadline + 60 minutes: the back office must verify by then (ADR 0090). */
  readonly verificationDeadlineAt: string;
  readonly stayCheckOut: string;
  readonly status: ManualTransferStatus;
  readonly receipt?: ManualTransferReceipt;
  readonly version: number;
  readonly closedAt?: string;
  readonly receiptDeletedAt?: string;
  /** Set by the back office (B6). */
  readonly decision?: ManualTransferDecision;
  /** B6 AC4, ADR 0045: money that arrived after the transfer closed; owed back to the Guest in full. */
  readonly refundOwed?: { readonly bankTransactionReference: string; readonly amountReceivedKobo: number; readonly recordedAt: string; readonly recordedBy: string };
}

export type ManualTransferRejectionReason = "not_received" | "amount_mismatch";
export type ManualTransferDecision =
  | { readonly kind: "confirmed"; readonly bankTransactionReference: string; readonly amountReceivedKobo: number; readonly decidedAt: string; readonly decidedBy: string; readonly reservationId: string; readonly contractId: string }
  | { readonly kind: "rejected"; readonly reason: ManualTransferRejectionReason; readonly decidedAt: string; readonly decidedBy: string };

export type ManualTransferProblem =
  | "not_offered"
  | "not_configured"
  | "not_payer"
  | "offer_not_accepted"
  | "payment_window_closed"
  | "slot_taken"
  | "no_transfer"
  | "receipt_already_uploaded"
  | "receipt_type_not_allowed"
  | "receipt_too_large"
  | "receipt_empty"
  | "no_receipt"
  | "stale"
  | "already_confirmed"
  | "already_rejected"
  | "expired"
  | "bank_reference_required"
  | "bank_reference_used"
  | "amount_required"
  | "amount_mismatch"
  | "dates_released"
  | "reason_required"
  | "not_closed"
  | "refund_already_recorded";

/** A manual transfer command was refused. Nothing was recorded. */
export class ManualTransferError extends Error {
  constructor(readonly problem: ManualTransferProblem, message: string) { super(message); this.name = "ManualTransferError"; }
}

export interface ManualTransferStore {
  save(transfer: ManualTransfer): void;
  find(transferId: string): ManualTransfer | null;
  findLatestByOffer(offerId: string): ManualTransfer | null;
  list(): readonly ManualTransfer[];
  saveReceipt(receiptId: string, transferId: string, contentType: ReceiptContentType, bytes: Buffer): void;
  readReceipt(receiptId: string): { readonly contentType: ReceiptContentType; readonly bytes: Buffer } | null;
  deleteReceipt(receiptId: string): void;
}

function parseTransfer(json: string): ManualTransfer | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return typeof record.transferId === "string" && typeof record.offerId === "string" && typeof record.status === "string" ? parsed as ManualTransfer : null;
  } catch { return null; }
}

function isReceiptContentType(value: unknown): value is ReceiptContentType {
  return typeof value === "string" && (RECEIPT_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Manual transfers and their receipts in the shared SQLite database; the receipt bytes never leave it except to the back office. */
export class SqliteManualTransferStore implements ManualTransferStore {
  readonly #database: import("node:sqlite").DatabaseSync;
  constructor(database: import("node:sqlite").DatabaseSync) {
    this.#database = database;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS manual_transfers (transfer_id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, booking_reference TEXT NOT NULL UNIQUE, seq INTEGER NOT NULL, transfer_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_manual_transfers_offer ON manual_transfers (offer_id, seq);
      CREATE TABLE IF NOT EXISTS manual_transfer_receipts (receipt_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL);
    `);
  }
  save(transfer: ManualTransfer): void {
    const existing = this.#database.prepare("SELECT seq FROM manual_transfers WHERE transfer_id = $id").get({ $id: transfer.transferId }) as { seq?: number } | undefined;
    const seq = existing?.seq ?? (this.#database.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM manual_transfers").get() as { next: number }).next;
    this.#database.prepare("INSERT INTO manual_transfers (transfer_id, offer_id, booking_reference, seq, transfer_json) VALUES ($id, $offerId, $reference, $seq, $json) ON CONFLICT(transfer_id) DO UPDATE SET transfer_json = excluded.transfer_json").run({ $id: transfer.transferId, $offerId: transfer.offerId, $reference: transfer.bookingReference, $seq: seq, $json: JSON.stringify(transfer) });
  }
  find(transferId: string): ManualTransfer | null {
    const row = this.#database.prepare("SELECT transfer_json FROM manual_transfers WHERE transfer_id = $id").get({ $id: transferId }) as { transfer_json?: string } | undefined;
    return row?.transfer_json ? parseTransfer(row.transfer_json) : null;
  }
  findLatestByOffer(offerId: string): ManualTransfer | null {
    const row = this.#database.prepare("SELECT transfer_json FROM manual_transfers WHERE offer_id = $offerId ORDER BY seq DESC LIMIT 1").get({ $offerId: offerId }) as { transfer_json?: string } | undefined;
    return row?.transfer_json ? parseTransfer(row.transfer_json) : null;
  }
  list(): readonly ManualTransfer[] {
    const rows = this.#database.prepare("SELECT transfer_json FROM manual_transfers ORDER BY seq").all() as { transfer_json: string }[];
    return rows.flatMap((row) => { const transfer = parseTransfer(row.transfer_json); return transfer ? [transfer] : []; });
  }
  saveReceipt(receiptId: string, transferId: string, contentType: ReceiptContentType, bytes: Buffer): void {
    this.#database.prepare("INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, bytes) VALUES ($id, $transferId, $type, $bytes)").run({ $id: receiptId, $transferId: transferId, $type: contentType, $bytes: bytes });
  }
  readReceipt(receiptId: string): { readonly contentType: ReceiptContentType; readonly bytes: Buffer } | null {
    const row = this.#database.prepare("SELECT content_type, bytes FROM manual_transfer_receipts WHERE receipt_id = $id").get({ $id: receiptId }) as { content_type?: unknown; bytes?: unknown } | undefined;
    if (!row || !isReceiptContentType(row.content_type) || !(row.bytes instanceof Uint8Array)) return null;
    return { contentType: row.content_type, bytes: Buffer.from(row.bytes) };
  }
  deleteReceipt(receiptId: string): void {
    this.#database.prepare("DELETE FROM manual_transfer_receipts WHERE receipt_id = $id").run({ $id: receiptId });
  }
}

/** The receipt's real type from its first bytes; the declared type is ignored (ADR 0075: untrusted input). */
export function sniffReceiptType(bytes: Buffer): ReceiptContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

function watMinutes(iso: string): { readonly date: string; readonly minutes: number } {
  // Africa/Lagos is UTC+1 with no daylight saving.
  const shifted = new Date(Date.parse(iso) + 60 * 60_000);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + (shifted.getUTCSeconds() > 0 || shifted.getUTCMilliseconds() > 0 ? 1 : 0) };
}

/** Payment Window start, from the offer's own deadline and duration (ADR 0044); never recalculated from the clock. */
function paymentWindowStart(offer: ConditionalBookingOffer): string {
  return new Date(Date.parse(offer.paymentWindow.expiresAt) - offer.paymentWindow.durationMinutes * 60_000).toISOString();
}

export function manualTransferVerificationDeadline(paymentDeadlineIso: string): string {
  return new Date(Date.parse(paymentDeadlineIso) + MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES * 60_000).toISOString();
}

/**
 * ADR 0090: offered only when the 20-minute Payment Window plus the 60-minute verification hold fits inside
 * 8:00 AM–8:00 PM WAT on one day.
 */
export function manualTransferFitsBusinessHours(offer: ConditionalBookingOffer): boolean {
  const start = watMinutes(paymentWindowStart(offer));
  const end = watMinutes(manualTransferVerificationDeadline(offer.paymentWindow.expiresAt));
  return start.date === end.date && start.minutes >= MANUAL_TRANSFER_HOURS_WAT.opensAtMinutes && end.minutes <= MANUAL_TRANSFER_HOURS_WAT.closesAtMinutes;
}

/** A booking reference the Guest can type into a banking app: "SL-" and eight unambiguous characters. */
function newBookingReference(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  return `SL-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}

export interface ManualTransferManagerOptions {
  readonly offerManager: { getOffer(offerId: string): ConditionalBookingOffer };
  readonly store: ManualTransferStore;
  /** Null when no business account is configured: manual transfer is then never offered. */
  readonly account: ManualTransferAccount | null;
  readonly liveAttempts?: LivePaymentAttemptRegistryPort;
  readonly calendar?: {
    releasePaymentPending?(commitmentId: string, options?: { clock?: () => Date }): void;
    holdPaymentPendingUntil?(commitmentId: string, expiresAt: string, options?: { clock?: () => Date }): void;
  };
  readonly audit?: { record(entry: Record<string, unknown>): void };
  /** ADR 0090: "a configured size limit". Only the Guest side uploads, so the back office may omit it. */
  readonly receiptMaxBytes?: number;
  /** B6: what confirming a verified transfer writes. Only the back office composes it. */
  readonly bookings?: {
    readonly bookingState: BookingStateRepository;
    readonly snapshots: { saveBookingSnapshot(snapshot: { reservationId: string; contractId: string; offerId: string; reservationJson: string; contractJson: string; confirmedAt: string }): void };
    readonly calendar: {
      transitionPaymentPendingToConfirmedBooking(input: { commitmentId: string; unitId: string; start: string; end: string; clock: () => Date }): unknown;
      releaseConfirmedBooking?(input: { commitmentId: string; unitId: string; start: string; end: string; clock: () => Date }): void;
    };
  };
}

/** A bank transaction reference as written on a statement: trimmed, spaces collapsed, upper case; "" when unusable. */
export function normalizeBankReference(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return /^[A-Z0-9][A-Z0-9 /._-]{3,63}$/.test(normalized) ? normalized : "";
}

export class ManualTransferManager {
  readonly #o: ManualTransferManagerOptions;

  constructor(options: ManualTransferManagerOptions) {
    if (!options.offerManager || !options.store) throw new Error("offerManager and store are required");
    if (options.receiptMaxBytes !== undefined && (!Number.isSafeInteger(options.receiptMaxBytes) || options.receiptMaxBytes <= 0)) throw new Error("receiptMaxBytes must be a positive whole number");
    this.#o = options;
  }

  /** Whether the Guest may choose manual transfer for this offer now. */
  isOffered(offerId: string, now: Date): boolean {
    if (!this.#o.account) return false;
    let offer: ConditionalBookingOffer;
    try { offer = this.#o.offerManager.getOffer(offerId); } catch { return false; }
    return offer.status === "accepted" && now.getTime() < Date.parse(offer.paymentWindow.expiresAt) && manualTransferFitsBusinessHours(offer);
  }

  /**
   * Starts a manual transfer: it takes the booking's single Live Payment Attempt (ADR 0046, 0090) and issues the
   * booking reference. Starting again returns the same transfer.
   */
  start(envelope: PlatformCommandEnvelope<{ offerId: string }>, clock: () => Date = () => new Date()): ManualTransfer {
    if (!envelope || envelope.commandName !== "manual_transfer.start" || Object.keys(envelope.payload ?? {}).length !== 1) throw new Error("Invalid manual transfer command");
    const now = clock();
    const offer = this.#o.offerManager.getOffer(envelope.payload.offerId);
    const payerId = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
    if (envelope.principal.role !== "guest" || !envelope.principal.id || envelope.principal.id !== payerId || !offer.tenantId || envelope.principal.tenantId !== offer.tenantId) throw new ManualTransferError("not_payer", "Only the authoritative payer can start a manual transfer");
    const existing = this.current(offer.offerId, now);
    if (existing && (existing.status === "awaiting_receipt" || existing.status === "awaiting_verification")) return existing;
    if (!this.#o.account) throw new ManualTransferError("not_configured", "Manual transfer is not configured");
    if (offer.status !== "accepted") throw new ManualTransferError("offer_not_accepted", "Manual transfer requires an accepted offer");
    if (now.getTime() >= Date.parse(offer.paymentWindow.expiresAt)) throw new ManualTransferError("payment_window_closed", "The Payment Window has closed");
    if (!manualTransferFitsBusinessHours(offer)) throw new ManualTransferError("not_offered", "Manual transfer is only offered when verification fits inside 8:00 AM–8:00 PM WAT");
    const holder = this.#o.liveAttempts?.current(offer.offerId, now);
    if (holder) throw new ManualTransferError("slot_taken", `A live ${holder.method} payment attempt already owns this offer`);
    const amountKobo = typeof offer.quote?.allInStayTotalKobo === "number" ? offer.quote.allInStayTotalKobo : offer.totalAmountDueNowKobo;
    const transferId = `mtr_${createHash("sha256").update(`${offer.offerId}:${envelope.commandId}`).digest("hex").slice(0, 16)}`;
    const transfer: ManualTransfer = {
      transferId, offerId: offer.offerId, requestId: offer.requestId, tenantId: offer.tenantId, operatorId: offer.parties.operator.id, unitId: offer.unitId, payerId,
      bookingReference: newBookingReference(), amountKobo, currency: "NGN", account: { ...this.#o.account },
      startedAt: now.toISOString(), paymentDeadlineAt: offer.paymentWindow.expiresAt, verificationDeadlineAt: manualTransferVerificationDeadline(offer.paymentWindow.expiresAt),
      stayCheckOut: offer.dates.checkOut, status: "awaiting_receipt", version: 1,
    };
    this.#o.liveAttempts?.acquire({ offerId: offer.offerId, method: "manual_transfer", purpose: "stay", attemptId: transferId, startedAt: now.toISOString(), expiresAt: transfer.paymentDeadlineAt });
    this.#o.store.save(transfer);
    this.#o.audit?.record({ type: "manual_transfer.started", transferId, offerId: offer.offerId, startedAt: transfer.startedAt });
    return transfer;
  }

  /**
   * Stores one receipt before the Payment Window deadline. The receipt is evidence only (ADR 0090): the booking now
   * waits for the back office, and the dates stay held until the verification deadline.
   */
  uploadReceipt(envelope: PlatformCommandEnvelope<{ offerId: string }>, file: { readonly bytes: Buffer }, clock: () => Date = () => new Date()): ManualTransfer {
    if (!envelope || envelope.commandName !== "manual_transfer.upload_receipt" || Object.keys(envelope.payload ?? {}).length !== 1) throw new Error("Invalid receipt upload command");
    const now = clock();
    const offer = this.#o.offerManager.getOffer(envelope.payload.offerId);
    const transfer = this.current(offer.offerId, now);
    if (!transfer || envelope.principal.role !== "guest" || envelope.principal.id !== transfer.payerId || envelope.principal.tenantId !== transfer.tenantId) throw new ManualTransferError(transfer ? "not_payer" : "no_transfer", "No manual transfer for this Guest");
    if (transfer.status === "expired") throw new ManualTransferError("payment_window_closed", "The Payment Window has closed");
    if (transfer.status !== "awaiting_receipt") throw new ManualTransferError("receipt_already_uploaded", "A receipt was already uploaded");
    if (file.bytes.length === 0) throw new ManualTransferError("receipt_empty", "The receipt file is empty");
    if (this.#o.receiptMaxBytes === undefined) throw new Error("Receipt uploads are not composed here");
    if (file.bytes.length > this.#o.receiptMaxBytes) throw new ManualTransferError("receipt_too_large", "The receipt file is too large");
    const contentType = sniffReceiptType(file.bytes);
    if (!contentType) throw new ManualTransferError("receipt_type_not_allowed", "Upload a JPEG, PNG or PDF receipt");
    const receiptId = `rcpt_${randomBytes(12).toString("hex")}`;
    const updated: ManualTransfer = { ...transfer, status: "awaiting_verification", receipt: { receiptId, contentType, sizeBytes: file.bytes.length, uploadedAt: now.toISOString() }, version: transfer.version + 1 };
    // ADR 0090: the verification hold replaces the Payment-Processing Grace for this method. The calendar can refuse
    // (the block already lapsed), so it goes first and nothing is stored on a refusal.
    try { this.#o.calendar?.holdPaymentPendingUntil?.(offer.inventoryCommitmentId, updated.verificationDeadlineAt, { clock: () => now }); }
    catch { throw new ManualTransferError("payment_window_closed", "The dates are no longer held for this booking"); }
    this.#o.store.saveReceipt(receiptId, transfer.transferId, contentType, file.bytes);
    this.#o.store.save(updated);
    // The attempt keeps the single slot through the verification deadline (ADR 0046).
    this.#o.liveAttempts?.release(offer.offerId);
    this.#o.liveAttempts?.acquire({ offerId: offer.offerId, method: "manual_transfer", purpose: "stay", attemptId: `${transfer.transferId}:hold`, startedAt: now.toISOString(), expiresAt: updated.verificationDeadlineAt });
    // ADR 0075: ids, sizes and times only; never the receipt or its file name.
    this.#o.audit?.record({ type: "manual_transfer.receipt_uploaded", transferId: transfer.transferId, offerId: offer.offerId, receiptId, sizeBytes: file.bytes.length, uploadedAt: now.toISOString() });
    return updated;
  }

  /**
   * The offer's latest manual transfer, with deadlines evaluated lazily against the clock: no receipt by the
   * Payment Window deadline, or no verification by the verification deadline, expires it and releases the dates.
   */
  current(offerId: string, now: Date): ManualTransfer | null {
    const transfer = this.#o.store.findLatestByOffer(offerId);
    return transfer ? this.#expireIfDue(transfer, now) : null;
  }

  find(transferId: string, now: Date): ManualTransfer | null {
    const transfer = this.#o.store.find(transferId);
    return transfer ? this.#expireIfDue(transfer, now) : null;
  }

  list(now: Date): readonly ManualTransfer[] {
    return this.#o.store.list().map((transfer) => this.#expireIfDue(transfer, now));
  }

  #expireIfDue(transfer: ManualTransfer, now: Date): ManualTransfer {
    const due = transfer.status === "awaiting_receipt" ? transfer.paymentDeadlineAt : transfer.status === "awaiting_verification" ? transfer.verificationDeadlineAt : null;
    if (due === null || now.getTime() < Date.parse(due)) return transfer;
    const expired: ManualTransfer = { ...transfer, status: "expired", closedAt: due, version: transfer.version + 1 };
    try {
      const offer = this.#o.offerManager.getOffer(transfer.offerId);
      this.#o.calendar?.releasePaymentPending?.(offer.inventoryCommitmentId, { clock: () => now });
    } catch { /* the release is retried by the calendar's own expiry */ }
    if (this.#o.liveAttempts?.current(transfer.offerId, now)?.method === "manual_transfer") this.#o.liveAttempts.release(transfer.offerId);
    this.#o.store.save(expired);
    this.#o.audit?.record({ type: "manual_transfer.expired", transferId: transfer.transferId, offerId: transfer.offerId, fromStatus: transfer.status, expiredAt: due });
    return expired;
  }

  /** The receipt for the back office only; callers must hold a grant for the owner (ADR 0090). */
  readReceipt(transfer: ManualTransfer): { readonly contentType: ReceiptContentType; readonly bytes: Buffer } | null {
    return transfer.receipt && !transfer.receiptDeletedAt ? this.#o.store.readReceipt(transfer.receipt.receiptId) : null;
  }

  /**
   * ADR 0090 retention: receipts are deleted 90 days after the stay's checkout for a confirmed booking, or 90 days
   * after the attempt when no booking formed. Safe to call on every read.
   */
  purgeReceipts(now: Date): number {
    let deleted = 0;
    for (const transfer of this.#o.store.list()) {
      if (!transfer.receipt || transfer.receiptDeletedAt) continue;
      // Checkout is 11:00 WAT (ADR 0032), i.e. 10:00 UTC on the checkout date.
      const anchor = transfer.status === "confirmed" ? `${transfer.stayCheckOut}T10:00:00.000Z` : transfer.status === "awaiting_receipt" || transfer.status === "awaiting_verification" ? null : transfer.closedAt ?? transfer.startedAt;
      if (anchor === null || now.getTime() < Date.parse(anchor) + RECEIPT_RETENTION_DAYS * 24 * 60 * 60_000) continue;
      this.#o.store.deleteReceipt(transfer.receipt.receiptId);
      this.#o.store.save({ ...transfer, receiptDeletedAt: now.toISOString(), version: transfer.version + 1 });
      this.#o.audit?.record({ type: "manual_transfer.receipt_deleted", transferId: transfer.transferId, receiptId: transfer.receipt.receiptId, deletedAt: now.toISOString() });
      deleted += 1;
    }
    return deleted;
  }


  /**
   * B6, ADR 0090: a back-office user confirms only after seeing the matching credit in the business account. The
   * received amount must equal the booking amount exactly; a bank transaction reference confirms at most one
   * booking; a transfer confirms once (ADR 0072). The receipt never confirms anything by itself.
   */
  confirm(transferId: string, staffId: string, input: { readonly bankTransactionReference: string; readonly amountReceivedKobo: number; readonly expectedVersion: number }, clock: () => Date = () => new Date()): ManualTransfer {
    const now = clock();
    const transfer = this.#decidable(transferId, input.expectedVersion, now);
    const reference = normalizeBankReference(input.bankTransactionReference);
    if (!reference) throw new ManualTransferError("bank_reference_required", "Enter the bank transaction reference from your statement");
    if (!Number.isSafeInteger(input.amountReceivedKobo) || input.amountReceivedKobo <= 0) throw new ManualTransferError("amount_required", "Enter the amount received");
    if (input.amountReceivedKobo !== transfer.amountKobo) throw new ManualTransferError("amount_mismatch", "The amount received does not match the booking amount exactly");
    if (this.#o.store.list().some((other) => other.decision?.kind === "confirmed" && normalizeBankReference(other.decision.bankTransactionReference) === reference)) {
      throw new ManualTransferError("bank_reference_used", "This bank transaction reference already confirmed another booking");
    }
    const bookings = this.#o.bookings;
    if (!bookings) throw new Error("Booking confirmation is not composed");
    const offer = this.#o.offerManager.getOffer(transfer.offerId);
    const reservationId = `res_mtr_${createHash("sha256").update(transfer.transferId).digest("hex").slice(0, 12)}`;
    const contractId = `ctr_mtr_${createHash("sha256").update(transfer.transferId).digest("hex").slice(0, 12)}`;
    const reservation: Reservation = { reservationId, contractId, unitId: offer.unitId, primaryGuestId: offer.parties.primaryGuest.id, dates: { checkIn: offer.dates.checkIn, checkOut: offer.dates.checkOut }, status: "confirmed", confirmedAt: now.toISOString(), inventoryCommitmentId: offer.inventoryCommitmentId };
    const contract: BookingContract = {
      contractId, reservationId, offerId: offer.offerId, unitId: offer.unitId, tenantId: offer.tenantId, parties: offer.parties, dates: offer.dates, occupants: offer.occupants, quote: offer.quote, totalAmountDueNowKobo: offer.totalAmountDueNowKobo,
      policies: offer.policies, disclosures: offer.disclosures,
      paymentDetails: { paymentMethod: "bank_transfer", channel: "manual_transfer", transferReference: reference, amountKobo: input.amountReceivedKobo, currency: "NGN", paidAt: now.toISOString() },
      createdAt: now.toISOString(), contractVersion: 1, checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" },
      ...(offer.checkInWindow ? { checkInWindow: offer.checkInWindow } : {}),
      financialSummary: { originalBookingTotalKobo: offer.totalAmountDueNowKobo, currentContractTotalKobo: offer.totalAmountDueNowKobo, currency: "NGN", amendmentAdjustments: [] },
    };
    // Race-safe: either the dates move to a confirmed booking and the records commit, or nothing does (ADR 0045).
    try { bookings.calendar.transitionPaymentPendingToConfirmedBooking({ commitmentId: offer.inventoryCommitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => now }); }
    catch { throw new ManualTransferError("dates_released", "The dates are no longer held for this booking"); }
    try {
      bookings.bookingState.saveBookingAtomically({ contract, reservation });
      bookings.snapshots.saveBookingSnapshot({ reservationId, contractId, offerId: offer.offerId, reservationJson: JSON.stringify(reservation), contractJson: JSON.stringify(contract), confirmedAt: reservation.confirmedAt });
    } catch (error) {
      try { bookings.calendar.releaseConfirmedBooking?.({ commitmentId: offer.inventoryCommitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => now }); } catch { /* reconciliation picks this up */ }
      try { bookings.bookingState.removeBookingAtomically({ contractId, reservationId }); } catch { /* reconciliation picks this up */ }
      throw error;
    }
    const decided = this.saveDecision(transfer, "confirmed", { kind: "confirmed", bankTransactionReference: reference, amountReceivedKobo: input.amountReceivedKobo, decidedAt: now.toISOString(), decidedBy: staffId, reservationId, contractId });
    this.#releaseSlot(transfer.offerId, now);
    // ADR 0075: ids and times only; the bank reference stays on the transfer record, never in the audit.
    this.#o.audit?.record({ type: "manual_transfer.confirmed", transferId, offerId: transfer.offerId, reservationId, decidedBy: staffId, decidedAt: now.toISOString() });
    return decided;
  }

  /** B6, ADR 0090: the money didn't arrive or doesn't match. Releases the dates; no Reservation is made. */
  reject(transferId: string, staffId: string, input: { readonly reason: string; readonly expectedVersion: number }, clock: () => Date = () => new Date()): ManualTransfer {
    const now = clock();
    if (input.reason !== "not_received" && input.reason !== "amount_mismatch") throw new ManualTransferError("reason_required", "Choose Not received or Amount doesn't match");
    const transfer = this.#decidable(transferId, input.expectedVersion, now);
    try {
      const offer = this.#o.offerManager.getOffer(transfer.offerId);
      this.#o.calendar?.releasePaymentPending?.(offer.inventoryCommitmentId, { clock: () => now });
    } catch { /* already released */ }
    const decided = this.saveDecision(transfer, "rejected", { kind: "rejected", reason: input.reason, decidedAt: now.toISOString(), decidedBy: staffId });
    this.#releaseSlot(transfer.offerId, now);
    this.#o.audit?.record({ type: "manual_transfer.rejected", transferId, offerId: transfer.offerId, reasonCode: input.reason, decidedBy: staffId, decidedAt: now.toISOString() });
    return decided;
  }

  /**
   * B6 AC4, ADR 0045: money that arrives for a transfer that expired or was rejected never confirms the booking; it
   * is recorded as a full refund owed to the Guest.
   */
  recordLateCredit(transferId: string, staffId: string, input: { readonly bankTransactionReference: string; readonly amountReceivedKobo: number; readonly expectedVersion: number }, clock: () => Date = () => new Date()): ManualTransfer {
    const now = clock();
    const transfer = this.find(transferId, now);
    if (!transfer) throw new ManualTransferError("no_transfer", "Manual transfer not found");
    if (transfer.version !== input.expectedVersion) throw new ManualTransferError("stale", "This transfer changed since you opened it");
    if (transfer.status !== "expired" && transfer.status !== "rejected") throw new ManualTransferError("not_closed", "Only money for an expired or declined transfer is recorded for refund");
    if (transfer.refundOwed) throw new ManualTransferError("refund_already_recorded", "A refund is already recorded for this transfer");
    const reference = normalizeBankReference(input.bankTransactionReference);
    if (!reference) throw new ManualTransferError("bank_reference_required", "Enter the bank transaction reference from your statement");
    if (!Number.isSafeInteger(input.amountReceivedKobo) || input.amountReceivedKobo <= 0) throw new ManualTransferError("amount_required", "Enter the amount received");
    const updated: ManualTransfer = { ...transfer, refundOwed: { bankTransactionReference: reference, amountReceivedKobo: input.amountReceivedKobo, recordedAt: now.toISOString(), recordedBy: staffId }, version: transfer.version + 1 };
    this.#o.store.save(updated);
    this.#o.audit?.record({ type: "manual_transfer.late_credit_recorded", transferId, offerId: transfer.offerId, recordedBy: staffId, recordedAt: now.toISOString() });
    return updated;
  }

  #decidable(transferId: string, expectedVersion: number, now: Date): ManualTransfer {
    const transfer = this.find(transferId, now);
    if (!transfer) throw new ManualTransferError("no_transfer", "Manual transfer not found");
    if (transfer.status === "confirmed") throw new ManualTransferError("already_confirmed", "This transfer is already confirmed");
    if (transfer.status === "rejected") throw new ManualTransferError("already_rejected", "This transfer was already declined");
    if (transfer.status === "expired") throw new ManualTransferError("expired", "This transfer expired before it was verified; any money received is refunded in full");
    if (transfer.status !== "awaiting_verification") throw new ManualTransferError("no_receipt", "The Guest has not uploaded a receipt yet");
    if (transfer.version !== expectedVersion) throw new ManualTransferError("stale", "This transfer changed since you opened it");
    return transfer;
  }

  #releaseSlot(offerId: string, now: Date): void {
    if (this.#o.liveAttempts?.current(offerId, now)?.method === "manual_transfer") this.#o.liveAttempts.release(offerId);
  }

  /** Persists a back-office decision (B6). */
  saveDecision(transfer: ManualTransfer, status: "confirmed" | "rejected", decision: ManualTransferDecision): ManualTransfer {
    const updated: ManualTransfer = { ...transfer, status, decision, closedAt: decision.decidedAt, version: transfer.version + 1 };
    this.#o.store.save(updated);
    return updated;
  }
}

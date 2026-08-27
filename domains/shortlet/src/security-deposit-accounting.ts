import { createHash } from "node:crypto";
import type { SecurityDepositPolicySnapshot } from "./security-deposit.js";

export type SecurityDepositCollectionStatus = "awaiting_payment" | "collected_unbound" | "held" | "refund_pending" | "refunded" | "reconciliation_required";
export interface SecurityDepositJournalLine { readonly account: "security_deposit_payment_clearing" | "refundable_security_deposit_liability"; readonly side: "debit" | "credit"; readonly amountKobo: number; readonly currency: "NGN"; }
export interface SecurityDepositJournal { readonly journalId: string; readonly collectionId: string; readonly lines: readonly SecurityDepositJournalLine[]; readonly balanced: true; readonly createdAt: string; }
export interface SecurityDepositCollectionRecord {
  readonly collectionId: string; readonly offerId: string; readonly reservationId?: string; readonly contractId?: string;
  readonly policyVersion: string; readonly amountKobo: number; readonly currency: "NGN"; readonly paymentMethod: "fresh_card" | "bank_transfer";
  readonly providerReference: string; readonly capabilityVersion: string; readonly collectionVersion: number; readonly status: SecurityDepositCollectionStatus;
  readonly collectedAt?: string; readonly refundedAt?: string; readonly collectionJournalId?: string; readonly refundJournalId?: string;
}
export interface HeldSecurityDeposit { readonly collectionId: string; readonly collectionVersion: number; readonly reservationId: string; readonly policyVersion: string; readonly amountKobo: number; readonly refundableBalanceKobo: number; readonly status: "held" | "refunded" | "reconciliation_required"; readonly currency: "NGN"; }
export interface HeldSecurityDepositSource { getByReservationId(reservationId: string): HeldSecurityDeposit | null; }
function validAmount(n: number): boolean { return Number.isInteger(n) && n >= 0; }
export function createSecurityDepositJournal(input: { collectionId: string; amountKobo: number; direction: "collection" | "refund"; createdAt: string }): SecurityDepositJournal {
  if (!validAmount(input.amountKobo) || input.amountKobo === 0) throw new RangeError("Deposit journal amount must be a positive integer kobo amount");
  const debit = input.direction === "collection" ? "security_deposit_payment_clearing" : "refundable_security_deposit_liability";
  const credit = input.direction === "collection" ? "refundable_security_deposit_liability" : "security_deposit_payment_clearing";
  const lines: readonly SecurityDepositJournalLine[] = Object.freeze([{ account: debit as SecurityDepositJournalLine["account"], side: "debit" as const, amountKobo: input.amountKobo, currency: "NGN" as const }, { account: credit as SecurityDepositJournalLine["account"], side: "credit" as const, amountKobo: input.amountKobo, currency: "NGN" as const }]);
  return Object.freeze({ journalId: `security-deposit-journal:${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`, collectionId: input.collectionId, lines, balanced: true as const, createdAt: input.createdAt });
}
export interface SecurityDepositAccountingRepository extends HeldSecurityDepositSource {
  createOrGet(input: { offerId: string; snapshot: SecurityDepositPolicySnapshot; paymentMethod: "fresh_card" | "bank_transfer"; providerReference: string; capabilityVersion: string }): SecurityDepositCollectionRecord;
  recordCollection(collectionId: string, collectedAt: string): SecurityDepositCollectionRecord;
  bind(collectionId: string, input: { reservationId: string; contractId: string }): SecurityDepositCollectionRecord;
  refund(collectionId: string, input: { refundedAt: string; refundSucceeded: boolean }): SecurityDepositCollectionRecord;
  getByOfferId(offerId: string): SecurityDepositCollectionRecord | null;
  journals(): readonly SecurityDepositJournal[];
}
export class InMemorySecurityDepositAccountingRepository implements SecurityDepositAccountingRepository {
  readonly #records = new Map<string, SecurityDepositCollectionRecord>(); readonly #journals: SecurityDepositJournal[] = [];
  createOrGet(input: { offerId: string; snapshot: SecurityDepositPolicySnapshot; paymentMethod: "fresh_card" | "bank_transfer"; providerReference: string; capabilityVersion: string }): SecurityDepositCollectionRecord {
    if (input.snapshot.amountKobo <= 0) throw new RangeError("Zero deposits have no collection record");
    const collectionId = `security-deposit:${input.offerId}`; const old = this.#records.get(collectionId); if (old) return old;
    const record = Object.freeze({ collectionId, offerId: input.offerId, policyVersion: input.snapshot.policyVersion, amountKobo: input.snapshot.amountKobo, currency: "NGN" as const, paymentMethod: input.paymentMethod, providerReference: input.providerReference, capabilityVersion: input.capabilityVersion, collectionVersion: 1, status: "awaiting_payment" as const }); this.#records.set(collectionId, record); return record;
  }
  recordCollection(id: string, at: string): SecurityDepositCollectionRecord { const r = this.#required(id); if (r.status === "held" || r.status === "refunded") return r; const journal = createSecurityDepositJournal({ collectionId: id, amountKobo: r.amountKobo, direction: "collection", createdAt: at }); this.#journals.push(journal); const n = Object.freeze({ ...r, collectionVersion: r.collectionVersion + 1, status: "collected_unbound" as const, collectedAt: at, collectionJournalId: journal.journalId }); this.#records.set(id, n); return n; }
  bind(id: string, input: { reservationId: string; contractId: string }): SecurityDepositCollectionRecord { const r = this.#required(id); if (r.status !== "collected_unbound" && r.status !== "held") throw new Error("Deposit must be collected before binding"); const n = Object.freeze({ ...r, ...input, collectionVersion: r.status === "held" ? r.collectionVersion : r.collectionVersion + 1, status: "held" as const }); this.#records.set(id, n); return n; }
  refund(id: string, input: { refundedAt: string; refundSucceeded: boolean }): SecurityDepositCollectionRecord { const r = this.#required(id); if (r.status === "refunded") return r; if (!input.refundSucceeded) { const n = Object.freeze({ ...r, collectionVersion: r.collectionVersion + 1, status: "reconciliation_required" as const }); this.#records.set(id, n); return n; } const journal = createSecurityDepositJournal({ collectionId: id, amountKobo: r.amountKobo, direction: "refund", createdAt: input.refundedAt }); this.#journals.push(journal); const n = Object.freeze({ ...r, collectionVersion: r.collectionVersion + 1, status: "refunded" as const, refundedAt: input.refundedAt, refundJournalId: journal.journalId }); this.#records.set(id, n); return n; }
  getByOfferId(offerId: string): SecurityDepositCollectionRecord | null { return [...this.#records.values()].find((r) => r.offerId === offerId) ?? null; }
  getByReservationId(reservationId: string): HeldSecurityDeposit | null { const r = [...this.#records.values()].find((x) => x.reservationId === reservationId); if (!r) return null; return Object.freeze({ collectionId: r.collectionId, collectionVersion: r.collectionVersion, reservationId, policyVersion: r.policyVersion, amountKobo: r.amountKobo, refundableBalanceKobo: r.status === "refunded" ? 0 : r.amountKobo, status: r.status === "held" || r.status === "refunded" || r.status === "reconciliation_required" ? r.status : "held", currency: "NGN" }); }
  journals(): readonly SecurityDepositJournal[] { return Object.freeze([...this.#journals]); }
  #required(id: string): SecurityDepositCollectionRecord { const r = this.#records.get(id); if (!r) throw new Error("Security deposit collection not found"); return r; }
}

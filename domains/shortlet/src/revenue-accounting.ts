import { createHash } from "node:crypto";

export type LedgerSide = "debit" | "credit";
export type LedgerAccount = "revenue_pending" | "platform_commission_earned" | "operator_net_recognized" | "operator_payable" | "rolling_reserve" | "post_stay_deferred" | "risk_restricted" | "operator_costs_and_offsets";
export interface RevenueLedgerLine { readonly lineId: string; readonly account: LedgerAccount; readonly side: LedgerSide; readonly amountKobo: number; readonly currency: "NGN"; }
export interface LedgerJournal { readonly journalId: string; readonly correlationId: string; readonly lines: readonly RevenueLedgerLine[]; readonly balanced: true; readonly createdAt: string; }
export interface EarnedCommissionRecord { readonly recordId: string; readonly releaseId: string; readonly reservationId: string; readonly commissionPolicyVersion: string; readonly earnedCommissionKobo: number; readonly currency: "NGN"; readonly earnedAt: string; }
export interface RevenueAdjustmentRecord { readonly adjustmentId: string; readonly adjustmentVersion: number; readonly reservationId: string; readonly releaseId: string; readonly source: "cancellation" | "refund" | "remedy" | "chargeback" | "processor_correction" | "other_accepted_source"; readonly sourceReference: string; readonly reasonCode: string; readonly journal: LedgerJournal; }

export interface RevenueAccountingRepository {
  findReleaseByReservationId(reservationId: string): unknown;
  findReleaseById(releaseId: string): unknown;
  commitRelease(input: { readonly release: unknown; readonly journal: LedgerJournal; readonly earnedCommission: EarnedCommissionRecord }): unknown;
  findLedgerEntriesForRelease(releaseId: string): readonly LedgerJournal[];
  postAdjustment(input: { readonly adjustment: RevenueAdjustmentRecord }): RevenueAdjustmentRecord;
  findAdjustment(adjustmentId: string, adjustmentVersion: number): RevenueAdjustmentRecord | null;
  getEarnedCommissionRecord(releaseId: string): EarnedCommissionRecord | null;
}

function validAmount(value: number): boolean { return Number.isInteger(value) && value >= 0; }
export function assertBalanced(lines: readonly RevenueLedgerLine[]): void {
  if (!lines.length || lines.some((line) => !validAmount(line.amountKobo) || line.currency !== "NGN")) throw new Error("Ledger contains an invalid amount");
  const debit = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountKobo, 0);
  const credit = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountKobo, 0);
  if (debit !== credit) throw new Error("Ledger journal is unbalanced");
}
export function journal(input: { readonly correlationId: string; readonly lines: readonly RevenueLedgerLine[]; readonly createdAt: string }): LedgerJournal {
  assertBalanced(input.lines);
  const journalId = `journal:${input.correlationId}:${createHash("sha256").update(JSON.stringify(input.lines)).digest("hex").slice(0, 16)}`;
  return Object.freeze({ journalId, correlationId: input.correlationId, lines: Object.freeze(input.lines.map((line) => Object.freeze({ ...line }))), balanced: true as const, createdAt: input.createdAt });
}

export class InMemoryRevenueAccountingRepository implements RevenueAccountingRepository {
  readonly #releases = new Map<string, unknown>(); readonly #journals = new Map<string, LedgerJournal>(); readonly #earned = new Map<string, EarnedCommissionRecord>(); readonly #adjustments = new Map<string, RevenueAdjustmentRecord>();
  readonly #failCommit: () => void;
  constructor(options: { readonly failCommit?: () => void } = {}) { this.#failCommit = options.failCommit ?? (() => undefined); }
  findReleaseByReservationId(id: string): unknown { return this.#releases.get(id) ?? null; }
  findReleaseById(id: string): unknown { return [...this.#releases.values()].find((value) => typeof value === "object" && value !== null && "releaseId" in value && (value as { releaseId: string }).releaseId === id) ?? null; }
  commitRelease(input: { readonly release: unknown; readonly journal: LedgerJournal; readonly earnedCommission: EarnedCommissionRecord }): unknown {
    const release = input.release as { releaseId: string; reservationId: string };
    const existing = this.#releases.get(release.reservationId); if (existing) return existing;
    this.#failCommit(); assertBalanced(input.journal.lines);
    this.#releases.set(release.reservationId, Object.freeze(input.release)); this.#journals.set(input.journal.journalId, input.journal); this.#earned.set(input.earnedCommission.releaseId, Object.freeze(input.earnedCommission)); return input.release;
  }
  findLedgerEntriesForRelease(releaseId: string): readonly LedgerJournal[] { return Object.freeze([...this.#journals.values()].filter((j) => j.correlationId === releaseId)); }
  postAdjustment(input: { readonly adjustment: RevenueAdjustmentRecord }): RevenueAdjustmentRecord { assertBalanced(input.adjustment.journal.lines); const key = `${input.adjustment.adjustmentId}:${input.adjustment.adjustmentVersion}`; const existing = this.#adjustments.get(key); if (existing) return existing; this.#adjustments.set(key, Object.freeze(input.adjustment)); return input.adjustment; }
  findAdjustment(id: string, version: number): RevenueAdjustmentRecord | null { return this.#adjustments.get(`${id}:${version}`) ?? null; }
  getEarnedCommissionRecord(id: string): EarnedCommissionRecord | null { return this.#earned.get(id) ?? null; }
}

export interface EarnedCommissionSource { getEarnedCommission(releaseId: string): EarnedCommissionRecord | null; }
export class RepositoryEarnedCommissionSource implements EarnedCommissionSource { constructor(private readonly repository: RevenueAccountingRepository) {} getEarnedCommission(releaseId: string): EarnedCommissionRecord | null { return this.repository.getEarnedCommissionRecord(releaseId); } }

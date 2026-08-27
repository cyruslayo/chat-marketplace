export type LivePaymentMethod = "fresh_card" | "bank_transfer" | "ussd";
export type PaymentPurpose = "stay" | "security_deposit";
export type LivePaymentAttemptStatus = "active" | "terminal";
export interface LivePaymentAttempt { readonly offerId: string; readonly method: LivePaymentMethod; readonly attemptId: string; readonly purpose: PaymentPurpose; readonly status: LivePaymentAttemptStatus; readonly startedAt: string; readonly expiresAt: string; }
/** ADR 0046: one active provider attempt per offer; terminal history is retained but does not block the next component. */
export class LivePaymentAttemptRegistry {
  readonly #active = new Map<string, LivePaymentAttempt>(); readonly #history = new Map<string, LivePaymentAttempt>();
  acquire(input: Omit<LivePaymentAttempt, "status">): LivePaymentAttempt { const current = this.#active.get(input.offerId); if (current) throw new Error(`A live ${current.method} ${current.purpose} payment attempt already owns this offer`); const attempt = { ...input, status: "active" as const }; this.#active.set(input.offerId, attempt); this.#history.set(input.attemptId, attempt); return { ...attempt }; }
  current(offerId: string, now: Date = new Date()): LivePaymentAttempt | undefined { const attempt = this.#active.get(offerId); if (!attempt) return undefined; if (now.getTime() >= new Date(attempt.expiresAt).getTime()) { this.release(offerId); return undefined; } return { ...attempt }; }
  release(offerId: string): void { const current = this.#active.get(offerId); if (current) { this.#history.set(current.attemptId, { ...current, status: "terminal" }); this.#active.delete(offerId); } }
  history(attemptId: string): LivePaymentAttempt | undefined { const attempt = this.#history.get(attemptId); return attempt ? { ...attempt } : undefined; }
}

export type LivePaymentMethod = "fresh_card" | "bank_transfer" | "ussd";
export type LivePaymentAttemptStatus = "active" | "terminal";

export interface LivePaymentAttempt {
  readonly offerId: string;
  readonly method: LivePaymentMethod;
  readonly attemptId: string;
  readonly status: LivePaymentAttemptStatus;
  readonly startedAt: string;
  readonly expiresAt: string;
}

/** ADR 0046/0048: one authoritative live payment attempt per offer. */
export class LivePaymentAttemptRegistry {
  readonly #attempts = new Map<string, LivePaymentAttempt>();

  acquire(input: Omit<LivePaymentAttempt, "status">): LivePaymentAttempt {
    const current = this.#attempts.get(input.offerId);
    if (current?.status === "active") {
      if (current.method !== input.method) throw new Error(`A live ${current.method} payment attempt already owns this offer`);
      return { ...current };
    }
    if (current?.status === "terminal") throw new Error("This offer's live payment attempt is terminal");
    const attempt = { ...input, status: "active" as const };
    this.#attempts.set(input.offerId, attempt);
    return { ...attempt };
  }

  current(offerId: string, now: Date = new Date()): LivePaymentAttempt | undefined {
    const attempt = this.#attempts.get(offerId);
    if (!attempt) return undefined;
    if (attempt.status === "active" && now.getTime() >= new Date(attempt.expiresAt).getTime()) {
      this.release(offerId);
      return undefined;
    }
    return { ...attempt };
  }

  release(offerId: string): void {
    const current = this.#attempts.get(offerId);
    if (current) this.#attempts.set(offerId, { ...current, status: "terminal" });
  }
}

import type { SqliteGuestInteractionStore } from "./guest-interaction-store.js";

export type LivePaymentMethod = "fresh_card" | "bank_transfer" | "ussd";
export type PaymentPurpose = "stay" | "security_deposit";
export type LivePaymentAttemptStatus = "active" | "terminal";
export interface LivePaymentAttempt { readonly offerId: string; readonly method: LivePaymentMethod; readonly attemptId: string; readonly purpose: PaymentPurpose; readonly status: LivePaymentAttemptStatus; readonly startedAt: string; readonly expiresAt: string; }

/** ADR 0046 registry port: one active provider attempt per offer. */
export interface LivePaymentAttemptRegistryPort {
  acquire(input: Omit<LivePaymentAttempt, "status">): LivePaymentAttempt;
  current(offerId: string, now?: Date): LivePaymentAttempt | undefined;
  release(offerId: string): void;
  history(attemptId: string): LivePaymentAttempt | undefined;
}

/** ADR 0046: one active provider attempt per offer; terminal history is retained but does not block the next component. */
export class LivePaymentAttemptRegistry implements LivePaymentAttemptRegistryPort {
  readonly #active = new Map<string, LivePaymentAttempt>(); readonly #history = new Map<string, LivePaymentAttempt>();
  acquire(input: Omit<LivePaymentAttempt, "status">): LivePaymentAttempt { const current = this.#active.get(input.offerId); if (current) throw new Error(`A live ${current.method} ${current.purpose} payment attempt already owns this offer`); const attempt = { ...input, status: "active" as const }; this.#active.set(input.offerId, attempt); this.#history.set(input.attemptId, attempt); return { ...attempt }; }
  current(offerId: string, now: Date = new Date()): LivePaymentAttempt | undefined { const attempt = this.#active.get(offerId); if (!attempt) return undefined; if (now.getTime() >= new Date(attempt.expiresAt).getTime()) { this.release(offerId); return undefined; } return { ...attempt }; }
  release(offerId: string): void { const current = this.#active.get(offerId); if (current) { this.#history.set(current.attemptId, { ...current, status: "terminal" }); this.#active.delete(offerId); } }
  history(attemptId: string): LivePaymentAttempt | undefined { const attempt = this.#history.get(attemptId); return attempt ? { ...attempt } : undefined; }
}

function isLivePaymentMethod(value: unknown): value is LivePaymentMethod {
  return value === "fresh_card" || value === "bank_transfer" || value === "ussd";
}

function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return value === "stay" || value === "security_deposit";
}

/**
 * Durable ADR-0046 Live Payment Attempt registry. One active attempt per offer
 * survives application restart; terminal history is retained. The active set is
 * lazily validated against the current clock so an expired attempt fails closed
 * (ADR-0044: expiry never reactivates).
 */
export class SqliteLivePaymentAttemptRegistry implements LivePaymentAttemptRegistryPort {
  readonly #store: SqliteGuestInteractionStore;
  readonly #active = new Map<string, LivePaymentAttempt>();
  readonly #history = new Map<string, LivePaymentAttempt>();
  #loaded = false;

  constructor(store: SqliteGuestInteractionStore) {
    this.#store = store;
  }

  #loadAll(now: Date): void {
    if (this.#loaded) return;
    this.#loaded = true;
    const offerIds = this.#store.listLivePaymentAttemptOfferIds();
    for (const offerId of offerIds) {
      const record = this.#store.findLivePaymentAttemptByOfferId(offerId);
      if (!record) continue;
      const attempt: LivePaymentAttempt = {
        offerId: record.offerId,
        method: isLivePaymentMethod(record.method) ? record.method : "fresh_card",
        attemptId: record.attemptId,
        purpose: isPaymentPurpose(record.purpose) ? record.purpose : "stay",
        status: record.status,
        startedAt: record.startedAt,
        expiresAt: record.expiresAt,
      };
      this.#history.set(attempt.attemptId, attempt);
      if (attempt.status === "active" && now.getTime() < new Date(attempt.expiresAt).getTime()) {
        this.#active.set(attempt.offerId, attempt);
      }
    }
  }

  #persist(attempt: LivePaymentAttempt): void {
    this.#store.saveLivePaymentAttempt({
      attemptId: attempt.attemptId,
      offerId: attempt.offerId,
      method: attempt.method,
      purpose: attempt.purpose,
      status: attempt.status,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
    });
  }

  acquire(input: Omit<LivePaymentAttempt, "status">): LivePaymentAttempt {
    this.#loadAll(new Date());
    const current = this.#active.get(input.offerId);
    if (current) throw new Error(`A live ${current.method} ${current.purpose} payment attempt already owns this offer`);
    const attempt: LivePaymentAttempt = { ...input, status: "active" };
    this.#active.set(input.offerId, attempt);
    this.#history.set(input.attemptId, attempt);
    this.#persist(attempt);
    return { ...attempt };
  }

  current(offerId: string, now: Date = new Date()): LivePaymentAttempt | undefined {
    this.#loadAll(now);
    const attempt = this.#active.get(offerId);
    if (!attempt) return undefined;
    if (now.getTime() >= new Date(attempt.expiresAt).getTime()) {
      this.release(offerId);
      return undefined;
    }
    return { ...attempt };
  }

  release(offerId: string): void {
    this.#loadAll(new Date());
    const current = this.#active.get(offerId);
    if (current) {
      const terminal: LivePaymentAttempt = { ...current, status: "terminal" };
      this.#history.set(current.attemptId, terminal);
      this.#active.delete(offerId);
      this.#persist(terminal);
    }
  }

  history(attemptId: string): LivePaymentAttempt | undefined {
    this.#loadAll(new Date());
    const attempt = this.#history.get(attemptId);
    return attempt ? { ...attempt } : undefined;
  }
}

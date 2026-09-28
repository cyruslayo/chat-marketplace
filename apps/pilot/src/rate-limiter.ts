/**
 * Sliding-window request limiter for one pilot process (launch-readiness issue 19). The pilot runs as a single
 * Node process (docs/pilot-deployment.md), so in-memory state is the whole picture.
 */
export interface RateLimit {
  readonly limit: number;
  readonly windowMs: number;
}

export class SlidingWindowRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #clock: () => Date;
  readonly #hits = new Map<string, number[]>();

  constructor(rule: RateLimit, clock: () => Date = () => new Date()) {
    if (!Number.isSafeInteger(rule.limit) || rule.limit < 1) throw new Error("Rate limit must be a positive whole number");
    if (!Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) throw new Error("Rate limit window must be a positive whole number of milliseconds");
    this.#limit = rule.limit;
    this.#windowMs = rule.windowMs;
    this.#clock = clock;
  }

  /** Seconds until `key` may try again, or null when an attempt now is within the limit. Records nothing. */
  retryAfterSeconds(key: string): number | null {
    const now = this.#clock().getTime();
    const hits = this.#recentHits(key, now);
    return hits.length >= this.#limit ? Math.max(1, Math.ceil((hits[0]! + this.#windowMs - now) / 1000)) : null;
  }

  /** Records one attempt for `key`. Call only after every limit that applies has allowed the request. */
  record(key: string): void {
    const now = this.#clock().getTime();
    const hits = this.#recentHits(key, now);
    hits.push(now);
    this.#hits.set(key, hits);
    this.#prune(now - this.#windowMs);
  }

  /** Records one attempt for `key` and says whether it is within the limit. Refused attempts are not recorded. */
  tryConsume(key: string): { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number } {
    const retryAfterSeconds = this.retryAfterSeconds(key);
    if (retryAfterSeconds !== null) return { allowed: false, retryAfterSeconds };
    this.record(key);
    return { allowed: true };
  }

  #recentHits(key: string, now: number): number[] {
    const since = now - this.#windowMs;
    const hits = (this.#hits.get(key) ?? []).filter((at) => at > since);
    if (hits.length > 0) this.#hits.set(key, hits);
    else this.#hits.delete(key);
    return hits;
  }

  /** Keys with no hits left in the window are dropped, so memory follows active clients only. */
  #prune(since: number): void {
    if (this.#hits.size < 1024) return;
    for (const [key, hits] of this.#hits) {
      if (hits.at(-1)! <= since) this.#hits.delete(key);
    }
  }

  get trackedKeys(): number {
    return this.#hits.size;
  }
}

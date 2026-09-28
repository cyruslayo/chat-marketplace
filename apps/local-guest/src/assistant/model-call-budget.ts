import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "./assistant-model.js";

/** Africa/Lagos is UTC+1 all year, so a pilot day is the UTC date one hour ahead. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function lagosDay(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Daily cap on model calls for one pilot process (launch-readiness issue 19). The count resets at midnight
 * Africa/Lagos. The cap is soft by at most one turn: a turn that starts with capacity finishes, and new turns
 * then use the deterministic concierge (ADR 0080) until the next day.
 */
export class ModelCallBudget {
  readonly #dailyCap: number;
  readonly #clock: () => Date;
  #day = "";
  #calls = 0;

  constructor(dailyCap: number, clock: () => Date = () => new Date()) {
    if (!Number.isSafeInteger(dailyCap) || dailyCap < 1) throw new Error("The daily model-call cap must be a positive whole number");
    this.#dailyCap = dailyCap;
    this.#clock = clock;
  }

  #rollover(): void {
    const today = lagosDay(this.#clock());
    if (today !== this.#day) {
      this.#day = today;
      this.#calls = 0;
    }
  }

  hasCapacity(): boolean {
    this.#rollover();
    return this.#calls < this.#dailyCap;
  }

  record(): void {
    this.#rollover();
    this.#calls += 1;
  }

  get callsToday(): number {
    this.#rollover();
    return this.#calls;
  }
}

/** Counts every model request the concierge makes; a request the fallback provider answers still counts once. */
export class BudgetedModelClient implements AssistantModelClient {
  readonly #inner: AssistantModelClient;
  readonly #budget: ModelCallBudget;

  constructor(inner: AssistantModelClient, budget: ModelCallBudget) {
    this.#inner = inner;
    this.#budget = budget;
  }

  generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    this.#budget.record();
    return this.#inner.generate(request);
  }
}

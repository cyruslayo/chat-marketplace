export const DEFAULT_PILOT_AGENT_SMOKE_RUNS = 1;
export const MAX_PILOT_AGENT_SMOKE_RUNS = 3;
export const DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY = 10;

export type ProviderStopReason = "PROVIDER_RATE_LIMITED" | "PROVIDER_REQUEST_BUDGET_EXCEEDED";

export function parsePilotAgentSmokeRuns(args: readonly string[], environmentValue?: string): number {
  let cliValue: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--runs") {
      if (cliValue !== undefined || args[index + 1] === undefined) throw new Error("Use --runs <1-3> exactly once.");
      cliValue = args[index + 1];
      index++;
      continue;
    }
    if (argument?.startsWith("--runs=")) {
      if (cliValue !== undefined) throw new Error("Use --runs <1-3> exactly once.");
      cliValue = argument.slice("--runs=".length);
      continue;
    }
    throw new Error(`Unknown pilot agent smoke option: ${argument ?? ""}`);
  }

  const configuredValue = cliValue ?? environmentValue ?? String(DEFAULT_PILOT_AGENT_SMOKE_RUNS);
  if (!/^[1-3]$/.test(configuredValue)) {
    throw new Error(`Pilot agent smoke journey count must be between 1 and ${MAX_PILOT_AGENT_SMOKE_RUNS}.`);
  }
  return Number(configuredValue);
}

export class ProviderRequestBudget {
  readonly #maxRequestsPerJourney: number;
  readonly #maxRequests: number;
  readonly #requestsByJourney = new Map<number, number>();
  #totalRequests = 0;
  #exceeded = false;

  constructor(journeyCount: number, maxRequestsPerJourney = DEFAULT_PROVIDER_REQUEST_BUDGET_PER_JOURNEY) {
    if (!Number.isSafeInteger(journeyCount) || journeyCount < 1 || journeyCount > MAX_PILOT_AGENT_SMOKE_RUNS) {
      throw new RangeError("Journey count is outside the supported smoke range.");
    }
    if (!Number.isSafeInteger(maxRequestsPerJourney) || maxRequestsPerJourney < 1) {
      throw new RangeError("Provider request budget must be a positive integer.");
    }
    this.#maxRequestsPerJourney = maxRequestsPerJourney;
    this.#maxRequests = journeyCount * maxRequestsPerJourney;
  }

  get totalRequests(): number {
    return this.#totalRequests;
  }

  get maxRequests(): number {
    return this.#maxRequests;
  }

  get maxRequestsPerJourney(): number {
    return this.#maxRequestsPerJourney;
  }

  get exceeded(): boolean {
    return this.#exceeded;
  }

  requestsForJourney(journey: number): number {
    return this.#requestsByJourney.get(journey) ?? 0;
  }

  reserve(journey: number): boolean {
    const journeyRequests = this.requestsForJourney(journey);
    if (journeyRequests >= this.#maxRequestsPerJourney || this.#totalRequests >= this.#maxRequests) {
      this.#exceeded = true;
      return false;
    }
    this.#requestsByJourney.set(journey, journeyRequests + 1);
    this.#totalRequests++;
    return true;
  }
}

export function providerStopReason(input: {
  readonly providerStatusCode?: number;
  readonly providerErrorClass?: string;
  readonly budgetExceeded: boolean;
}): ProviderStopReason | undefined {
  if (input.budgetExceeded) return "PROVIDER_REQUEST_BUDGET_EXCEEDED";
  if (input.providerStatusCode === 429 || input.providerErrorClass === "RateLimitError") return "PROVIDER_RATE_LIMITED";
  return undefined;
}

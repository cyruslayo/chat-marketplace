import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";
import { ScriptedAssistantModel } from "../../apps/local-guest/src/assistant/scripted-assistant-model.js";
import type { AssistantThreadState } from "../../apps/local-guest/src/assistant/assistant-state.js";

/** Staging-like clock (AGENTS.md: concierge tests run with a staging-like clock). */
export const STAGING_LIKE_START = "2026-10-27T09:00:00Z";

/**
 * A clock the environment and a scripted model share. A scripted model spends time with `advance`,
 * so deadline tests need no real waits.
 */
export class SteppedClock {
  #ms: number;

  constructor(start: string) {
    this.#ms = Date.parse(start);
  }

  readonly now = (): Date => new Date(this.#ms);

  advance(milliseconds: number): void {
    this.#ms += milliseconds;
  }
}

export type PlannerHandler = (request: AssistantModelRequest, plannerIndex: number) => AssistantModelResponse;

/**
 * Records every request the runtime makes. Scope requests are answered by the offline scope fixture
 * (`onScope` runs first, so a test can spend time there); planner requests are answered by `plan`.
 */
export class RecordingTurnModel implements AssistantModelClient {
  readonly requests: AssistantModelRequest[] = [];
  readonly #scope = new ScriptedAssistantModel();
  readonly #plan: PlannerHandler;
  readonly #onScope: (() => void) | undefined;
  #plannerCount = 0;

  constructor(plan: PlannerHandler, onScope?: () => void) {
    this.#plan = plan;
    this.#onScope = onScope;
  }

  /** Every planner-level request (the scope classifier excluded), in order. */
  get plannerRequests(): AssistantModelRequest[] {
    return this.requests.filter((request) => request.structuredOutput?.name !== "concierge_scope");
  }

  async generate(request: AssistantModelRequest): Promise<AssistantModelResponse> {
    this.requests.push(request);
    if (request.structuredOutput?.name === "concierge_scope") {
      this.#onScope?.();
      return this.#scope.generate(request);
    }
    const plannerIndex = this.#plannerCount++;
    return this.#plan(request, plannerIndex);
  }
}

/** Serialises the thread state a rejected or rolled-back turn must leave untouched. */
export function threadSnapshot(thread: AssistantThreadState): string {
  return JSON.stringify({
    taskState: thread.taskState,
    activeTaskId: thread.activeTaskId,
    tasks: thread.tasks,
    activeSurfaces: thread.activeSurfaces,
    supersededSurfaces: thread.supersededSurfaces,
    lastSurfaces: thread.lastSurfaces,
    discoveryArtifactId: thread.discoveryArtifactId,
  }, (_key, value: unknown) => value instanceof Map || value instanceof Set ? [...value] : value);
}

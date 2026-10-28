import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { LocalGuestApp, type GuestTurnResult } from "../../apps/local-guest/src/shortlet-app.js";
import type { AssistantModelClient, AssistantModelRequest, AssistantModelResponse } from "../../apps/local-guest/src/assistant/assistant-model.js";
import type { AssistantDiagnosticEvent } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantTurnRecord } from "../../apps/local-guest/src/assistant/assistant-turn-record.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { ShortletAssistantRuntime } from "./assistant-runtime-host.js";
import { ModelCallBudget, BudgetedModelClient } from "../../apps/local-guest/src/assistant/model-call-budget.js";
import { definitionOf, PROPOSE_REQUEST, SEARCH_IKOYI, journeyScriptedModel, type RecordedJourneyDefinition } from "./assistant-recordings.js";
import { LIVE_LIKE_CLOCK, firstButtonAction } from "./guest-date-fixtures.js";

// Shared fixtures for the thread-lock tests (issue 06). One definition, used by the Node tests and the session-level tests.

export const THREAD = "g-d1a0000601";
export const SEARCH_TEXT = "I need a place in Ikoyi for 4 nights for 2 guests from 14 December 2026";
export const PROPOSE_TEXT = "Request the first one.";
/** The typed turn held at the planner: a unit-detail read that runs one planner round after its tool call. */
export const HELD_TEXT = "Open the first one.";

/** The recorded confirmation journey, extended with the held planner turn. */
export function lockDefinition(threadId: string): RecordedJourneyDefinition {
  return {
    ...definitionOf("confirmation-cancelled"),
    threadId,
    guestTurns: [
      { text: SEARCH_TEXT, planner: { tool: "search_stays", args: SEARCH_IKOYI } },
      { text: PROPOSE_TEXT, planner: PROPOSE_REQUEST },
      { text: HELD_TEXT, planner: { tool: "get_unit_details", args: { stayRef: "stay-1" } } },
    ],
  };
}

/** The scripted model every lock test uses: the journey's answers, with the held text gated. */
export function lockModel(holdText: string = HELD_TEXT): { model: AssistantModelClient; gate: Gate } {
  return gatedModel(journeyScriptedModel(lockDefinition(THREAD)), holdText);
}

export interface Gate {
  /** Resolves when the held planner request has started and is waiting. */
  readonly reached: Promise<void>;
  /** Lets the held planner request continue. */
  release(): void;
  /** Runs when the test releases the held request, before it continues (a deadline passing, for example). */
  beforeRelease?: () => void;
  /** When set, the held request throws instead of answering. */
  failOnRelease?: Error;
  /** When set, the held request never resolves and ignores its abort signal (a stuck provider). */
  neverResolve?: boolean;
}

/** A model that holds the first planner request for `holdText` until the test releases it. Every other request passes through. */
export function gatedModel(inner: AssistantModelClient, holdText: string): { model: AssistantModelClient; gate: Gate } {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  let holding = false;
  const gate: Gate = { reached, release: () => release() };
  const model: AssistantModelClient = {
    supportsProviderAttemptReservation: inner.supportsProviderAttemptReservation,
    generate: async (request: AssistantModelRequest): Promise<AssistantModelResponse> => {
      const last = request.history.at(-1);
      if (!holding && request.structuredOutput?.name !== "concierge_scope" && last?.role === "user" && last.text === holdText) {
        holding = true;
        reach();
        if (gate.neverResolve) await new Promise<never>(() => undefined);
        await released;
        gate.beforeRelease?.();
        if (gate.failOnRelease) throw gate.failOnRelease;
      }
      return inner.generate(request);
    },
  };
  return { model, gate };
}

export interface LockWorld {
  readonly environment: LocalGuestEnvironment;
  readonly app: LocalGuestApp;
  readonly runtime: ShortletAssistantRuntime;
  readonly records: AssistantTurnRecord[];
  readonly diagnostics: AssistantDiagnosticEvent[];
}

/** One application and runtime over the environment. The records and diagnostics are the runtime's own output. */
export function worldOver(environment: LocalGuestEnvironment, model: AssistantModelClient, options: { readonly turnDeadlineMs?: number } = {}): LockWorld {
  const records: AssistantTurnRecord[] = [];
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const budget = new ModelCallBudget(50, () => environment.clock());
  const runtime = new ShortletAssistantRuntime(environment, new BudgetedModelClient(model, budget), {
    onTurnRecord: (record) => records.push(record),
    onDiagnostic: (event) => diagnostics.push(event),
    modelName: "openai/gpt-6-luna",
    ...(options.turnDeadlineMs === undefined ? {} : { turnDeadlineMs: options.turnDeadlineMs }),
  });
  const app = new LocalGuestApp(environment, { assistantRuntime: runtime, modelCallBudget: budget });
  return { environment, app, runtime, records, diagnostics };
}

/** A guest with a phone, on the staging-like clock, so a Booking Request can be confirmed. */
export function phoneEnvironment(clock: () => Date = LIVE_LIKE_CLOCK): LocalGuestEnvironment {
  return LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock });
}

export function successOf(result: GuestTurnResult, label: string) {
  assert.equal(result.ok, true, result.ok ? "" : `${label}: expected success, saw ${result.code}: ${result.message}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

export function codeOf(result: GuestTurnResult): string | undefined {
  return result.ok ? undefined : result.code;
}

export function pendingId(world: { readonly runtime: ShortletAssistantRuntime }, threadId: string): string | undefined {
  return world.runtime.getThread(threadId).taskState.pendingAction?.id;
}

/** The confirm event of the live pending-action card, as the guest's button sends it. */
export function confirmEventFor(world: { readonly runtime: ShortletAssistantRuntime }, threadId: string, card: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }) {
  const live = firstButtonAction(card);
  return { ...live, name: ASSISTANT_CONFIRM_ACTION_EVENT, context: { ...live.context, actionId: pendingId(world, threadId) } };
}

/** Searches, then proposes a Booking Request on the thread. Returns the proposal's pending-action card. */
export async function proposeOn(world: LockWorld, threadId: string) {
  world.app.getState(threadId);
  successOf(await world.app.handleTurn(threadId, SEARCH_TEXT), "search");
  const proposal = successOf(await world.app.handleTurn(threadId, PROPOSE_TEXT), "propose");
  const card = proposal.surfaces.find((surface) => /:pending-action:/.test(surface.surfaceId));
  assert.ok(card, "the proposal shows its pending-action card");
  return card;
}

/** A real open proposal, built on its own thread, for the commit-level tests (the object the runtime holds). */
export async function sampleProposal() {
  const world = worldOver(phoneEnvironment(), journeyScriptedModel(lockDefinition("g-d1a0000699")));
  await proposeOn(world, "g-d1a0000699");
  const action = world.runtime.getThread("g-d1a0000699").taskState.pendingAction;
  assert.ok(action, "a proposal exists");
  return action;
}
